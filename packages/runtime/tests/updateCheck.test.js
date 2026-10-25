'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { compareSemver, checkLatestRelease, AtticRuntime } = require('../dist/index.js');

function tempRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attic-upd-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** 指定 URL 的 JSON 应答 fetch（其余 404，同 betacraft.test.js 口径）。 */
function jsonFetch(url, body, status = 200) {
  return async (u) =>
    u === url
      ? new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
      : new Response('not found', { status: 404 });
}

const REPO_URL = 'https://api.github.com/repos/CreatorCSIE/Attic-Minecraft-Launcher/releases/latest';

// ---------- compareSemver：数字段边界 ----------

test('compareSemver：进位边界按数值位而非字典序', () => {
  assert.equal(compareSemver('0.0.9', '0.1.0'), -1);
  assert.equal(compareSemver('1.9.0', '1.10.0'), -1);
  assert.equal(compareSemver('1.10.0', '1.9.0'), 1);
  assert.equal(compareSemver('2.0.0', '10.0.0'), -1);
});

test('compareSemver：v 前缀剥离 + 缺段按 0 补齐 + 相等', () => {
  assert.equal(compareSemver('v1.2.3', '1.2.3'), 0);
  assert.equal(compareSemver('1.0', '1.0.0'), 0);
  assert.equal(compareSemver('1.0.1', '1.0'), 1);
  assert.equal(compareSemver('v0.1.0', '0.0.9'), 1);
});

// ---------- checkLatestRelease：数据面全分支 ----------

test('checkLatestRelease：200 有新版 → update 分支字段全带出（tag 去 v 前缀）', async () => {
  const res = await checkLatestRelease({
    releaseRepo: 'CreatorCSIE/Attic-Minecraft-Launcher',
    currentVersion: '0.0.0',
    fetchImpl: jsonFetch(REPO_URL, {
      tag_name: 'v0.1.0',
      html_url: 'https://github.com/CreatorCSIE/Attic-Minecraft-Launcher/releases/tag/v0.1.0',
      body: '## 更新内容\n- 检查更新链上线',
      published_at: '2026-10-20T12:00:00Z',
    }),
  });
  assert.equal(res.status, 'update');
  assert.equal(res.version, '0.1.0');
  assert.equal(res.url, 'https://github.com/CreatorCSIE/Attic-Minecraft-Launcher/releases/tag/v0.1.0');
  assert.equal(res.notes, '## 更新内容\n- 检查更新链上线');
  assert.equal(res.publishedAt, '2026-10-20T12:00:00Z');
});

test('checkLatestRelease：相等/更旧 → upToDate（不降级提示）', async () => {
  const mk = (tag) =>
    checkLatestRelease({
      releaseRepo: 'a/b',
      currentVersion: '0.2.0',
      fetchImpl: jsonFetch('https://api.github.com/repos/a/b/releases/latest', { tag_name: tag, html_url: 'u' }),
    });
  assert.equal((await mk('v0.2.0')).status, 'upToDate');
  assert.equal((await mk('v0.1.9')).status, 'upToDate');
  const up = await mk('v0.2.0');
  assert.equal(up.current, '0.2.0');
});

test('checkLatestRelease：预发布纪律——自身或 latest 含 - 永不提示', async () => {
  const call = async (current, tag) =>
    checkLatestRelease({
      releaseRepo: 'a/b',
      currentVersion: current,
      fetchImpl: jsonFetch('https://api.github.com/repos/a/b/releases/latest', { tag_name: tag, html_url: 'u' }),
    });
  // 自身预发布：即便 latest 数字更大也不提示
  assert.equal((await call('0.2.0-beta.1', 'v0.3.0')).status, 'upToDate');
  // latest 预发布（理论上 /latest 已排除，防御双保险）
  assert.equal((await call('0.1.0', 'v0.2.0-rc1')).status, 'upToDate');
});

test('checkLatestRelease：请求头带 GitHub 强制的 User-Agent = Attic/<version>', async () => {
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return jsonFetch(url, { tag_name: 'v0.1.0', html_url: 'u' })(url, init);
  };
  await checkLatestRelease({ releaseRepo: 'a/b', currentVersion: '0.0.3', fetchImpl });
  assert.equal(seen.url, 'https://api.github.com/repos/a/b/releases/latest');
  assert.equal(seen.init.headers['User-Agent'], 'Attic/0.0.3');
  assert.equal(seen.init.headers.Accept, 'application/vnd.github+json');
});

test('checkLatestRelease：网络炸 → error 可读（不抛异常）', async () => {
  const res = await checkLatestRelease({
    releaseRepo: 'a/b',
    currentVersion: '0.0.0',
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED 网络离线');
    },
  });
  assert.equal(res.status, 'error');
  assert.match(res.message, /ECONNREFUSED/);
});

