// 拼装器行为断言：对 core-spec 同一组夹具产出 expected（双壳防漂移闸门的 TS 侧，风险 #2）。
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { assembleLaunchConfig, filterAgentMounts, APPLET_LAUNCHER_CLASS } = require('../dist/index.js');

const FIXTURES_DIR = path.join(path.dirname(require.resolve('@attic/core-spec/package.json')), 'fixtures');

function loadFixtures() {
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, f), 'utf8')));
}

for (const fixture of loadFixtures()) {
  test(`夹具 ${fixture.name}：拼装输出 == expected`, () => {
    const config = assembleLaunchConfig(fixture.versionJson, fixture.context);
    assert.deepEqual(config, fixture.expected);
  });
}

test('区间过滤：不在适用区间的挂载被剔除', () => {
  const versionOrder = ['c0.0.13a', 'c2.0', 'b1.7.3', '1.5.2'];
  const mounts = [
    { form: 'javaagent', path: 'legacyfix/lf.jar', appliesFrom: 'c0.0.13a', appliesTo: 'c2.0' },
    { form: 'mod', path: 'legacyfix/lf.jar', appliesFrom: '1.5.2', appliesTo: '1.5.2' },
  ];
  const kept = filterAgentMounts(mounts, 'b1.7.3', versionOrder);
  assert.deepEqual(kept, []);
});

test('区间过滤：判定失败 fail-open + 诊断', () => {
  const diagnostics = [];
  const mounts = [{ form: 'javaagent', path: 'legacyfix/lf.jar', appliesFrom: 'c0.0.13a', appliesTo: 'c2.0' }];
  const kept = filterAgentMounts(mounts, 'unknown-id', ['c0.0.13a', 'c2.0'], undefined, (m) => diagnostics.push(m));
  assert.deepEqual(kept, mounts);
  assert.equal(diagnostics.length, 1);
});

test('未知占位符原样保留', () => {
  const versionJson = {
    id: 'b1.0',
    mainClass: 'net.minecraft.client.Minecraft',
    minecraftArguments: '${auth_player_name} ${totally_unknown}',
  };
  const context = baseContext();
  const config = assembleLaunchConfig(versionJson, context);
  assert.deepEqual(config.gameArgs, ['steve', '${totally_unknown}']);
});

test('extraJvmArgs 追加在固定组末尾；gameParams 以 --k v 追加', () => {
  const versionJson = { id: 'c2.0', mainClass: 'net.minecraft.client.Minecraft' };
  const context = baseContext();
  const config = assembleLaunchConfig(versionJson, context, {
    extraJvmArgs: ['-Dfoo=bar'],
    gameParams: { server: '1.2.3.4', port: '25565' },
  });
  assert.equal(config.jvmArgs[config.jvmArgs.length - 1], '-Dfoo=bar');
  assert.deepEqual(config.gameArgs.slice(-4), ['--server', '1.2.3.4', '--port', '25565']);
});

test('minMemoryMb 下发 -Xms 且进 LaunchConfig', () => {
  const versionJson = { id: 'c2.0', mainClass: 'net.minecraft.client.Minecraft' };
  const context = { ...baseContext(), minMemoryMb: 256 };
  const config = assembleLaunchConfig(versionJson, context);
  assert.equal(config.jvmArgs[1], '-Xms256m');
  assert.equal(config.minMemoryMb, 256);
});

test('Applet 容器主类：javaagent jar 同时进 classpath；剔 launchwrapper；deawt 保持开启', () => {
  const versionJson = {
    id: 'c0.0.15a',
    mainClass: 'uk.betacraft.legacyfix.applet.AppletLauncher',
    betacraft: {
      proxyArgs: ['-Dhttp.proxyHost=betacraft.uk'],
      agentMount: [{ form: 'javaagent', path: 'legacyfix/lf.jar', appliesFrom: 'c0.0.13a' }],
    },
  };
  const context = {
    ...baseContext(),
    binPool: ['/data/bin/lwjgl-2.9.0.jar', '/data/bin/launchwrapper-1.5.jar'],
  };
  const config = assembleLaunchConfig(versionJson, context);
  assert.ok(config.classpath.includes('/data/legacyfix/lf.jar'));
  // legacyfix agent 见 classpath 上有 LaunchWrapper 即提前 return 跳过全部补丁（c0.0.12a 窗口事故）。
  assert.ok(!config.classpath.some((jar) => jar.includes('launchwrapper')));
  // deawt 保持开启（实测窗口正常）：关窗后 MainWindowHandle 归零，壳侧看门狗据此终止空转进程。
  assert.ok(!config.jvmArgs.some((a) => a.includes('deawt')));
});

