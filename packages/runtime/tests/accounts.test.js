'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { AtticRuntime } = require('../dist/index.js');

function tempRuntime(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attic-acct-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new AtticRuntime({ rootDir: dir, fetchImpl: () => Promise.reject(new Error('no-net')) });
}

test('addAccount：MC 用户名规则校验（3-16 位字母/数字/下划线）', (t) => {
  const rt = tempRuntime(t);
  for (const bad of ['ab', 'a b', 'steve!', 'a'.repeat(17), '']) {
    assert.throws(() => rt.addAccount(bad), /无效用户名/, `应拒绝：${JSON.stringify(bad)}`);
  }
  const view = rt.addAccount('Steve_9');
  assert.equal(view.name, 'Steve_9');
  assert.equal(view.type, 'offline');
  assert.ok(view.id);
});

test('addAccount：同名幂等返回既有（不重复建档）', async (t) => {
  const rt = tempRuntime(t);
  const a = rt.addAccount('Notch');
  const b = rt.addAccount('Notch');
  assert.equal(a.id, b.id);
  const accounts = await rt.listAccounts();
  assert.equal(accounts.filter((x) => x.name === 'Notch').length, 1);
});

test('addAccount：首个真实账户落盘后不再回落默认 Player', async (t) => {
  const rt = tempRuntime(t);
  // 空 accounts.json：回落默认 Player。
  const before = await rt.listAccounts();
  assert.equal(before.length, 1);
  assert.equal(before[0].name, 'Player');
  // 加一个真实账户：只存该账户，Player 隐式默认不再持久化。
  rt.addAccount('Alice');
  const after = await rt.listAccounts();
  assert.deepEqual(after.map((x) => x.name).sort(), ['Alice']);
});

test('removeAccount：按 id 移除；移除至空回落默认 Player', async (t) => {
  const rt = tempRuntime(t);
  const a = rt.addAccount('Bob');
  rt.removeAccount(a.id);
  const after = await rt.listAccounts();
  assert.equal(after.length, 1);
  assert.equal(after[0].name, 'Player');
});
