import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// base './'：Electron 生产模式以 file:// 加载 dist/index.html，资源必须相对路径。
// alias：core-spec 的 dist 为 CommonJS，rollup 无法静态识别其具名值导出（如 IPC_EVENTS）；
// 直接指向 TS 源由 Vite 编译为 ESM，契约单一真相不变（tsc/electron 仍按 node_modules 解析）。
// runtime 深链（2026-10-25「更新 UI」）：ui 不依赖 @attic/runtime 包（node_modules 不可解析），
// 且 runtime 其余模块带 node: 依赖面——只点名 alias 两个零 Node 依赖的纯函数模块源码
// （markdown 渲染器 / 打扰门），与 tsconfig paths 成对维护（vue-tsc 类型图同址解析）。
export default defineConfig({
  plugins: [vue()],
  base: './',
  resolve: {
    alias: {
      '@attic/core-spec': fileURLToPath(new URL('../core-spec/src/index.ts', import.meta.url)),
      '@attic/runtime/markdown': fileURLToPath(new URL('../runtime/src/markdown.ts', import.meta.url)),
      '@attic/runtime/updatePolicy': fileURLToPath(new URL('../runtime/src/updatePolicy.ts', import.meta.url)),
    },
  },
});
