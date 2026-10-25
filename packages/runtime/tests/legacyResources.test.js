// c0.24 家族死链声音预置（F1）：合成 jar 闸门 + 19 键表 + 计划/物化（幂等、尺寸不符修复、缺席跳过）。
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  LEGACY_RESOURCE_PROBE_BASE,
  LEGACY_RESOURCES_DIR,
  hasLegacyResourceProbes,
  legacyResourceRows,
  legacyTargetFile,
  planLegacyResources,
  materializeLegacyResources,
  writeZipEntries,
} = require('../dist/index.js');

const tmpDirs = [];
const mkTmp = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
};
test.after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** 合成游戏 jar：可控「线程类名 / 是否含死链常量 / 有无该类」。 */
function syntheticJar(opts = {}) {
  const dir = mkTmp('attic-legacy-res-jar-');
  const file = path.join(dir, 'game.jar');
  const entries = [
    { name: 'com/mojang/minecraft/Minecraft.class', method: 0, dosTime: 0, dosDate: 0, data: Buffer.from('x'.repeat(64), 'latin1') },
  ];
  if (opts.className) {
    const body = opts.marker === false ? 'https://files.betacraft.uk/launcher/no-dead-here' : `!${LEGACY_RESOURCE_PROBE_BASE}wood1.ogg`;
    entries.push({
      name: `com/mojang/minecraft/${opts.className}.class`,
      method: 0,
      dosTime: 0,
      dosDate: 0,
      data: Buffer.from(body, 'latin1'),
    });
  }
  writeZipEntries(file, entries);
  return file;
}

/** 索引 JSON：keys → {objects|custom} 段，对象正文真落盘（size 与声明一致）。 */
function fixtureIndex(keys, section = 'objects') {
  const assetsRoot = mkTmp('attic-legacy-res-assets-');
  const index = {};
  for (const key of keys) {
    const hash = crypto.createHash('sha1').update(key).digest('hex');
    const body = Buffer.from(`${hash}/${key}`, 'latin1');
    const target = path.join(assetsRoot, 'objects', hash.slice(0, 2), hash);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
    index[section] = index[section] ?? {};
    index[section][key] = { hash, size: body.length };
  }
  return { indexJson: index, assetsRoot };
}

test('闸门：两代类名 + 死链常量 → 判是；缺任一条 → 判否', () => {
  assert.equal(hasLegacyResourceProbes(syntheticJar({ className: 'ThreadDownloadResources' })), true);
  assert.equal(hasLegacyResourceProbes(syntheticJar({ className: 'ResourceDownloadThread' })), true);
  // 有类无标记（c0.24_st* 那类无 https 的形态）
  assert.equal(hasLegacyResourceProbes(syntheticJar({ className: 'ThreadDownloadResources', marker: false })), false);
  // 有标记无类
  assert.equal(hasLegacyResourceProbes(syntheticJar({})), false);
  // 文件缺席 / 不是 zip：都不得抛错
  assert.equal(hasLegacyResourceProbes(path.join(mkTmp('attic-legacy-res-missing-'), 'nope.jar')), false);
  const broken = path.join(mkTmp('attic-legacy-res-broken-'), 'broken.jar');
  fs.writeFileSync(broken, 'not a zip at all');
  assert.equal(hasLegacyResourceProbes(broken), false);
});

test('表：19 条，序号界取字节码循环界（step 4×4、music 3）', () => {
  const rows = legacyResourceRows();
  assert.equal(rows.length, 19);
  assert.equal(rows[0].url, `${LEGACY_RESOURCE_PROBE_BASE}newsound/step/wood1.ogg`);
  assert.equal(rows[3].key, 'sound/step/wood4.ogg');
  assert.equal(rows[4].key, 'sound/step/stone1.ogg');
  assert.equal(rows[8].key, 'sound/step/grass1.ogg');
  assert.equal(rows[15].key, 'sound/step/gravel4.ogg');
  assert.equal(rows[16].key, 'music/calm1.ogg');
  assert.equal(rows[18].key, 'music/calm3.ogg');
  // URL 端与落盘端不同源（newsound/ ↔ sound/）——改 host 或物化 newsound/ 都救不了
  assert.ok(rows[0].url.includes('newsound/step/wood1.ogg'));
  assert.ok(!rows[0].key.includes('newsound'));
});

