#!/usr/bin/env node
/**
 * Node16 API 闸门（Phase 5 拍板：兜底壳 = Electron 22（Node 16.17 + Chromium 108），
 * 宿主侧源码禁用 Node>16 API）。扫描「会被兜底线打包消费」的宿主面源码，
 * 命中禁用 API 即非零退出；fetch 属已知特例（fetchImpl 注入面 + legacy polyfill），
 * 以白名单放行并只允许函数体内默认闭包形态。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 扫描目录（宿主面：runtime / Electron 主进程与 preload / core-spec 值域模块）。 */
const SCAN_DIRS = [
  'packages/runtime/src',
  'packages/core-spec/src',
  'apps/electron/src',
];

/** 硬禁用：Node>16 / Chromium>108 才有稳定全局的 API。 */
const FORBIDDEN = [
  { name: 'structuredClone（Node17+）', re: /\bstructuredClone\s*\(/g },
  { name: 'AbortSignal.timeout（Node17.3+）', re: /AbortSignal\s*\.\s*timeout\s*\(/g },
  { name: 'node:test 进宿主源码', re: /from\s+['"]node:test['"]/g },
  { name: 'Array grouping（Node21+）', re: /\bObject\.(?:groupBy|getOwnMetadata)\s*\(/g },
];

/** 全局 fetch：仅允许白名单文件（fetchImpl 默认闭包是惰性解引用，兜底线由 electron.net 桥承接）。 */
const FETCH_ALLOW = new Set([
  'packages/runtime/src/betacraft.ts',
  'packages/runtime/src/runtime.ts',
  'packages/runtime/src/zulu.ts',
]);

function* walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else if (p.endsWith('.ts')) yield p;
  }
}

const findings = [];
for (const rel of SCAN_DIRS) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs)) {
    const relFile = path.relative(ROOT, file).replaceAll(path.sep, '/');
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const { name, re } of FORBIDDEN) {
        re.lastIndex = 0;
        if (re.test(line)) findings.push(`${relFile}:${i + 1} 禁用 API [${name}] -> ${line.trim()}`);
      }
      // 全局 fetch 直调（排除 fetchImpl 声明/调用与类型引用）
      const direct = /(?<![\w.$])fetch\s*\(/.test(line) && !/fetchImpl/.test(line);
      if (direct && !FETCH_ALLOW.has(relFile)) {
        findings.push(`${relFile}:${i + 1} 全局 fetch 直调（Node16 宿主缺全局） -> ${line.trim()}`);
      }
    });
  }
}

if (findings.length) {
  console.error('[node16-gate] 兜底线 API 锁违规：');
  for (const f of findings) console.error(`  - ${f}`);
  console.error('修复方向：宿主面改写为 Node 16.17 / Chromium 108 可用子集（fetch 走 fetchImpl 注入面）。');
  process.exit(1);
}
console.log('[node16-gate] host-side API lock ok');
