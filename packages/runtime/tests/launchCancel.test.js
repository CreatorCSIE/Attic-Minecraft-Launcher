'use strict';

/**
 * 0.0.2 feat①（取消启动）链路测试：launch() 的 AbortController 生命周期 +
 * cancelLaunch() 语义（无在途/已释放 = false；在途 = abort 并归一「启动已取消」）。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { AtticRuntime } = require('../dist/index.js');

const INFO = ['id=b1.7.3', 'launch-method=indev', 'release-date=1310110334000'].join('\n');

function tempRuntime(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attic-cancel-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const rt = new AtticRuntime({
    rootDir: dir,
    fetchImpl: async (url) =>
      url === rt.endpoints.versionJson('b1.7.3')
        ? new Response(INFO, { status: 200, headers: { 'content-length': String(Buffer.byteLength(INFO)) } })
        : new Response('not found', { status: 404 }),
  });
  return rt;
}

test('cancelLaunch：无在途启动 → cancelled:false（取消窗口不存在，终止应走 KILL）', (t) => {
  const rt = tempRuntime(t);
  assert.deepEqual(rt.cancelLaunch(), { cancelled: false });
});

test('launch 取消：发起后立刻 cancel → 归一「启动已取消」+ 不记 lastError + 控制器释放', async (t) => {
  const rt = tempRuntime(t);
  const p = rt.launch({ versionId: 'b1.7.3' });
  // launch 同步段（建档回写+建控制器）已执行，此刻停在首个 await（.info 刷新）——取消窗口内。
  assert.deepEqual(rt.cancelLaunch(), { cancelled: true });
  await assert.rejects(() => p, /启动已取消/);
  assert.equal(rt.status().lastError, null, '用户主动取消 = 中性态，不显崩');
  assert.deepEqual(rt.cancelLaunch(), { cancelled: false }, 'finally 释放控制器，二次取消无的放矢');
});

test('launch 取消后再发起：新启动不受残留控制器影响（正常推进到后续阶段）', async (t) => {
  const rt = tempRuntime(t);
  const p = rt.launch({ versionId: 'b1.7.3' });
  rt.cancelLaunch();
  await assert.rejects(() => p, /启动已取消/);
  // 二次 launch 不 cancel：会推进到 jar 下载/依赖阶段并因网络面缺路由而失败——
  // 关键断言是错误不是「启动已取消」（控制器/信号无残留污染）。
  await assert.rejects(() => rt.launch({ versionId: 'b1.7.3' }), (err) => !/启动已取消/.test(err.message));
});
