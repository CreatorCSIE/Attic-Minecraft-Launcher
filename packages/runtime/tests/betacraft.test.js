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
