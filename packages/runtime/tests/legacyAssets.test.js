'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveAssetIndexId, resolveLaunchAssetIndexId, AUTHORITATIVE_ASSET_INDEXES, planAssetObjects, ASSET_INDEXES, BetacraftClient } = require('../dist/index.js');

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

test('resolveAssetIndexId：version_data 表逐行核对（首中即返 + empty=无资产）', () => {
  assert.equal(resolveAssetIndexId('pc-132011'), null); // rd/pc → empty
  assert.equal(resolveAssetIndexId('c0.0.13a_03'), null); // 21a 前 → empty
  assert.equal(resolveAssetIndexId('c0.0.22a_05'), 'c0.0.22a_01');
  assert.equal(resolveAssetIndexId('c0.24_st_03'), 'c0.0.22a_01');
  assert.equal(resolveAssetIndexId('c0.30-c-1900'), 'c0.0.22a_01');
  assert.equal(resolveAssetIndexId('in-20100223'), '20100212');
  assert.equal(resolveAssetIndexId('inf-20100616-1808'), '20100607');
  assert.equal(resolveAssetIndexId('a1.0.1_01'), '20100607');
  assert.equal(resolveAssetIndexId('a1.0.5-2149'), 'a1.0.3');
  assert.equal(resolveAssetIndexId('a1.0.8_01'), 'a1.0.8');
  assert.equal(resolveAssetIndexId('a1.0.11'), 'a1.0.9');
  assert.equal(resolveAssetIndexId('a1.0.12-1038'), 'a1.0.12');
  // 上游表缺口：a1.0.12/13 行只覆盖 `-数字` 尾巴，`_01` 形态无匹配行（逐字移植，不补造规则）。
  assert.equal(resolveAssetIndexId('a1.0.13_01-1038'), null);
  assert.equal(resolveAssetIndexId('a1.0.16_02'), 'a1.0.14');
  assert.equal(resolveAssetIndexId('a1.1.2_01'), 'a1.0.14');
  assert.equal(resolveAssetIndexId('a1.2.0_01'), 'a1.2.0');
  assert.equal(resolveAssetIndexId('a1.2.3_01-0956'), 'a1.2.0_02');
  assert.equal(resolveAssetIndexId('b1.1_02'), 'a1.2.0_02');
  assert.equal(resolveAssetIndexId('b1.2_02-dev-20110517'), 'b1.2');
  assert.equal(resolveAssetIndexId('b1.4_01'), 'b1.4');
  assert.equal(resolveAssetIndexId('b1.6.6'), 'b1.5');
  assert.equal(resolveAssetIndexId('b1.7.3'), 'b1.7');
  assert.equal(resolveAssetIndexId('b1.9-pre4-1415'), 'b1.7');
  assert.equal(resolveAssetIndexId('1.0.0'), '1.0.0-rc1');
  assert.equal(resolveAssetIndexId('1.1'), '1.0.0-rc1');
  assert.equal(resolveAssetIndexId('11w49a'), '1.0.0-rc1');
  assert.equal(resolveAssetIndexId('1.2-pre'), '1.2');
  assert.equal(resolveAssetIndexId('12w18a'), '1.2');
  assert.equal(resolveAssetIndexId('1.5.2-pre-250903'), '1.4');
  assert.equal(resolveAssetIndexId('12w42b'), '1.4');
  assert.equal(resolveAssetIndexId('13w12~-1439'), '1.4');
  assert.equal(resolveAssetIndexId('2.0-preview'), '1.4');
  assert.equal(resolveAssetIndexId('4k-0144'), null); // 表外 → 无资产
  assert.equal(resolveAssetIndexId('mycustom'), null);
});

