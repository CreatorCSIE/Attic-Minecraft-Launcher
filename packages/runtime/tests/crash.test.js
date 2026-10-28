'use strict';

// 启动器层崩溃取证单测（P0~P2）：launcher.log 行形状与滚动 / 尾部截断 / bundle 组装 /
// 脏退出标记读写消费 / issues 链接数据驱动 / runtime 门面（lastCrash 消费、logRendererError、crashBundleResult）。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  AtticRuntime,
  launcherLogLine,
  tailLines,
  crashSummary,
  buildCrashBundle,
  crashIssuesUrl,
  crashMarkerFile,
  writeCrashMarker,
  consumeCrashMarker,
  CRASH_LOG_TAIL_LINES,
  CRASH_MARKER_STACK_MAX,
  LAUNCHER_LOG_MAX_BYTES,
} = require('../dist/index.js');

function tempRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attic-crash-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---------- launcher.log 行形状 ----------

test('launcherLogLine：(时间戳) [OUT/ERR] 前缀，多行块逐行落', () => {
  const at = new Date('2026-10-28T01:02:03.456Z');
  assert.equal(launcherLogLine('out', 'hello', at), '(01:02:03.456) [OUT] hello');
  assert.equal(launcherLogLine('err', 'boom', at), '(01:02:03.456) [ERR] boom');
  const multi = launcherLogLine('out', 'a\r\nb\n', at);
  assert.deepEqual(multi.split('\n'), ['(01:02:03.456) [OUT] a', '(01:02:03.456) [OUT] b']);
});

test('tailLines：取尾 n 行、去尾空行', () => {
  const text = Array.from({ length: 300 }, (_, i) => `l${i}`).join('\n');
  const tail = tailLines(text, 200);
  assert.equal(tail.split('\n').length, 200);
  assert.ok(tail.startsWith('l100'));
  assert.ok(tail.endsWith('l299'));
  assert.equal(tailLines('a\nb\n\n', 10), 'a\nb');
  assert.equal(tailLines('', 10), '');
});

test('crashSummary：栈首非空行、超长截断', () => {
  assert.equal(crashSummary('TypeError: x is not a function\n    at foo'), 'TypeError: x is not a function');
  assert.equal(crashSummary('\n  Error: boom\nat'), 'Error: boom');
  assert.equal(crashSummary(''), 'unknown');
  const long = crashSummary('E'.repeat(200));
  assert.equal(long.length, 118); // 117 + …
  assert.ok(long.endsWith('…'));
});

// ---------- bundle 组装 ----------

test('buildCrashBundle：环境 + 栈 + 两日志尾 200 行截断', () => {
  const big = Array.from({ length: 500 }, (_, i) => `line${i}`).join('\n');
  const bundle = buildCrashBundle({
    launcherVersion: '0.0.5',
    shell: 'electron',
    versions: { electron: '33.0.0', chrome: '130.0', node: undefined },
    platform: 'win32',
    osRelease: '10.0.26100',
    arch: 'x64',
    category: 'uncaught-exception',
    stack: 'Error: boom\n    at fn',
    launcherLog: big,
    clientLog: '(空场景)',
    at: '2026-10-28T00:00:00.000Z',
  });
  assert.match(bundle, /启动器: v0\.0\.5 \(electron\)/);
  assert.match(bundle, /electron: 33\.0\.0/);
  assert.doesNotMatch(bundle, /node: undefined/);
  assert.match(bundle, /系统: win32 10\.0\.26100 \(x64\)/);
  assert.match(bundle, /---- 崩溃栈 ----\nError: boom/);
  assert.ok(bundle.includes('line499'));
  assert.ok(!bundle.includes('line298')); // 尾 200 行 = line300..499
  assert.ok(bundle.includes(`尾 ${CRASH_LOG_TAIL_LINES} 行`));
});

// ---------- issues 链接（数据驱动） ----------

test('crashIssuesUrl：repo 派生 + 编码；空 repo = 空串', () => {
  const url = crashIssuesUrl('Owner/Repo', '0.0.5', 'Error: 崩溃 & 摘要');
  assert.ok(url.startsWith('https://github.com/Owner/Repo/issues/new?title='));
  assert.ok(encodeURIComponent('[崩溃] v0.0.5 Error: 崩溃 & 摘要').length > 0);
  assert.ok(url.includes(encodeURIComponent('[崩溃] v0.0.5')));
  assert.ok(url.includes(encodeURIComponent('剪贴板')));
  assert.equal(crashIssuesUrl('', '0.0.5', 'x'), '');
  assert.equal(crashIssuesUrl(undefined, '0.0.5', 'x'), '');
});

// ---------- 脏退出标记 ----------

test('标记写读消费：一次消费、读后即删、坏形状回落 null', (t) => {
  const root = tempRoot(t);
  assert.equal(consumeCrashMarker(root), null);
  writeCrashMarker(root, { at: '2026-10-28T00:00:00.000Z', category: 'uncaught-exception', summary: 'Error: boom', stack: 'Error: boom\nat x' });
  assert.ok(fs.existsSync(crashMarkerFile(root)));
  const brief = consumeCrashMarker(root);
  assert.equal(brief.summary, 'Error: boom');
  assert.equal(brief.category, 'uncaught-exception');
  assert.equal(consumeCrashMarker(root), null); // 读后即删
  // 超长栈截断落盘
  writeCrashMarker(root, { at: 'x', category: 'c', summary: 's', stack: 'S'.repeat(CRASH_MARKER_STACK_MAX + 100) });
  assert.equal(consumeCrashMarker(root).stack.length, CRASH_MARKER_STACK_MAX);
  // 坏 JSON = null
  fs.mkdirSync(path.dirname(crashMarkerFile(root)), { recursive: true });
  fs.writeFileSync(crashMarkerFile(root), '{oops', 'utf8');
  assert.equal(consumeCrashMarker(root), null);
});

