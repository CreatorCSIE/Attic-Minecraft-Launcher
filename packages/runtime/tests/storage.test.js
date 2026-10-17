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
  scanInstalledJars,
  scanInstalledVersions,
  offlineUuid,
  binDir,
  versionsDir,
  jsonsDir,
  nativesDir,
  instancesDir,
  AtticRuntime,
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

test('实例解耦（v1 语义）：gameDir=root/<实例名>，首启自动建 default instance，切版本目录不变', async (t) => {
  const root = tempRoot(t);
  ensureLayout(root);
  fs.writeFileSync(path.join(jsonsDir(root), 'b1.7.3.info'), 'launch-method=beta\n');
  fs.writeFileSync(path.join(jsonsDir(root), 'c2.0.info'), 'launch-method=beta\n');
  fs.writeFileSync(path.join(jsonsDir(root), 'c0.0.15a.info'), 'launch-method=classic\n');
  const rt = new AtticRuntime({ rootDir: root, fetchImpl: () => Promise.reject(new Error('offline')) });
  const java = 'C:\\Java\\jdk1.8\\bin\\java.exe';

  const cfg = await rt.dryRunLaunch({ versionId: 'b1.7.3', javaPath: java });
  assert.equal(cfg.gameDir, path.join(root, 'default instance'));
  assert.ok(fs.existsSync(path.join(instancesDir(root), 'default instance.txt')), '首启应自动建档 default instance');

  // v1 newInstance 缺省：老档案缺 width/height/launchArgs 也拿到 854x480 / -Xmx1G（而非 640x480 兜底）
  const def = loadInstance(root, 'default instance');
  assert.equal(def.width, 854);
  assert.equal(def.height, 480);
  assert.equal(def.launchArgs, '-Xmx1G');
  assert.ok(cfg.jvmArgs.includes('-Xmx1G'));
  // Applet 容器：实例窗口尺寸以 --width/--height 游戏参数注入 gameArgs 末尾（v1 Wrapper 面板尺寸语义）
  const cfgApplet = await rt.dryRunLaunch({ versionId: 'c0.0.15a', javaPath: java });
  assert.deepEqual(cfgApplet.gameArgs.slice(-4), ['--width', '854', '--height', '480']);

  // 同实例切版本：gameDir 不变（存档共享），目录不随版本漂移
  const cfg2 = await rt.dryRunLaunch({ versionId: 'c2.0', javaPath: java });
  assert.equal(cfg2.gameDir, cfg.gameDir);

  // saveInstance：v1 可编辑集全字段往返；gameDir 缺省按实例名派生
  rt.saveInstance({ name: '我的包', version: 'b1.7.3', width: 1024, height: 768, launchArgs: '-Xmx2G' });
  const mine = loadInstance(root, '我的包');
  assert.equal(mine.gameDir, path.join(root, '我的包'));
  assert.equal(mine.width, 1024);
  assert.equal(mine.height, 768);
  assert.equal(mine.launchArgs, '-Xmx2G');
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
  // "已安装"徽标真相源 = jar 实存：仅有 .info 的 c2.0 不算安装（用户指定）
  assert.deepEqual(scanInstalledJars(root), ['b1.7.3']);
});

test('offlineUuid：确定性 + MC 离线格式（version 3 / variant 2）', () => {
  const a = offlineUuid('steve');
  assert.equal(a, offlineUuid('steve'));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
