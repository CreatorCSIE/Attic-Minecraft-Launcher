// 设置映射断言：新键回环、布尔三态、managed 键清理与 auto 内存估算公式（契约四地点同步的测试侧闸门）。
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { settingsFromProps, applySettingsToProps, estimateMaxMemoryMb, maskSecrets } = require('../dist/index.js');

test('AppSettings 新键回环：写入 launcher.settings 属性再读出形状不变', () => {
  const settings = {
    javaPath: 'C:/java/bin/java.exe',
    maxMemoryMb: 2048,
    memoryMode: 'auto',
    username: 'steve',
    theme: 'dark',
    language: 'zh-CN',
    jvmArgs: '-XX:+UseSerialGC',
    checkIntegrity: false,
    fixMissing: true,
    minimizeOnLaunch: false,
    diagnosticLog: true,
    consoleOnLaunch: false,
    rootOverride: 'D:/AtticData',
    levelServer: 'local',
    endpoints: { versionList: 'https://example.test/version_list.txt' },
  };
  const props = applySettingsToProps({}, settings);
  assert.equal(props['checkIntegrity'], 'false');
  assert.equal(props['consoleOnLaunch'], 'false');
  assert.equal(props['endpoint.versionList'], 'https://example.test/version_list.txt');
  assert.deepEqual(settingsFromProps(props), settings);
});

test('布尔三态：缺键=undefined（消费端缺省），true/false 显式保留', () => {
  assert.equal(settingsFromProps({}).checkIntegrity, undefined);
  assert.equal(settingsFromProps({ checkIntegrity: 'true' }).checkIntegrity, true);
  assert.equal(settingsFromProps({ checkIntegrity: 'false' }).fixMissing, undefined);
  assert.equal(settingsFromProps({ fixMissing: 'garbage' }).fixMissing, undefined);
  assert.equal(settingsFromProps({ diagnosticLog: 'false' }).diagnosticLog, false);
  assert.equal(settingsFromProps({ consoleOnLaunch: 'false' }).consoleOnLaunch, false);
  assert.equal(settingsFromProps({ consoleOnLaunch: 'true' }).consoleOnLaunch, true);
});

test('undefined 值删除 managed 键；v1 未知键原样保留', () => {
  const props = applySettingsToProps({ 'v1.legacy': 'keep', checkIntegrity: 'false' }, { checkIntegrity: undefined });
  assert.equal(props['v1.legacy'], 'keep');
  assert.equal('checkIntegrity' in props, false);
});

test('memoryMode 只认 auto/manual；其他值缺省省略', () => {
  assert.equal(settingsFromProps({ memoryMode: 'auto' }).memoryMode, 'auto');
  assert.equal(settingsFromProps({ memoryMode: 'whatever' }).memoryMode, undefined);
});

test('estimateMaxMemoryMb：40% 取 128 步长夹 [512,2048]，无宿主数据回落 1024', () => {
  assert.equal(estimateMaxMemoryMb(16384), 2048);
  assert.equal(estimateMaxMemoryMb(4096), 1664);
  assert.equal(estimateMaxMemoryMb(1024), 512);
  assert.equal(estimateMaxMemoryMb(0), 1024);
  assert.equal(estimateMaxMemoryMb(-1), 1024);
});

test('maskSecrets：长 token 全量替换 [censored sessionid]；短值/缺省不动（v1 脱敏语义）', () => {
  const token = 'eyJhbGciOiJIUzI1NiJ9.SIGNATURE.PAYLOAD';
  assert.equal(
    maskSecrets(`# command="java" --token ${token} --width 854`, token),
    `# command="java" --token [censored sessionid] --width 854`,
  );
  // 多次出现全部替换
  assert.equal(maskSecrets(`${token} x ${token}`, token), '[censored sessionid] x [censored sessionid]');
  // 离线短 token '0' 不替换（避免误伤通用子串）
  assert.equal(maskSecrets('gameArgs Player 0 -width 854', '0'), 'gameArgs Player 0 -width 854');
  assert.equal(maskSecrets('anything', undefined), 'anything');
  assert.equal(maskSecrets('anything', ''), 'anything');
});