test('checkLatestRelease：非 2xx（404/403）→ error 带状态与提示', async () => {
  const res404 = await checkLatestRelease({
    releaseRepo: 'no/such-repo',
    currentVersion: '0.0.0',
    fetchImpl: async () => new Response('{"message":"Not Found"}', { status: 404 }),
  });
  assert.equal(res404.status, 'error');
  assert.match(res404.message, /404/);
  assert.match(res404.message, /仓库不存在/);
  const res403 = await checkLatestRelease({
    releaseRepo: 'a/b',
    currentVersion: '0.0.0',
    fetchImpl: async () => new Response('', { status: 403 }),
  });
  assert.equal(res403.status, 'error');
  assert.match(res403.message, /403/);
});

test('checkLatestRelease：响应缺 tag_name → error；缺 body/published_at → 空串容忍', async () => {
  const bad = await checkLatestRelease({
    releaseRepo: 'a/b',
    currentVersion: '0.0.0',
    fetchImpl: jsonFetch('https://api.github.com/repos/a/b/releases/latest', { html_url: 'u' }),
  });
  assert.equal(bad.status, 'error');
  assert.match(bad.message, /tag_name/);
  const okMin = await checkLatestRelease({
    releaseRepo: 'a/b',
    currentVersion: '0.0.0',
    fetchImpl: jsonFetch('https://api.github.com/repos/a/b/releases/latest', { tag_name: 'v1.0.0', html_url: 'u' }),
  });
  assert.equal(okMin.status, 'update');
  assert.equal(okMin.notes, '');
  assert.equal(okMin.publishedAt, '');
});

test('checkLatestRelease：仓库未配置 = unconfigured（不发请求）；格式非法 = error', async () => {
  let called = 0;
  const spy = async () => {
    called++;
    return new Response('{}', { status: 200 });
  };
  const un = await checkLatestRelease({ currentVersion: '0.0.0', fetchImpl: spy });
  assert.equal(un.status, 'unconfigured');
  const blank = await checkLatestRelease({ releaseRepo: '   ', currentVersion: '0.0.0', fetchImpl: spy });
  assert.equal(blank.status, 'unconfigured');
  assert.equal(called, 0, 'unconfigured 分支零网络');
  for (const repo of ['just-name', 'a/b/c', '/b', 'a/']) {
    const bad = await checkLatestRelease({ releaseRepo: repo, currentVersion: '0.0.0', fetchImpl: spy });
    assert.equal(bad.status, 'error', `非法格式应 error：${repo}`);
    assert.match(bad.message, /owner\/repo/);
  }
});

// ---------- AtticRuntime 门面集成 ----------

test('AtticRuntime.checkUpdate：构造选项 releaseRepo 走通全链', async (t) => {
  const runtime = new AtticRuntime({
    rootDir: tempRoot(t),
    version: '0.0.0',
    releaseRepo: 'CreatorCSIE/Attic-Minecraft-Launcher',
    fetchImpl: jsonFetch(REPO_URL, { tag_name: 'v0.1.0', html_url: 'u', body: 'n', published_at: 'p' }),
  });
  const res = await runtime.checkUpdate();
  assert.equal(res.status, 'update');
  assert.equal(res.version, '0.1.0');
});

test('AtticRuntime.checkUpdate：env ATTIC_RELEASE_REPO 兜底（构造选项缺席时）', async (t) => {
  const runtime = new AtticRuntime({
    rootDir: tempRoot(t),
    version: '0.0.0',
    env: { ATTIC_RELEASE_REPO: 'CreatorCSIE/Attic-Minecraft-Launcher' },
    fetchImpl: jsonFetch(REPO_URL, { tag_name: 'v0.1.0', html_url: 'u' }),
  });
  assert.equal((await runtime.checkUpdate()).status, 'update');
});

test('AtticRuntime.checkUpdate：两缺 = unconfigured 不炸', async (t) => {
  const runtime = new AtticRuntime({
    rootDir: tempRoot(t),
    version: '0.0.0',
    env: {}, // 显式空 env：不吃真实进程的 ATTIC_RELEASE_REPO
    fetchImpl: async () => {
      throw new Error('不应发起网络');
    },
  });
  assert.equal((await runtime.checkUpdate()).status, 'unconfigured');
});

test('AtticRuntime.getSystemInfo：shell 注入（tauri）与缺省（electron 保守）', (t) => {
  const injected = new AtticRuntime({ rootDir: tempRoot(t), shell: 'tauri' });
  assert.equal(injected.getSystemInfo().shell, 'tauri');
  const defaulted = new AtticRuntime({ rootDir: tempRoot(t) });
  assert.equal(defaulted.getSystemInfo().shell, 'electron');
});
