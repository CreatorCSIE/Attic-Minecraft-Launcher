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

test('首启无 accounts.json：账户列表恒为空（无默认 Player 回落）；添加后仅含该账户', async (t) => {
  const rt = tempRuntime(t);
  assert.deepEqual(await rt.listAccounts(), []);
  rt.addAccount('Alice');
  const after = await rt.listAccounts();
  assert.deepEqual(after.map((x) => x.name), ['Alice']);
});

test('removeAccount：按 id 移除；可移除至空（无默认账户回落）', async (t) => {
  const rt = tempRuntime(t);
  const a = rt.addAccount('Bob');
  rt.removeAccount(a.id);
  assert.deepEqual(await rt.listAccounts(), []);
});

test('renameAccount：改名成功且 UUID 随新名重生成（id=offlineUuid(name)）', (t) => {
  const rt = tempRuntime(t);
  const { offlineUuid } = require('../dist/index.js');
  const a = rt.addAccount('Carl');
  const b = rt.renameAccount(a.id, 'Charlie');
  assert.equal(b.name, 'Charlie');
  assert.equal(b.id, offlineUuid('Charlie'));
  assert.notEqual(b.id, a.id);
});

test('renameAccount：同名幂等；与他名冲突报错；非法名拒绝；不存在报错', (t) => {
  const rt = tempRuntime(t);
  const a = rt.addAccount('Dave');
  rt.addAccount('Eve');
  // 同名（含首尾空白）幂等返回既有
  const same = rt.renameAccount(a.id, ' Dave ');
  assert.equal(same.id, a.id);
  // 与其他账户重名
  assert.throws(() => rt.renameAccount(a.id, 'Eve'), /用户名已存在/);
  // 非法用户名
  assert.throws(() => rt.renameAccount(a.id, 'd!'), /无效用户名/);
  // 账户不存在
  assert.throws(() => rt.renameAccount('no-such-id', 'Frank'), /账户不存在/);
});