test('目标路径 = <gameDir>/resources/<key>（守卫按 gameDir + path 比对）', () => {
  assert.equal(LEGACY_RESOURCES_DIR, 'resources');
  assert.equal(
    legacyTargetFile(path.join('X:', 'inst'), 'sound/step/wood1.ogg'),
    path.join('X:', 'inst', 'resources', 'sound', 'step', 'wood1.ogg'),
  );
});

test('计划：只认索引有键 + 对象在位且尺寸相符；非探针键忽略', () => {
  const rows = legacyResourceRows();
  const all = rows.map((r) => r.key);
  const { indexJson, assetsRoot } = fixtureIndex(all);
  const gameDir = mkTmp('attic-legacy-res-game-');
  const plan = planLegacyResources({ indexJson, assetsRoot, gameDir });
  assert.equal(plan.total, 19);
  assert.equal(plan.entries.length, 19);
  for (const entry of plan.entries) {
    assert.ok(fs.existsSync(entry.source));
    assert.equal(entry.size, fs.statSync(entry.source).size);
    assert.ok(entry.target.startsWith(path.join(gameDir, 'resources')));
  }

  // 对象缺席 → 丢条目（不映射到不存在的路径）
  const gone = plan.entries[0];
  fs.rmSync(gone.source);
  assert.equal(planLegacyResources({ indexJson, assetsRoot, gameDir }).entries.length, 18);

  // 尺寸不符 → 丢条目
  const { indexJson: idx2, assetsRoot: root2 } = fixtureIndex(['sound/step/wood1.ogg', 'misc/terrain.png']);
  const bad = path.join(root2, 'objects', idx2.objects['sound/step/wood1.ogg'].hash.slice(0, 2), idx2.objects['sound/step/wood1.ogg'].hash);
  fs.writeFileSync(bad, 'short');
  const plan2 = planLegacyResources({ indexJson: idx2, assetsRoot: root2, gameDir });
  assert.equal(plan2.entries.length, 0);
  assert.equal(plan2.total, 19);

  // 索引形状异常 / 空 → 零条目、不抛
  for (const junk of [null, undefined, {}, 'str', []]) {
    assert.equal(planLegacyResources({ indexJson: junk, assetsRoot: root2, gameDir }).entries.length, 0);
  }
});

test('物化：全量落位 → 树形与字节一致（对齐 Probe6 MODE2）', () => {
  const all = legacyResourceRows().map((r) => r.key);
  const { indexJson, assetsRoot } = fixtureIndex(all);
  const gameDir = mkTmp('attic-legacy-res-game-');
  const notes = [];
  const out = materializeLegacyResources({ indexJson, assetsRoot, gameDir, onDiagnostic: (m) => notes.push(m) });
  assert.equal(out.total, 19);
  assert.equal(out.ready, 19);
  assert.equal(out.missing, 0);
  assert.equal(out.copied, 19);
  assert.equal(out.skipped, 0);
  assert.equal(out.replaced, 0);
  for (const entry of planLegacyResources({ indexJson, assetsRoot, gameDir }).entries) {
    assert.deepEqual(fs.readFileSync(entry.target), fs.readFileSync(entry.source));
  }
  // 目录骨架：resources/sound/step + resources/music
  assert.equal(fs.readdirSync(path.join(gameDir, 'resources', 'sound', 'step')).length, 16);
  assert.equal(fs.readdirSync(path.join(gameDir, 'resources', 'music')).length, 3);
  assert.ok(notes.some((n) => n.includes('legacy resources') && n.includes('19/19')));
});