test('resolveLaunchAssetIndexId：BC v2 权威表钉死 Indev 分歧 + 四级优先级', () => {
  // Indev 年代：标题探测（"Minecraft 0.31"→c0.31→20100124）与 ID 正则表（in-.+→20100212）不同源，
  // 以 BC v2 每版本 JSON 权威 assetIndex.id 为准（23 条逐条实拉核对）。
  assert.equal(resolveLaunchAssetIndexId({ id: 'in-20100130' }), '20100124');
  assert.equal(resolveLaunchAssetIndexId({ id: 'in-20100104-2258' }), '20100104'); // 标题探测永远产不出
  assert.equal(resolveLaunchAssetIndexId({ id: 'in-20100110' }), '20100110');
  assert.equal(resolveLaunchAssetIndexId({ id: 'in-20100206-2103' }), '20100206');
  assert.equal(resolveLaunchAssetIndexId({ id: 'in-20091223-1459' }), 'c0.0.22a_01');
  assert.equal(resolveLaunchAssetIndexId({ id: 'in-20100223' }), '20100212');
  // 权威表全部 23 条均为 in- 条目，且指向的索引 ID 都有元数据。
  assert.equal(Object.keys(AUTHORITATIVE_ASSET_INDEXES).length, 23);
  for (const id of Object.values(AUTHORITATIVE_ASSET_INDEXES)) assert.ok(ASSET_INDEXES[id], `缺索引元数据：${id}`);
  // 优先级：assetIndex.id > assets > 权威表 > 正则表。
  assert.equal(resolveLaunchAssetIndexId({ id: 'in-20100130', assetIndex: { id: 'mine' }, assets: 'x' }), 'mine');
  assert.equal(resolveLaunchAssetIndexId({ id: 'in-20100130', assets: 'x' }), 'x');
  // 表外年代落回正则表（与标题探测同源一致）；表外无匹配 → null。
  assert.equal(resolveLaunchAssetIndexId({ id: 'b1.7.3' }), 'b1.7');
  assert.equal(resolveLaunchAssetIndexId({ id: '4k-0144' }), null);
});

