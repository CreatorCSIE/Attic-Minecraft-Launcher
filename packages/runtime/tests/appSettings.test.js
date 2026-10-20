// 设置映射断言：新键回环、布尔三态、managed 键清理与 auto 内存估算公式（契约四地点同步的测试侧闸门）。
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { settingsFromProps, applySettingsToProps, estimateMaxMemoryMb } = require('../dist/index.js');

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
    rootOverride: 'D:/AtticData',
    levelServer: 'local',
    endpoints: { versionList: 'https://example.test/version_list.txt' },
  };
  const props = applySettingsToProps({}, settings);
  assert.equal(props['checkIntegrity'], 'false');
  assert.equal(props['endpoint.versionList'], 'https://example.test/version_list.txt');
  assert.deepEqual(settingsFromProps(props), settings);
});

test('布尔三态：缺键=undefined（消费端缺省），true/false 显式保留', () => {
  assert.equal(settingsFromProps({}).checkIntegrity, undefined);
  assert.equal(settingsFromProps({ checkIntegrity: 'true' }).checkIntegrity, true);
  assert.equal(settingsFromProps({ checkIntegrity: 'false' }).fixMissing, undefined);
  assert.equal(settingsFromProps({ fixMissing: 'garbage' }).fixMissing, undefined);
  assert.equal(settingsFromProps({ diagnosticLog: 'false' }).diagnosticLog, false);
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
