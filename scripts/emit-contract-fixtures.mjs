#!/usr/bin/env node
/**
 * 契约 fixture 生成（戒律 #2 的跨语言闸门数据源）：
 * 从 sidecar 导出表（值域源头 = @attic/core-spec ipc.ts）读出通道/方法/事件清单，
 * 写 packages/core-spec/tests/fixtures/ipc-channels.json；
 * Rust 侧（src-tauri contract_tests）与 TS 侧都对照该 fixture —— 两侧镜像必须同源。
 * `--check` 模式：与既有 fixture 比对，漂移即非零退出（CI 用，不写文件）。
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// 只 import 导出表：禁 autostart（见 sidecar/src/server.ts 尾注）。
process.env.ATTIC_SIDECAR_DISABLE_AUTOSTART = '1';
const mod = require(path.join(ROOT, 'apps', 'tauri', 'sidecar', 'dist', 'server.cjs'));

const fixture = {
  allChannels: [...mod.ALL_CHANNELS].sort(),
  hostOnlyChannels: [...mod.HOST_ONLY_CHANNELS].sort(),
  sidecarChannels: [...mod.SIDECAR_CHANNELS].sort(),
  internalMethods: [...mod.INTERNAL_METHODS].sort(),
  eventChannels: [...mod.EVENT_CHANNELS].sort(),
};
const content = `${JSON.stringify(fixture, null, 2)}\n`;
const out = path.join(ROOT, 'packages', 'core-spec', 'tests', 'fixtures', 'ipc-channels.json');

if (process.argv.includes('--check')) {
  const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (current !== content) {
    console.error('[fixtures] 契约面漂移：重跑 `node scripts/emit-contract-fixtures.mjs` 并提交 fixture');
    process.exit(1);
  }
  console.log('[fixtures] in sync');
  process.exit(0);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, content, 'utf8');
console.log(`[fixtures] written -> ${path.relative(ROOT, out)}`);
