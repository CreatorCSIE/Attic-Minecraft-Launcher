import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// base './'：Electron 生产模式以 file:// 加载 dist/index.html，资源必须相对路径。
// alias：core-spec 的 dist 为 CommonJS，rollup 无法静态识别其具名值导出（如 IPC_EVENTS）；
// 直接指向 TS 源由 Vite 编译为 ESM，契约单一真相不变（tsc/electron 仍按 node_modules 解析）。
export default defineConfig({
  plugins: [vue()],
  base: './',
  resolve: {
    alias: {
      '@attic/core-spec': fileURLToPath(new URL('../core-spec/src/index.ts', import.meta.url)),
    },
  },
});
