'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { BetacraftClient, parseVersionList, eraForDate } = require('../dist/index.js');

function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

function fakeFetch(routes) {
  return async (url) => {
    const entry = routes[url];
    if (entry === undefined) return new Response('not found', { status: 404 });
    if (typeof entry === 'string') {
      return new Response(entry, {
        status: 200,
        headers: { 'content-length': String(Buffer.byteLength(entry)) },
      });
    }
    return new Response(JSON.stringify(entry), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

function tempRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attic-bc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('parseVersionList：真实行形状（反引号分隔，4/5 字段混排）', () => {
  const text = [
    'c0.0.15a-05311904`Multiplayer Test 1`1243796664000`1243796740000`15a-05311904',
    '4k-021742``1259775720000`1259775720000',
    '',
  ].join('\n');
  const refs = parseVersionList(text);
  assert.equal(refs.length, 2);
  assert.deepEqual(refs[0], {
    id: 'c0.0.15a-05311904',
    repository: 'betacraft',
    displayName: 'Multiplayer Test 1',
    compileDate: 1243796664000,
    releaseDate: 1243796740000,
    era: 'classic',
    installed: false,
  });
  assert.equal(refs[1].displayName, undefined);
});

test('parseVersionList：数据缺陷矫正（双 0 日期归位 + 4k 单开年代组）', () => {
  const text = [
    'b1.2_02-dev-20110517``0`0',
    '2.0-preview``0`0',
    '4k-0144``1259891046000`1259891046000',
    'b1.2_02``1295618254000`1295618277000',
    '2.0-red``1364841286000`1364841286001',
  ].join('\n');
  const by = new Map(parseVersionList(text).map((r) => [r.id, r]));
  // 双 0 不再误归 pre-classic：dev 版按 id 日期归 Beta 且排在 b1.2_02 后
  assert.equal(by.get('b1.2_02-dev-20110517').era, 'beta');
  assert.ok(by.get('b1.2_02-dev-20110517').compileDate > by.get('b1.2_02').compileDate);
  // 2.0-preview 归 Release 且紧随 2.0-red 前
  assert.equal(by.get('2.0-preview').era, 'release-1.0-1.5.2');
  assert.ok(by.get('2.0-preview').compileDate < by.get('2.0-red').compileDate);
  // 4k-* 单开年代组
  assert.equal(by.get('4k-0144').era, '4k');
});

test('eraForDate：年代边界（编译日期）', () => {
  assert.equal(eraForDate(1242245460000), 'pre-classic'); // rd-20090513
  assert.equal(eraForDate(1243796664000), 'classic'); // c0.0.15a
  assert.equal(eraForDate(1261580346000), 'indev'); // in-20091223
  assert.equal(eraForDate(1270137600000), 'infdev'); // 2010-04
  assert.equal(eraForDate(1277856000000), 'alpha'); // 2010-06-30
  assert.equal(eraForDate(1292866740000), 'beta'); // b1.0
  assert.equal(eraForDate(1310110334000), 'beta'); // b1.7.3
  assert.equal(eraForDate(1368748800000), 'release-1.0-1.5.2'); // 1.5.2
});

test('download：成功路径事件序 + 落盘内容', async (t) => {
  const root = tempRoot(t);
  const events = [];
  const content = 'JARBYTES';
  const client = new BetacraftClient({
    fetchImpl: fakeFetch({ 'http://x/client.jar': content }),
    onProgress: (e) => events.push(e),
  });
  const dest = path.join(root, 'versions', 'b1.7.3.jar');
  await client.download('http://x/client.jar', dest, 'client-jar', 'b1.7.3', {
    algo: 'sha1',
    value: sha1(content),
  });
  assert.equal(fs.readFileSync(dest, 'utf8'), content);
  const phases = events.map((e) => e.phase);
  assert.equal(phases[0], 'queued');
  assert.ok(phases.includes('verifying'));
  assert.equal(phases[phases.length - 1], 'done');
});

test('download：sha1 不符 → failed 事件 + 删文件 + 抛错', async (t) => {
  const root = tempRoot(t);
  const events = [];
  const client = new BetacraftClient({
    fetchImpl: fakeFetch({ 'http://x/bad.jar': 'CORRUPT' }),
    onProgress: (e) => events.push(e),
  });
  const dest = path.join(root, 'versions', 'bad.jar');
  await assert.rejects(
    () => client.download('http://x/bad.jar', dest, 'client-jar', 'bad', { algo: 'sha1', value: '0'.repeat(40) }),
    /sha1 校验失败/,
  );
  assert.equal(fs.existsSync(dest), false);
  const failed = events.find((e) => e.phase === 'failed');
  assert.ok(failed && /sha1/.test(failed.error));
});

test('downloadClientJar：本地已存在且 sha1 相符则不重下', async (t) => {
  const root = tempRoot(t);
  const content = 'LOCAL';
  const digest = sha1(content);
  fs.mkdirSync(path.join(root, 'versions'), { recursive: true });
  fs.writeFileSync(path.join(root, 'versions', 'c2.0.jar'), content);
  let fetched = 0;
  const client = new BetacraftClient({
    fetchImpl: async (url) => {
      fetched++;
      return fakeFetch({ [url]: content })(url);
    },
  });
  await client.downloadClientJar({ id: 'c2.0', jar: { url: 'http://x/c2.0.jar', sha1: digest } }, root);
  assert.equal(fetched, 0);
});

test('downloadClientJar：verify=false 存在即复用（损坏也不复核）', async (t) => {
  const root = tempRoot(t);
  fs.mkdirSync(path.join(root, 'versions'), { recursive: true });
  fs.writeFileSync(path.join(root, 'versions', 'c2.0.jar'), 'CORRUPT');
  let fetched = 0;
  const client = new BetacraftClient({
    fetchImpl: async (url) => {
      fetched++;
      return fakeFetch({ [url]: 'GOOD' })(url);
    },
  });
  await client.downloadClientJar({ id: 'c2.0', jar: { url: 'http://x/c2.0.jar', sha1: sha1('GOOD') } }, root, { verify: false });
  assert.equal(fetched, 0);
  assert.equal(fs.readFileSync(path.join(root, 'versions', 'c2.0.jar'), 'utf8'), 'CORRUPT');
});

test('downloadClientJar：repair=false 复核不符显式抛错（不静默覆盖）', async (t) => {
  const root = tempRoot(t);
  fs.mkdirSync(path.join(root, 'versions'), { recursive: true });
  fs.writeFileSync(path.join(root, 'versions', 'c2.0.jar'), 'CORRUPT');
  const client = new BetacraftClient({ fetchImpl: fakeFetch({ 'http://x/c2.0.jar': 'GOOD' }) });
  await assert.rejects(
    () => client.downloadClientJar({ id: 'c2.0', jar: { url: 'http://x/c2.0.jar', sha1: sha1('GOOD') } }, root, { repair: false }),
    /校验不符.*自动补全已禁用/,
  );
  assert.equal(fs.readFileSync(path.join(root, 'versions', 'c2.0.jar'), 'utf8'), 'CORRUPT');
});

test('downloadClientJar：repair=false 缺失显式抛错（不擅自下载）', async (t) => {
  const root = tempRoot(t);
  const client = new BetacraftClient({ fetchImpl: fakeFetch({ 'http://x/c2.0.jar': 'GOOD' }) });
  await assert.rejects(
    () => client.downloadClientJar({ id: 'c2.0', jar: { url: 'http://x/c2.0.jar', sha1: sha1('GOOD') } }, root, { repair: false }),
    /缺失.*自动补全已禁用/,
  );
});

test('downloadClientJar：缺省行为损坏时自动重下修复', async (t) => {
  const root = tempRoot(t);
  fs.mkdirSync(path.join(root, 'versions'), { recursive: true });
  fs.writeFileSync(path.join(root, 'versions', 'c2.0.jar'), 'CORRUPT');
  const client = new BetacraftClient({ fetchImpl: fakeFetch({ 'http://x/c2.0.jar': 'GOOD' }) });
  await client.downloadClientJar({ id: 'c2.0', jar: { url: 'http://x/c2.0.jar', sha1: sha1('GOOD') } }, root);
  assert.equal(fs.readFileSync(path.join(root, 'versions', 'c2.0.jar'), 'utf8'), 'GOOD');
});

test('ensureLegacyfix：GitHub Release 构件匹配 + 下载落位', async (t) => {
  const root = tempRoot(t);
  const jar = 'LEGACYFIX';
  const client = new BetacraftClient({
    fetchImpl: fakeFetch({
      'https://api.github.com/repos/betacraftuk/legacyfix/releases/latest': {
        assets: [{ name: 'legacyfix.jar', browser_download_url: 'http://x/legacyfix.jar' }],
      },
      'http://x/legacyfix.jar': jar,
    }),
  });
  const dest = await client.ensureLegacyfix(root, 'legacyfix/legacyfix.jar');
  assert.equal(dest, path.join(root, 'legacyfix', 'legacyfix.jar'));
  assert.equal(fs.readFileSync(dest, 'utf8'), jar);
});
