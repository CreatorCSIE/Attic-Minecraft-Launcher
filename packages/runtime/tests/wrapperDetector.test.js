'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { canonicalLaunchMethod, detectLaunchMethod, probeIndevEntry, probePreclassicEntry, listZipEntryNames } = require('../dist/index.js');
const { buildZip, buildJarBuffer } = require('./zipFixture.js');

function tempJar(t, classNames) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attic-det-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'game.jar');
  fs.writeFileSync(file, buildJarBuffer(classNames));
  return file;
}

const APPLET = 'com.mojang.minecraft.MinecraftApplet';
const NETPLAYER = 'com.mojang.minecraft.net.NetworkPlayer';

test('listZipEntryNames：中央目录条目名枚举', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attic-det-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'game.zip');
  fs.writeFileSync(file, buildZip(['com/mojang/minecraft/MinecraftApplet.class', 'a/b/c.txt']));
  assert.deepEqual(listZipEntryNames(file), ['com/mojang/minecraft/MinecraftApplet.class', 'a/b/c.txt']);
});

test('detectLaunchMethod：v1 classRules 全序 + ! 取反（4k 已剔除）', (t) => {
  // 顺序即优先级：rd/mc 在前，classic 系靠取反规则区分
  assert.equal(detectLaunchMethod(tempJar(t, ['com.mojang.rubydung.RubyDung'])), 'rd');
  assert.equal(
    detectLaunchMethod(tempJar(t, ['com.mojang.minecraft.RubyDung', APPLET])),
    'mc',
  );
  assert.equal(
    detectLaunchMethod(tempJar(t, [APPLET, 'com.mojang.minecraft.server.MinecraftServer', NETPLAYER])),
    'classic12a', // !User 满足（User 不存在）
  );
  assert.equal(detectLaunchMethod(tempJar(t, [APPLET])), 'classic'); // !NetworkPlayer
  assert.equal(detectLaunchMethod(tempJar(t, [APPLET, NETPLAYER])), 'classic15a'); // !e
  assert.equal(detectLaunchMethod(tempJar(t, [APPLET, NETPLAYER, 'com.mojang.minecraft.e'])), 'classicmp');
  assert.equal(detectLaunchMethod(tempJar(t, ['net.minecraft.client.MinecraftApplet'])), 'indev');
  assert.equal(detectLaunchMethod(tempJar(t, ['net.minecraft.client.main.Main'])), '1.6');
  // 4k jar（仅 M.class）不再命中检测 → custom（用户拍板：4k 走显式启动方法数据路径）
  assert.equal(detectLaunchMethod(tempJar(t, ['M'])), 'custom');
  // 全不中 = custom（v1 Error 7 语义入口）
  assert.equal(detectLaunchMethod(tempJar(t, ['com.example.Nothing'])), 'custom');
  assert.equal(detectLaunchMethod(tempJar(t, [])), 'custom');
});

test('probeIndevEntry：indev 混代探测（仅 Applet → applet；含 Minecraft → main）', (t) => {
  // 早期 indev jar 实测形态（in-20100223）：仅 net.minecraft.client.MinecraftApplet
  assert.equal(detectLaunchMethod(tempJar(t, ['net.minecraft.client.MinecraftApplet'])), 'indev');
  assert.equal(probeIndevEntry(tempJar(t, ['net.minecraft.client.MinecraftApplet'])), 'applet');
  // beta+ 形态（b1.7.3 实测）：两类齐备 → main 优先
  assert.equal(
    probeIndevEntry(tempJar(t, ['net.minecraft.client.Minecraft', 'net.minecraft.client.MinecraftApplet'])),
    'main',
  );
  assert.equal(probeIndevEntry(tempJar(t, ['com.example.Nothing'])), null);
  assert.equal(probeIndevEntry(path.join(os.tmpdir(), 'attic-nope-', 'missing.jar')), null);
});

test('probePreclassicEntry：rd 代 jar 的 RubyDung 入口探测（缺失/不可读 = null）', (t) => {
  // rd-132211 实测形态（pc-132011 jar）：仅 com.mojang.rubydung.RubyDung，无任何 MinecraftApplet
  assert.equal(probePreclassicEntry(tempJar(t, ['com.mojang.rubydung.RubyDung'])), 'com.mojang.rubydung.RubyDung');
  // 后续 rd-1322xx 形态：com.mojang.minecraft.RubyDung（MinecraftApplet 是 0 字段空壳，v3 明确弃用）
  assert.equal(probePreclassicEntry(tempJar(t, ['com.mojang.minecraft.RubyDung', APPLET])), 'com.mojang.minecraft.RubyDung');
  // 两类皆在（理论序）：rubydung 系优先
  assert.equal(
    probePreclassicEntry(tempJar(t, ['com.mojang.minecraft.RubyDung', 'com.mojang.rubydung.RubyDung'])),
    'com.mojang.rubydung.RubyDung',
  );
  // classic 系 jar（只有空壳 Applet）不属本通道 → null 不注入
  assert.equal(probePreclassicEntry(tempJar(t, [APPLET])), null);
  assert.equal(probePreclassicEntry(tempJar(t, ['com.example.Nothing'])), null);
  assert.equal(probePreclassicEntry(path.join(os.tmpdir(), 'attic-nope-', 'missing.jar')), null);
});

test('canonicalLaunchMethod：v1 检测名 → 官方 .info 合法值归一', () => {
  assert.equal(canonicalLaunchMethod('rd'), 'preclassic');
  assert.equal(canonicalLaunchMethod('mc'), 'preclassic');
  assert.equal(canonicalLaunchMethod('classic15a'), 'Classic15aWithSaving');
  assert.equal(canonicalLaunchMethod('classicmp'), 'ClassicMpWithSaving');
  // 表内即合法名原样通过；1.6（超 BC 清单）无目标名不归一——显式报错可见
  for (const pass of ['classic12a', 'classic', 'indev', 'custom', '1.6']) {
    assert.equal(canonicalLaunchMethod(pass), pass);
  }
});

test('detectLaunchMethod：jar 不可读回落 custom（v1 catch Throwable 同语义）', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attic-det-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bogus = path.join(dir, 'bogus.jar');
  fs.writeFileSync(bogus, 'not a zip');
  assert.equal(detectLaunchMethod(bogus), 'custom');
  assert.equal(detectLaunchMethod(path.join(dir, 'missing.jar')), 'custom');
});