test('downloadAssetIndex：Indev 版本预取命中权威索引（0130 → 20100124 而非 20100212）', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'attic-idx-'));
  try {
    const content = JSON.stringify({ objects: {} });
    const requested = [];
    const client = new BetacraftClient({
      fetchImpl: async (url) => {
        requested.push(url);
        return new Response(Buffer.from(content));
      },
    });
    // assetIndex 无 id（BC .info 形状），仅 url/sha1 → ID 必须落权威表 20100124。
    const json = { id: 'in-20100130', assetIndex: { url: 'http://test/idx/20100124.json', sha1: sha1(content) } };
    const id = await client.downloadAssetIndex(json, root);
    assert.equal(id, '20100124');
    assert.deepEqual(requested, ['http://test/idx/20100124.json']);
    assert.ok(fs.existsSync(path.join(root, 'assets', 'indexes', '20100124.json')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('planAssetObjects：objects+custom 合并（custom 覆盖同名键）、URL 优先级、路径前缀', () => {
  const h1 = sha1('one');
  const h2 = sha1('two');
  const h3 = sha1('three');
  const h4 = sha1('four');
  const index = {
    objects: {
      'sound/a.ogg': { hash: h1, size: 3 },
      'sound/b.ogg': { hash: h2, size: 3, url: 'http://files.betacraft.uk/special/b.ogg' },
      'music/c.ogg': { hash: h3, size: 5, custom_url: 'http://files.betacraft.uk/special/' },
      'bad/entry': { size: 1 }, // 无 hash → 丢弃
    },
    custom: {
      'sound/a.ogg': { hash: h4, size: 4 }, // 覆盖 objects 同名键（legacyfix initAssets 语义）
    },
  };
  const plan = planAssetObjects(index);
  const byKey = Object.fromEntries(plan.map((p) => [p.key, p]));
  assert.equal(plan.length, 3); // 4 键合并 - bad/entry 丢弃
  assert.equal(byKey['sound/a.ogg'].hash, h4); // custom 覆盖生效
  assert.equal(byKey['sound/a.ogg'].url, `https://resources.download.minecraft.net/${h4.slice(0, 2)}/${h4}`);
  assert.equal(byKey['sound/a.ogg'].relPath, `objects/${h4.slice(0, 2)}/${h4}`);
  assert.equal(byKey['sound/b.ogg'].url, 'http://files.betacraft.uk/special/b.ogg'); // obj.url 最优先
  assert.equal(byKey['music/c.ogg'].url, 'http://files.betacraft.uk/special/'); // custom_url 次之
  assert.ok(!('bad/entry' in byKey));
});

test('ASSET_INDEXES：表内引用的索引 ID 均有元数据（源表已知缺口除外）', () => {
  // legacyfix asset_indexes.json 自身缺 1.7.3/1.7.4/1.7.10/14w25a/14w31a（version_data 引用了它们）——
  // 属上游数据缺口，Attic 版本范围（≤13w12~ + 4k）不受影响，逐字移植不补造数据。
  const KNOWN_SOURCE_GAPS = new Set(['1.7.3', '1.7.4', '1.7.10', '14w25a', '14w31a']);
  const referenced = [
    'c0.0.22a_01', '20100124', '20100212', '20100607', 'a1.0.3', 'a1.0.8', 'a1.0.9', 'a1.0.12',
    'a1.0.14', 'a1.2.0', 'a1.2.0_02', 'b1.2', 'b1.4', 'b1.5', 'b1.7', '1.0.0-rc1', '1.2', '1.4',
    '1.6', '13w16a', '13w19a', '13w22a', '13w24a', '13w42a', '1.7.2', '24w20a',
  ];
  for (const id of referenced) {
    assert.ok(ASSET_INDEXES[id], `缺索引元数据：${id}`);
    assert.match(ASSET_INDEXES[id].sha1, /^[0-9a-f]{40}$/);
  }
  for (const gap of KNOWN_SOURCE_GAPS) assert.ok(!ASSET_INDEXES[gap]);
});

test('downloadAssetObjects：size 相符跳过、缺失下载并 sha1 校验、错尺寸重下', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'attic-assets-'));
  try {
    const contentA = 'object-a';
    const contentB = 'object-b-longer';
    const hashA = sha1(contentA);
    const hashB = sha1(contentB);
    const indexId = 'test_index';
    fs.mkdirSync(path.join(root, 'assets', 'indexes'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'assets', 'indexes', `${indexId}.json`),
      JSON.stringify({
        objects: {
          'sound/a.ogg': { hash: hashA, size: contentA.length },
          'sound/b.ogg': { hash: hashB, size: contentB.length },
        },
      }),
    );

    // 预置 A（正确尺寸）→ 不应再请求；预置错误尺寸的 B 不存在路径 → 下载。
    const objDirA = path.join(root, 'assets', 'objects', hashA.slice(0, 2));
    fs.mkdirSync(objDirA, { recursive: true });
    fs.writeFileSync(path.join(objDirA, hashA), contentA);

    const requested = [];
    const client = new BetacraftClient({
      fetchImpl: async (url) => {
        requested.push(url);
        return new Response(Buffer.from(contentB));
      },
    });
    await client.downloadAssetObjects(root, indexId);

    assert.equal(requested.length, 1);
    assert.ok(requested[0].endsWith(`/${hashB.slice(0, 2)}/${hashB}`));
    const destB = path.join(root, 'assets', 'objects', hashB.slice(0, 2), hashB);
    assert.equal(fs.readFileSync(destB, 'utf8'), contentB);
    assert.equal(fs.readFileSync(path.join(objDirA, hashA), 'utf8'), contentA);

    // 错尺寸（截断损坏）→ 重新下载覆盖。
    fs.writeFileSync(destB, 'x'.repeat(3));
    requested.length = 0;
    await client.downloadAssetObjects(root, indexId);
    assert.equal(requested.length, 1);
    assert.equal(fs.readFileSync(destB, 'utf8'), contentB);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
