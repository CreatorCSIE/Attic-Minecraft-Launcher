/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}

import type { RendererBridge } from '@attic/core-spec';

declare global {
  interface Window {
    /** preload 注入的 IPC 桥；浏览器直开 vite dev 时为 undefined。 */
    attic?: RendererBridge;
  }
}

export {};