test('非 Applet 容器：保留 launchwrapper、不加 deawt 开关', () => {
  const versionJson = { id: 'b1.7.3', mainClass: 'net.minecraft.launchwrapper.Launch' };
  const context = { ...baseContext(), binPool: ['/data/bin/launchwrapper-1.5.jar'] };
  const config = assembleLaunchConfig(versionJson, context);
  assert.ok(config.classpath.includes('/data/bin/launchwrapper-1.5.jar'));
  assert.ok(!config.jvmArgs.some((a) => a.includes('deawt')));
});

test('主类缺失（launch-method 不在表）→ 显式报错不静默兜底', () => {
  const versionJson = { id: '4k-0144', betacraft: { proxyArgs: [], launchMethod: '4k' } };
  assert.throws(
    () => assembleLaunchConfig(versionJson, baseContext()),
    /无法确定主类.*4k/,
  );
});

test('levelServer：proxyArgs 后、javaagent 前注入 -Dlf.proxy.levelServer；缺省不注入', () => {
  const versionJson = {
    id: 'b1.7.3',
    mainClass: 'net.minecraft.client.Minecraft',
    betacraft: {
      proxyArgs: ['-Dhttp.proxyHost=betacraft.uk'],
      agentMount: [{ form: 'javaagent', path: 'legacyfix/lf.jar' }],
    },
  };
  const withLs = assembleLaunchConfig(versionJson, { ...baseContext(), levelServer: 'local' });
  const idxProxy = withLs.jvmArgs.indexOf('-Dhttp.proxyHost=betacraft.uk');
  const idxLs = withLs.jvmArgs.indexOf('-Dlf.proxy.levelServer=local');
  const idxAgent = withLs.jvmArgs.findIndex((a) => a.startsWith('-javaagent:'));
  assert.ok(idxProxy >= 0 && idxLs === idxProxy + 1 && idxLs < idxAgent);
  const without = assembleLaunchConfig(versionJson, baseContext());
  assert.ok(!without.jvmArgs.some((a) => a.includes('lf.proxy.levelServer')));
});

test('实例 launchArgs 紧随固定 -Xmx 注入；Applet 容器 gameArgs 末尾带 --width/--height，非 Applet 不带', () => {
  const appletJson = { id: 'c0.0.15a', mainClass: APPLET_LAUNCHER_CLASS };
  const context = { ...baseContext(), launchArgs: '-Xmx1G -XX:+UseG1GC', width: 854, height: 480 };
  const config = assembleLaunchConfig(appletJson, context);
  assert.equal(config.jvmArgs[0], '-Xmx1024m');
  assert.equal(config.jvmArgs[1], '-Xmx1G');
  assert.equal(config.jvmArgs[2], '-XX:+UseG1GC');
  const tail = config.gameArgs.slice(-4);
  assert.deepEqual(tail, ['--width', '854', '--height', '480']);

  const betaConfig = assembleLaunchConfig({ id: 'b1.7.3', mainClass: 'net.minecraft.client.Minecraft' }, context);
  assert.ok(!betaConfig.gameArgs.includes('--width'));
  assert.ok(betaConfig.jvmArgs.includes('-Xmx1G'));
});

function baseContext() {
  return {
    javaPath: '/opt/java/zulu8/bin/java',
    gameDir: '/game/x',
    assetsDir: '/game/assets',
    dataDir: '/data',
    username: 'steve',
    uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5',
    accessToken: '0',
    maxMemoryMb: 1024,
    binPool: [],
    versionOrder: ['c0.0.13a', 'c2.0', 'b1.7.3', '1.5.2'],
  };
}
