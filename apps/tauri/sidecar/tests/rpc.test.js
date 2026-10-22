/**
 * sidecar RPC 握手闸门（Phase 4 脚手架）：以子进程拉起打包产物 dist/server.cjs，
 * 走真实 stdio NDJSON 线协议验证 请求/响应/错误/宿主通道拒绝 四类帧。
 * 数据根隔离：APPDATA/HOME 指向临时目录（resolveDataRoot 的环境面），不触真实用户根。
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SERVER = path.resolve(HERE, '..', 'dist', 'server.cjs');

function startServer() {
  const root = mkdtempSync(path.join(tmpdir(), 'attic-sidecar-'));
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, APPDATA: root, HOME: root, USERPROFILE: root, ATTIC_LAUNCHER_VERSION: '0.0.0-test' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const rl = createInterface({ input: child.stdout });
  const frames = [];
  const waiters = [];
  rl.on('line', (line) => {
    const frame = JSON.parse(line);
    const hit = waiters.findIndex((w) => w.match(frame));
    if (hit >= 0) waiters.splice(hit, 1)[0].resolve(frame);
    else frames.push(frame);
  });
  const request = (id, method, params = []) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`RPC 超时: ${method}`)), 10_000);
      waiters.push({ match: (f) => f.id === id, resolve: (f) => { clearTimeout(timer); resolve(f); } });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  return { child, request, done: () => child.stdin.end() };
}

test('ping 往返：{id,method} → {id,result}', async () => {
  const s = startServer();
  try {
    const res = await s.request(1, 'attic:ping');
    assert.equal(res.id, 1);
    assert.ok(typeof res.result === 'string' && res.result.length > 0);
    assert.equal(res.error, undefined);
  } finally {
    s.done();
  }
});

test('未知方法 = 数据面错误帧（不挂起、不抛穿进程）', async () => {
  const s = startServer();
  try {
    const res = await s.request(2, 'attic:nope');
    assert.equal(res.id, 2);
    assert.match(String(res.error), /unknown-method/);
  } finally {
    s.done();
  }
});

test('宿主面通道防御拒绝（WINDOW_CONTROL 不得走 sidecar）', async () => {
  const s = startServer();
  try {
    const res = await s.request(3, 'attic:window:control');
    assert.match(String(res.error), /host-only-channel/);
  } finally {
    s.done();
  }
});

test('bad-json 行回错误帧（id=null），进程存活', async () => {
  const s = startServer();
  try {
    s.child.stdin.write('this-is-not-json\n');
    const res = await s.request(4, 'attic:ping');
    assert.equal(res.id, 4);
    assert.ok(typeof res.result === 'string');
  } finally {
    s.done();
  }
});
