import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// base './'：Electron 生产模式以 file:// 加载 dist/index.html，资源必须相对路径。
export default defineConfig({
  plugins: [vue()],
  base: './',
});
