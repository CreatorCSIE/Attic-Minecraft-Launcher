'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  resolveDataRoot,
  ensureLayout,
  saveInstance,
  loadInstance,
  listInstances,
  scanBinPool,
  scanInstalledVersions,
  offlineUuid,
  binDir,
  versionsDir,
  jsonsDir,
  nativesDir,
  instancesDir,
} = require('../dist/index.js');

function tempRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attic-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('resolveDataRoot：三平台 + portable + override 优先级', () => {
  const win = resolveDataRoot({ platform: 'win32', env: { APPDATA: 'C:\\Users\\s\\AppData\\Roaming' } });
  assert.equal(win, path.win32.join('C:\\Users\\s\\AppData\\Roaming', '.attic'));

  const linux = resolveDataRoot({ platform: 'linux', env: { HOME: '/home/steve' } });
  assert.equal(linux, '/home/steve/.attic');

  const mac = resolveDataRoot({ platform: 'darwin', env: { HOME: '/Users/steve' } });
  assert.equal(mac, '/Users/steve/Library/Application Support/attic');

  const portable = resolveDataRoot({
    platform: 'win32',
    env: {},
    execPath: 'D:\\Attic\\attic.exe',
    portable: true,
  });
  assert.equal(portable, path.win32.join('D:\\Attic', '.attic'));

  const override = resolveDataRoot({ platform: 'win32', env: {}, rootDirOverride: 'E:\\.betacraft' });
  assert.equal(override, path.resolve('E:\\.betacraft'));
});

test('ensureLayout：目录骨架齐备且幂等', (t) => {
  const root = tempRoot(t);
  ensureLayout(root);
  ensureLayout(root);
  for (const dir of [instancesDir(root), binDir(root), nativesDir(root), versionsDir(root), jsonsDir(root)]) {
    assert.ok(fs.existsSync(dir), `缺目录 ${dir}`);
  }
});

test('实例配置：保存/读回/列出（v1 键集）', (t) => {
  const root = tempRoot(t);
  ensureLayout(root);
  const config = {
    name: 'b1.7.3',
    version: 'b1.7.3',
    gameDir: path.join(root, 'b1.7.3'),
    launchArgs: '-Xmx1G',
    width: 854,
    height: 480,
    proxy: true,
    keepopen: false,
    RPC: true,
    javaPath: 'C:\\Java\\jdk1.8\\bin\\java.exe',
  };
  saveInstance(root, config);
  assert.deepEqual(listInstances(root), ['b1.7.3']);
  assert.deepEqual(loadInstance(root, 'b1.7.3'), config);
  assert.equal(loadInstance(root, '不存在'), null);
});

test('扫描：bin 库池与已安装版本并集', (t) => {
  const root = tempRoot(t);
  ensureLayout(root);
  fs.writeFileSync(path.join(binDir(root), 'lwjgl-2.9.4.jar'), 'x');
  fs.writeFileSync(path.join(binDir(root), 'launchwrapper-1.12.jar'), 'x');
  fs.writeFileSync(path.join(binDir(root), 'notes.txt'), 'x');
  fs.writeFileSync(path.join(versionsDir(root), 'b1.7.3.jar'), 'x');
  fs.writeFileSync(path.join(jsonsDir(root), 'c2.0.info'), 'x');
  fs.writeFileSync(path.join(jsonsDir(root), 'b1.7.3.info'), 'x');

  assert.deepEqual(scanBinPool(root), [
    path.join(binDir(root), 'launchwrapper-1.12.jar'),
    path.join(binDir(root), 'lwjgl-2.9.4.jar'),
  ]);
  assert.deepEqual(scanInstalledVersions(root), ['b1.7.3', 'c2.0']);
});

test('offlineUuid：确定性 + MC 离线格式（version 3 / variant 2）', () => {
  const a = offlineUuid('steve');
  assert.equal(a, offlineUuid('steve'));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
