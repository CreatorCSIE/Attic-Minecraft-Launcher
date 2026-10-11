// 契约测试（TS 侧）：消费 fixtures/ 同一组夹具，断言 LaunchConfig 形状与跨字段不变量。
// Rust 侧（Phase 4）必须消费同一目录的同一组夹具——这是双壳防漂移的闸门（风险 #2）。
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { IPC_CHANNELS, IPC_EVENTS } = require('../dist/index.js');

const AGENT_FORMS = new Set(['javaagent', 'coremod', 'mod']);

function loadFixtures() {
  const dir = path.join(__dirname, '..', 'fixtures');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: f, fixture: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));
}

const fixtures = loadFixtures();

test('夹具目录非空', () => {
  assert.ok(fixtures.length >= 3, `至少 3 个夹具，实得 ${fixtures.length}`);
});

for (const { file, fixture } of fixtures) {
  test(`夹具 ${file}：形状与不变量`, () => {
    const { context, versionJson, expected } = fixture;
    assert.ok(fixture.name && fixture.description, 'name/description 必填');
    assert.ok(context && versionJson && expected, 'context/versionJson/expected 必填');

    // LaunchConfig 形状
    for (const key of ['javaPath', 'gameDir', 'assetsDir', 'mainClass']) {
      assert.equal(typeof expected[key], 'string', `expected.${key} 必须是字符串`);
    }
    for (const key of ['classpath', 'jvmArgs', 'gameArgs', 'agentMount']) {
      assert.ok(Array.isArray(expected[key]), `expected.${key} 必须是数组`);
    }
    assert.equal(typeof expected.maxMemoryMb, 'number');

    // agentMount 形状（版本数据侧与期望侧同一规则）
    const mounts = [...expected.agentMount, ...(versionJson.betacraft?.agentMount ?? [])];
    for (const m of mounts) {
      assert.ok(AGENT_FORMS.has(m.form), `非法 form: ${m.form}`);
      assert.equal(typeof m.path, 'string');
      assert.equal(typeof m.appliesFrom, 'string');
      if (m.appliesTo !== undefined) assert.equal(typeof m.appliesTo, 'string');
      if (m.quirk !== undefined) assert.equal(typeof m.quirk, 'string');
    }

    // 不变量 1：javaagent 挂载数 == jvmArgs 中 -javaagent: 参数数
    const javaagentMounts = expected.agentMount.filter((m) => m.form === 'javaagent');
    const javaagentArgs = expected.jvmArgs.filter((a) => a.startsWith('-javaagent:'));
    assert.equal(javaagentArgs.length, javaagentMounts.length, 'javaagent 挂载与 JVM 参数数量必须一致');

    // 不变量 2：每个 javaagent 展开为 -javaagent:<dataDir>/<path>=<gameDir>
    for (const m of javaagentMounts) {
      assert.ok(
        expected.jvmArgs.includes(`-javaagent:${context.dataDir}/${m.path}=${expected.gameDir}`),
        `缺少展开参数: -javaagent:${context.dataDir}/${m.path}=${expected.gameDir}`,
      );
    }

    // 不变量 3：coremod/mod 形态不得产生 -javaagent 参数（落位是文件操作）
    for (const m of expected.agentMount.filter((x) => x.form !== 'javaagent')) {
      assert.ok(!javaagentArgs.some((a) => a.includes(m.path)), `${m.form} 形态不应出现在 jvmArgs`);
    }

    // 不变量 4：内存上限参数与 maxMemoryMb 一致
    assert.ok(expected.jvmArgs.includes(`-Xmx${expected.maxMemoryMb}m`), 'jvmArgs 必须含 -Xmx<maxMemoryMb>m');

    // 不变量 5：classpath 首位是版本 jar（versions/<id>/<id>.jar）
    assert.ok(
      expected.classpath[0].includes(`versions/${versionJson.id}/${versionJson.id}.jar`),
      `classpath[0] 必须是版本 jar，实得 ${expected.classpath[0]}`,
    );

    // 不变量 6：游戏参数首位是用户名
    assert.equal(expected.gameArgs[0], context.username);

    // 不变量 7：代理参数全量进 jvmArgs
    for (const p of versionJson.betacraft?.proxyArgs ?? []) {
      assert.ok(expected.jvmArgs.includes(p), `proxyArgs 未进 jvmArgs: ${p}`);
    }

    // 不变量 8：期望挂载 == 版本数据挂载（夹具版本全部落在适用区间内）
    assert.deepEqual(expected.agentMount, versionJson.betacraft?.agentMount ?? []);
  });
}

test('IPC 通道与事件名唯一且非空', () => {
  const channels = Object.values(IPC_CHANNELS);
  const events = Object.values(IPC_EVENTS);
  assert.ok(channels.length >= 9 && events.length === 3);
  for (const c of [...channels, ...events]) {
    assert.match(c, /^attic:[a-z0-9:\-]+$/);
  }
  assert.equal(new Set([...channels, ...events]).size, channels.length + events.length, '通道名不得重复');
});