test('物化：幂等（二次运行零写入、零临时残留）', () => {
  const all = legacyResourceRows().map((r) => r.key);
  const { indexJson, assetsRoot } = fixtureIndex(all);
  const gameDir = mkTmp('attic-legacy-res-game-');
  const first = materializeLegacyResources({ indexJson, assetsRoot, gameDir });
  assert.equal(first.copied, 19);
  const second = materializeLegacyResources({ indexJson, assetsRoot, gameDir });
  assert.equal(second.copied, 0);
  assert.equal(second.replaced, 0);
  assert.equal(second.skipped, 19);
  assert.deepEqual(fs.readdirSync(path.join(gameDir, 'resources', 'music')).filter((n) => n.includes('tmp')), []);
});

test('物化：目标在位但尺寸不符（毒文件）→ 计数 replaced 并改写回正确正文', () => {
  const all = legacyResourceRows().map((r) => r.key);
  const { indexJson, assetsRoot } = fixtureIndex(all);
  const gameDir = mkTmp('attic-legacy-res-game-');
  materializeLegacyResources({ indexJson, assetsRoot, gameDir });
  const target = legacyTargetFile(gameDir, 'sound/step/wood2.ogg');
  fs.writeFileSync(target, 'truncated');
  const out = materializeLegacyResources({ indexJson, assetsRoot, gameDir });
  assert.equal(out.replaced, 1);
  assert.equal(out.copied, 0);
  assert.equal(out.skipped, 18);
  const entry = planLegacyResources({ indexJson, assetsRoot, gameDir }).entries.find((e) => e.key === 'sound/step/wood2.ogg');
  assert.deepEqual(fs.readFileSync(target), fs.readFileSync(entry.source));
});

test('物化：对象缺席只跳过该键（其余照落），全缺席则维持现状不抛', () => {
  const { indexJson, assetsRoot } = fixtureIndex(legacyResourceRows().map((r) => r.key));
  const gameDir = mkTmp('attic-legacy-res-game-');
  const victim = planLegacyResources({ indexJson, assetsRoot, gameDir }).entries.find((e) => e.key === 'music/calm3.ogg');
  fs.rmSync(victim.source);
  const out = materializeLegacyResources({ indexJson, assetsRoot, gameDir });
  assert.equal(out.ready, 18);
  assert.equal(out.missing, 1);
  assert.equal(out.copied, 18);
  assert.equal(fs.existsSync(victim.target), false);

  const empty = materializeLegacyResources({ indexJson: {}, assetsRoot, gameDir: mkTmp('attic-legacy-res-game-') });
  assert.deepEqual({ ready: empty.ready, copied: empty.copied, missing: empty.missing }, { ready: 0, copied: 0, missing: 19 });
});

test('物化：音乐在 custom 段（真实 c0.0.22a_01 形状）照样命中', () => {
  const keys = ['music/calm1.ogg', 'music/calm2.ogg', 'music/calm3.ogg'];
  const { indexJson, assetsRoot } = fixtureIndex(keys, 'custom');
  const gameDir = mkTmp('attic-legacy-res-game-');
  const out = materializeLegacyResources({ indexJson, assetsRoot, gameDir });
  assert.equal(out.ready, 3);
  assert.equal(out.copied, 3);
  assert.equal(out.missing, 16);
  assert.equal(fs.readdirSync(path.join(gameDir, 'resources', 'music')).length, 3);
});

test('物化：gameDir 不可写 → 逐条失败即跳过，整体返回计数不抛错', () => {
  const { indexJson, assetsRoot } = fixtureIndex(legacyResourceRows().map((r) => r.key));
  const blocker = path.join(mkTmp('attic-legacy-res-block-'), 'file');
  fs.writeFileSync(blocker, '占位文件挡在 gameDir 位置上');
  const notes = [];
  const out = materializeLegacyResources({ indexJson, assetsRoot, gameDir: blocker, onDiagnostic: (m) => notes.push(m) });
  assert.equal(out.ready, 19);
  assert.equal(out.copied, 0);
  assert.equal(out.skipped, 0);
  assert.ok(notes.some((n) => n.includes('legacy resource 预置失败')));
});
