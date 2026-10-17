#!/usr/bin/env node
/**
 * pnpm dev —— 开发全链路编排（零新依赖）：
 *  1) 串行编译：core-spec → runtime → electron 主进程
 *     （戒律：Electron 启动前主进程产物必须最新，避免半新半旧不一致）
 *  2) 起 vite dev server（packages/ui，端口 5310 strictPort；已在服务则复用）
 *  3) 就绪探测通过后拉起 Electron，指向 --dev-url
 *  4) 生命周期：Electron 窗口关闭 → 回收自起的 vite；Ctrl+C → 回收全部子进程
 *
 * 注意：runtime/主进程改动需重跑本脚本（dist 为一次性编译）；UI 侧走 vite HMR 即时生效。
 */
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 5310;
const DEV_URL = `http://localhost:${PORT}`;
// 探针走 localhost（vite 默认可能只绑 [::1]，127.0.0.1 会漏检成"端口空闲"再撞 strictPort）
const PROBE_URL = `http://localhost:${PORT}/`;
const READY_TIMEOUT_MS = 30_000;

const log = (msg) => console.log(`[dev] ${msg}`);
const die = (msg, code = 1) => {
  console.error(`[dev] ${msg}`);
  process.exit(code);
};

/** 串行跑一条 pnpm 命令（Windows 下 pnpm 是 .cmd，需 shell），非零退出即终止。 */
function build(desc, dir, target) {
  log(`build: ${desc}`);
  const r = spawnSync('pnpm', ['-C', dir, target], { cwd: ROOT, stdio: 'inherit', shell: true });
  if (r.status !== 0) die(`构建失败：${desc}（exit ${r.status}）`);
}

/** 端口上是否已有健康 HTTP 服务（复用既有 vite，避免重复起/端口漂移）。 */
async function servingAlready() {
  try {
    const res = await fetch(PROBE_URL, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await servingAlready()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  die(`vite 未在 ${READY_TIMEOUT_MS / 1000}s 内就绪：${PROBE_URL}`);
}

/** Windows 下 shell 包裹的子孙进程需整树回收（taskkill /T）；POSIX 直接 SIGTERM。 */
function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore', shell: true });
  } else {
    child.kill('SIGTERM');
  }
}

let electronExited = false;
let vite = null;

// —— 1. 串行构建（UI 无需 build：vite 直编源码，core-spec 走 alias 指 TS 源） ——
build('core-spec', 'packages/core-spec', 'build');
build('runtime', 'packages/runtime', 'build');
build('electron main', 'apps/electron', 'build');

// —— 2. vite dev server（已在服务则复用） ——
if (await servingAlready()) {
  log(`复用已在服务的 vite：${DEV_URL}`);
} else {
  log('serve: vite (packages/ui)');
  vite = spawn('pnpm', ['-C', 'packages/ui', 'exec', 'vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });
  vite.on('exit', (code) => {
    if (electronExited) return;
    electronExited = true;
    die(`vite 意外退出（exit ${code}）`, code ?? 1);
  });
  await waitForReady();
  log(`vite 就绪：${DEV_URL}`);
}

// —— 3. Electron ——
log('launch: electron');
const electron = spawn('pnpm', ['-C', 'apps/electron', 'exec', 'electron', '.', `--dev-url=${DEV_URL}`], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: true,
});
electron.on('exit', (code) => {
  if (electronExited) return;
  electronExited = true;
  if (vite) killTree(vite);
  log(`Electron 退出（exit ${code}）${vite ? '，已回收 vite。' : '，vite 为复用实例，保留。'}`);
  process.exit(code ?? 0);
});

// —— 4. Ctrl+C / SIGTERM：回收全部子进程 ——
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    killTree(electron);
    if (vite) killTree(vite);
    process.exit(sig === 'SIGINT' ? 130 : 143);
  });
}
