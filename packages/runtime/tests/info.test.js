'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { infoToVersionJson, parseProperties, LAUNCH_METHOD_MAIN_CLASS } = require('../dist/index.js');

// 2026-10 实测线上 b1.7.3 .info 原文（files.betacraft.uk）。
const REAL_B173_INFO = [
  'release-date:1310111031000',
  'compile-date:1310110334000',
  'url:https://launcher.mojang.com/v1/objects/43db9b498cb67058d2e12d394e6507722e71bb45/client.jar',
  'launch-method:indev',
  'launch-method-link:',
  'proxy-args:-Dhttp.proxyHost=betacraft.uk -Dhttp.proxyPort=11705',
  'other-name:',
  'protocolVersion:beta_14',
  'file-ver:1',
].join('\n');

test('真实 .info → VersionJson（字段集照 v1 ReleaseJson.java）', () => {
  const json = infoToVersionJson('b1.7.3', parseProperties(REAL_B173_INFO));
  assert.equal(json.id, 'b1.7.3');
  assert.equal(json.jar.url, 'https://launcher.mojang.com/v1/objects/43db9b498cb67058d2e12d394e6507722e71bb45/client.jar');
  assert.equal(json.releaseTime, new Date(1310111031000).toISOString());
  assert.equal(json.time, new Date(1310110334000).toISOString());
  assert.deepEqual(json.betacraft.proxyArgs, ['-Dhttp.proxyHost=betacraft.uk', '-Dhttp.proxyPort=11705']);
  assert.equal(json.betacraft.launchMethod, 'indev');
  assert.equal(json.betacraft.launchMethodLink, undefined);
  assert.equal(json.betacraft.protocolVersion, 'beta_14');
  assert.equal(json.betacraft.fileVer, 1);
  // launch-method 表推导主类（真实 .info 无 main-class）
  assert.equal(json.mainClass, 'net.minecraft.client.Minecraft');
});

test('proxy-args 缺省 = v1 默认单参数', () => {
  const json = infoToVersionJson('c2.0', parseProperties('url:http://x/c2.0.jar'));
  assert.deepEqual(json.betacraft.proxyArgs, ['-Dhttp.proxyHost=betacraft.uk']);
});

test('main-class 显式字段优先于推导表', () => {
  const json = infoToVersionJson(
    'b1.7.3',
    parseProperties('launch-method:indev\nmain-class:com.example.Custom'),
  );
  assert.equal(json.mainClass, 'com.example.Custom');
});

test('Applet 容器方法映射到 legacyfix AppletLauncher（实测全集键）', () => {
  for (const method of [
    'preclassic',
    'classic12a',
    'classic',
    'ClassicWithSaving',
    'Classic15aWithSaving',
    'ClassicMpWithSaving',
  ]) {
    assert.equal(LAUNCH_METHOD_MAIN_CLASS[method], 'uk.betacraft.legacyfix.applet.AppletLauncher');
  }
});