test('标记带 UTF-8 BOM（PowerShell Set-Content 手写场景）：剥 BOM 正常消费', (t) => {
  const root = tempRoot(t);
  fs.mkdirSync(path.dirname(crashMarkerFile(root)), { recursive: true });
  const json = JSON.stringify({ at: '2026-10-28T00:00:00.000Z', category: 'manual', summary: 'Error: bom', stack: 'Error: bom\nat x' });
  fs.writeFileSync(crashMarkerFile(root), '\uFEFF' + json, 'utf8');
  const brief = consumeCrashMarker(root);
  assert.equal(brief.summary, 'Error: bom');
  assert.equal(brief.category, 'manual');
});

// ---------- runtime 门面 ----------

test('runtime：崩溃标记经构造消费 → SYS_INFO.lastCrash 投出且只投一次', (t) => {
  const root = tempRoot(t);
  writeCrashMarker(root, { at: '2026-10-28T00:00:00.000Z', category: 'uncaught-exception', summary: 'Error: first', stack: 'Error: first\nat a' });
  const rt = new AtticRuntime({ rootDir: root, version: '9.9.9', releaseRepo: 'Owner/Repo' });
  assert.equal(rt.lastCrash.summary, 'Error: first');
  assert.equal(rt.getSystemInfo().lastCrash.category, 'uncaught-exception');
  assert.ok(rt.getSystemInfo().lastCrash.stack.includes('at a'));
  // 第二次构造（模拟下次正常启动）= 标记已被消费，缺席
  const rt2 = new AtticRuntime({ rootDir: root, version: '9.9.9' });
  assert.equal(rt2.lastCrash, null);
  assert.equal('lastCrash' in rt2.getSystemInfo(), false);
});

test('runtime：markCrashExit → appendLauncherLog → 新实例带出横幅数据（全链路）', (t) => {
  const root = tempRoot(t);
  const rt = new AtticRuntime({ rootDir: root, version: '0.0.5', releaseRepo: 'Owner/Repo' });
  rt.markCrashExit('unhandled-rejection', 'Error: rejected\n    at async fn');
  rt.appendLauncherLog('err', 'boom line');
  const file = rt.launcherLogPath();
  assert.ok(file.endsWith(path.join('launcher', 'logs', 'launcher.log')));
  const log = fs.readFileSync(file, 'utf8');
  assert.match(log, /\(\d{2}:\d{2}:\d{2}\.\d{3}\) \[ERR\] boom line/);
  const next = new AtticRuntime({ rootDir: root, version: '0.0.5' });
  assert.equal(next.lastCrash.category, 'unhandled-rejection');
  assert.equal(next.lastCrash.summary, 'Error: rejected');
});

test('runtime：logRendererError 静默落 launcher.log；crashBundleResult 含栈/日志尾/issuesUrl', (t) => {
  const root = tempRoot(t);
  const rt = new AtticRuntime({ rootDir: root, version: '0.0.5', releaseRepo: 'Owner/Repo' });
  rt.logRendererError({ source: 'vue-error', message: 'render fail', stack: 'Error: render fail\nat Comp' });
  const log = fs.readFileSync(rt.launcherLogPath(), 'utf8');
  assert.ok(log.includes('[renderer:vue-error] render fail'));
  // output-client.log 缺席 = 「(空)」占位
  fs.writeFileSync(path.join(root, 'launcher', 'logs', 'output-client.log'), 'client tail line\n', 'utf8');
  const res = rt.crashBundleResult('renderer:vue-error', 'Error: render fail\nat Comp');
  assert.ok(res.text.includes('Error: render fail'));
  assert.ok(res.text.includes('[renderer:vue-error] render fail'));
  assert.ok(res.text.includes('client tail line'));
  assert.ok(res.issuesUrl.includes('https://github.com/Owner/Repo/issues/new'));
  // repo 未配置（显式空串）→ issuesUrl 空串（UI 隐藏报告钮）
  const rt2 = new AtticRuntime({ rootDir: root, version: '0.0.5', releaseRepo: '' });
  assert.equal(rt2.crashBundleResult('c', 'Error: x').issuesUrl, '');
});

test('runtime：launcher.log 封顶截半滚动（append 语义防无界）', (t) => {
  const root = tempRoot(t);
  const rt = new AtticRuntime({ rootDir: root, version: '0.0.5' });
  const file = rt.launcherLogPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x'.repeat(LAUNCHER_LOG_MAX_BYTES + 10), 'utf8');
  rt.appendLauncherLog('out', 'after-trim');
  const size = fs.statSync(file).size;
  assert.ok(size < LAUNCHER_LOG_MAX_BYTES, `截半后应低于封顶，实=${size}`);
  assert.ok(fs.readFileSync(file, 'utf8').includes('after-trim'));
});
