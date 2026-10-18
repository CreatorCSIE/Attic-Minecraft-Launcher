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
  scanInstalledInfos,
  scanInstalledJars,
  scanInstalledVersions,
  offlineUuid,
  binDir,
  versionsDir,
  jsonsDir,
  nativesDir,
  instancesDir,
  versionListCacheFile,
  AtticRuntime,
} = require('../dist/index.js');
const { buildJarBuffer } = require('./zipFixture.js');

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
  rt.addAccount('Tester'); // 无默认账户回落：启动前需显式建档
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
  assert.deepEqual(scanInstalledInfos(root), ['b1.7.3', 'c2.0']);
});

test('custom 语义（v1）：列表打标 + 裸 jar 检测合成 + Error 7 + 4k --appletClass', async (t) => {
  const root = tempRoot(t);
  ensureLayout(root);
  fs.writeFileSync(path.join(versionsDir(root), 'b1.7.3.jar'), buildJarBuffer([]));
  fs.writeFileSync(path.join(jsonsDir(root), 'b1.7.3.info'), 'launch-method=beta\n');
  // 裸 jar（有 jar 无 .info，classic 形态类）= custom（v1 offlineVersionList 语义）
  fs.writeFileSync(
    path.join(versionsDir(root), 'myver.jar'),
    buildJarBuffer(['com.mojang.minecraft.MinecraftApplet']),
  );
  // 无类可检测的裸 jar → Error 7 指引
  fs.writeFileSync(path.join(versionsDir(root), 'emptyver.jar'), buildJarBuffer(['com.example.Nothing']));
  // .info 显式声明 custom=true（无 jar：未安装但 custom）
  fs.writeFileSync(path.join(jsonsDir(root), 'declared.info'), 'launch-method=beta\ncustom=true\n');
  fs.writeFileSync(path.join(jsonsDir(root), '4k-021742.info'), 'launch-method=4k\n');

  const rt = new AtticRuntime({ rootDir: root, fetchImpl: () => Promise.reject(new Error('offline')) });
  // 离线兜底：远端失败 → 读缓存清单
  fs.writeFileSync(
    versionListCacheFile(root),
    JSON.stringify({
      generatedAt: Date.now(),
      versions: [
        { id: 'b1.7.3', repository: 'betacraft', installed: false },
        { id: 'myver', repository: 'betacraft', installed: false },
      ],
    }),
  );
  const java = 'C:\\Java\\jdk1.8\\bin\\java.exe';
  rt.addAccount('Tester'); // 无默认账户回落：启动前需显式建档

  const list = await rt.listVersions();
  const byId = Object.fromEntries(list.map((v) => [v.id, v]));
  assert.equal(byId['b1.7.3'].custom, undefined, 'jar+info 齐备 = 干净原版');
  assert.equal(byId['myver'].custom, true, '裸 jar = custom');
  assert.equal(byId['myver'].installed, true);
  assert.equal(byId['declared'].custom, true, '.info 声明 custom=true');
  assert.equal(byId['declared'].installed, false);
  assert.equal(byId['emptyver'].custom, true);

  // 裸 jar 启动：远端 404/离线 → 类检测合成（classic → AppletLauncher 容器）
  const cfgMy = await rt.dryRunLaunch({ versionId: 'myver', javaPath: java });
  assert.equal(cfgMy.mainClass, 'uk.betacraft.legacyfix.applet.AppletLauncher');
  // 检测失败 = Error 7 语义：显式报错并指引手编 .info
  await assert.rejects(rt.dryRunLaunch({ versionId: 'emptyver', javaPath: java }), /Error 7/);
  // 4k：显式启动方法数据路径（不依赖检测），gameArgs 末尾注入 --appletClass M
  const cfg4k = await rt.dryRunLaunch({ versionId: '4k-021742', javaPath: java });
  assert.deepEqual(cfg4k.gameArgs.slice(-2), ['--appletClass', 'M']);
});

test('indev 混代（用户报障修复）：按本地 jar 探测选主类——仅 Applet → AppletLauncher 容器', async (t) => {
  const root = tempRoot(t);
  ensureLayout(root);
  const INDEV_APPLET = 'net.minecraft.client.MinecraftApplet';
  const INDEV_MAIN = 'net.minecraft.client.Minecraft';
  fs.writeFileSync(path.join(jsonsDir(root), 'in-20100223.info'), 'launch-method=indev\n');
  fs.writeFileSync(path.join(jsonsDir(root), 'b-mix.info'), 'launch-method=indev\n');
  // 早期 indev 形态：仅 MinecraftApplet（无 main）→ 容器
  fs.writeFileSync(path.join(versionsDir(root), 'in-20100223.jar'), buildJarBuffer([INDEV_APPLET]));
  // beta+ 形态：两类齐备 → 维持 Minecraft 主类直启（不回归）
  fs.writeFileSync(path.join(versionsDir(root), 'b-mix.jar'), buildJarBuffer([INDEV_MAIN, INDEV_APPLET]));

  const rt = new AtticRuntime({ rootDir: root, fetchImpl: () => Promise.reject(new Error('offline')) });
  rt.addAccount('Tester'); // 无默认账户回落：启动前需显式建档
  const java = 'C:\\Java\\jdk1.8\\bin\\java.exe';

  const cfgApplet = await rt.dryRunLaunch({ versionId: 'in-20100223', javaPath: java });
  assert.equal(cfgApplet.mainClass, 'uk.betacraft.legacyfix.applet.AppletLauncher');
  // 容器形态：AppletFrame 尺寸参数注入（--width/--height 归 gameArgs 末尾）
  assert.deepEqual(cfgApplet.gameArgs.slice(-4), ['--width', '854', '--height', '480']);

  const cfgMain = await rt.dryRunLaunch({ versionId: 'b-mix', javaPath: java });
  assert.equal(cfgMain.mainClass, 'net.minecraft.client.Minecraft');
});

test('offlineUuid：确定性 + MC 离线格式（version 3 / variant 2）', () => {
  const a = offlineUuid('steve');
  assert.equal(a, offlineUuid('steve'));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
