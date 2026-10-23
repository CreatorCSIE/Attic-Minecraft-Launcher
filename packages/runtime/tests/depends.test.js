// BC 基础库集（depends）：v1 downloadDepends 移植的解析/核对/重拉/自愈语义（全 mock IO + 合成 zip）。
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  dependsOsFor,
  parseDependsVersion,
  hasLocalDepends,
  isDependsCurrent,
  ensureDepends,
  writeZipEntries,
  DEFAULT_ENDPOINTS,
} = require('../dist/index.js');

// ---------- 纯函数 ----------

test('parseDependsVersion：v1 两行形状与缺行异常', () => {
  assert.deepEqual(parseDependsVersion('libs-version:13\nnatives-version:1\n'), { libs: '13', natives: '1' });
  // 冒号后含内容照收（值不透明）；CRLF 兼容
  assert.deepEqual(parseDependsVersion('libs-version:abc:def\r\nnatives-version:x\r\n'), { libs: 'abc:def', natives: 'x' });
  assert.throws(() => parseDependsVersion('libs-version:13\n'), /形状异常/);
  assert.throws(() => parseDependsVersion(''), /形状异常/);
});

test('dependsOsFor：Node platform → v1 平台轴', () => {
  assert.equal(dependsOsFor('win32'), 'windows');
  assert.equal(dependsOsFor('darwin'), 'osx');
  assert.equal(dependsOsFor('linux'), 'linux');
});

// ---------- 端到端（temp root + fake IO） ----------

/** 合成 libs/natives zip（stored 即可，extractZipTo 支持 method 0/8）。 */
function makeZips(dir) {
  const libs = path.join(dir, 'libs.zip');
  const natives = path.join(dir, 'natives.zip');
  writeZipEntries(libs, [
    { name: 'lwjgl.jar', method: 0, dosTime: 0, dosDate: 0, data: Buffer.from('fake-lwjgl') },
    { name: 'lwjgl_util.jar', method: 0, dosTime: 0, dosDate: 0, data: Buffer.from('fake-util') },
    { name: 'jinput.jar', method: 0, dosTime: 0, dosDate: 0, data: Buffer.from('fake-jinput') },
  ]);
  writeZipEntries(natives, [
    { name: 'lwjgl.dll', method: 0, dosTime: 0, dosDate: 0, data: Buffer.from('fake-dll') },
    { name: 'META-INF/MANIFEST.MF', method: 0, dosTime: 0, dosDate: 0, data: Buffer.from('Manifest-Version: 1.0') },
  ]);
  return { libs, natives };
}

function makeEnv(remoteText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'attic-depends-'));
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  const zips = makeZips(root);
  const state = {
    root,
    settings: {},
    downloads: [],
    saved: [],
    remoteText: remoteText ?? 'libs-version:13\nnatives-version:1\n',
    fetchFails: false,
    downloadFails: false,
  };
  const io = {
    root,
    os: 'windows',
    settings: state.settings,
    fetchText: async () => {
      if (state.fetchFails) throw new Error('offline');
      return state.remoteText;
    },
    download: async (url, dest) => {
      if (state.downloadFails) throw new Error('net fail');
      state.downloads.push(url);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(/\/libs-/.test(url) ? zips.libs : zips.natives, dest);
    },
    saveVersionKeys: (keys) => {
      Object.assign(state.settings, keys);
      state.saved.push({ ...keys });
    },
  };
  return { state, io };
}

test('首拉：下载双 zip → bin 库池 + natives 落位 → 版本号回写', async () => {
  const { state, io } = makeEnv();
  await ensureDepends(io, DEFAULT_ENDPOINTS);
  assert.equal(state.downloads.length, 2);
  assert.match(state.downloads[0], /libs-windows\.zip$/);
  assert.match(state.downloads[1], /natives-windows\.zip$/);
  assert.equal(fs.readFileSync(path.join(state.root, 'bin', 'lwjgl.jar'), 'utf8'), 'fake-lwjgl');
  assert.equal(fs.readFileSync(path.join(state.root, 'bin', 'natives', 'lwjgl.dll'), 'utf8'), 'fake-dll');
  assert.deepEqual(state.settings['libs-version'], '13');
  assert.deepEqual(state.settings['natives-version'], '1');
  assert.ok(hasLocalDepends(state.root));
});

test('幂等：版本号一致时二次调用零下载', async () => {
  const { state, io } = makeEnv();
  await ensureDepends(io, DEFAULT_ENDPOINTS);
  state.downloads.length = 0;
  io.settings = state.settings; // saveVersionKeys 写进了 state.settings，同步引用
  await ensureDepends(io, DEFAULT_ENDPOINTS);
  assert.equal(state.downloads.length, 0);
});

test('版本变更：重拉并清空旧库池（sentinel 消失）', async () => {
  const { state, io } = makeEnv();
  await ensureDepends(io, DEFAULT_ENDPOINTS);
  const sentinel = path.join(state.root, 'bin', 'stale-lib.jar');
  fs.writeFileSync(sentinel, 'stale');
  state.remoteText = 'libs-version:14\nnatives-version:1\n';
  state.downloads.length = 0;
  await ensureDepends(io, DEFAULT_ENDPOINTS);
  assert.equal(state.downloads.length, 2);
  assert.ok(!fs.existsSync(sentinel), '清池必须删除旧文件');
  assert.equal(fs.existsSync(path.join(state.root, 'bin', 'lwjgl.jar')), true);
  assert.equal(state.settings['libs-version'], '14');
});

test('离线：拿不到版本号但本地库集在位 → 不下载不抛（v1 assume-all-good）', async () => {
  const { state, io } = makeEnv();
  await ensureDepends(io, DEFAULT_ENDPOINTS);
  state.fetchFails = true;
  state.downloads.length = 0;
  await ensureDepends(io, DEFAULT_ENDPOINTS);
  assert.equal(state.downloads.length, 0);
});

test('离线 + 本地空：抛错（无法启动，v1 弹框失败语义）', async () => {
  const { state, io } = makeEnv();
  state.fetchFails = true;
  await assert.rejects(() => ensureDepends(io, DEFAULT_ENDPOINTS), /depends-version\.txt/);
});

test('force：版本号一致也重拉（实例强制更新语义）', async () => {
  const { state, io } = makeEnv();
  await ensureDepends(io, DEFAULT_ENDPOINTS);
  state.downloads.length = 0;
  await ensureDepends(io, DEFAULT_ENDPOINTS, { force: true });
  assert.equal(state.downloads.length, 2);
});

test('自愈：下载中途失败不留假指纹（版本号未写，下次重拉）', async () => {
  const { state, io } = makeEnv();
  state.downloadFails = true;
  await assert.rejects(() => ensureDepends(io, DEFAULT_ENDPOINTS), /net fail/);
  assert.equal(state.saved.length, 0);
  assert.ok(!isDependsCurrent(state.root, state.settings, { libs: '13', natives: '1' }));
  // 恢复网络后重拉成功
  state.downloadFails = false;
  await ensureDepends(io, DEFAULT_ENDPOINTS);
  assert.equal(state.settings['libs-version'], '13');
});
