// 兜底壳打包：esbuild 把「polyfill + 共用主入口」与 preload 各压成单文件 CJS，
// 语法下限锁 node16/chrome108（Electron 22 = Node 16.17 + Chromium 108）。
// 依赖 @attic/* workspace 包全部打进 bundle（electron-builder files 只带 dist/**）。
import { build } from 'esbuild';

await build({
  entryPoints: ['src/legacy-entry.ts'],
  outfile: 'dist/legacy-main.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node16', 'chrome108'],
  external: ['electron'],
});

await build({
  entryPoints: ['../electron/src/preload.ts'],
  // 名必须 = preload.js：共用 main.ts 以 path.join(__dirname,'preload.js') 拼路径
  outfile: 'dist/preload.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node16', 'chrome108'],
  external: ['electron'],
});

console.log('[electron-legacy] bundled -> dist/legacy-main.cjs + dist/preload.js');
