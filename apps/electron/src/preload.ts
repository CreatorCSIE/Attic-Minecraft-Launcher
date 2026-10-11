import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  NOT_IMPLEMENTED,
  type AtticEventPayloads,
  type IpcResult,
  type RendererBridge,
} from '@attic/core-spec';

/** Phase 2 前的诚实占位：返回错误而非挂起，桥面形状即契约形状。 */
function notImpl<T>(): Promise<IpcResult<T>> {
  return Promise.resolve({ ok: false, error: NOT_IMPLEMENTED });
}

const bridge: RendererBridge = {
  ping: async () => (await ipcRenderer.invoke(IPC_CHANNELS.PING)) as IpcResult<string>,
  listVersions: () => notImpl(),
  getVersionJson: () => notImpl(),
  dryRunLaunch: () => notImpl(),
  launch: () => notImpl(),
  kill: () => notImpl(),
  status: () => notImpl(),
  detectJava: () => notImpl(),
  listAccounts: () => notImpl(),
  on: <E extends keyof AtticEventPayloads>(event: E, cb: (payload: AtticEventPayloads[E]) => void) => {
    const handler = (_: unknown, payload: AtticEventPayloads[E]): void => cb(payload);
    ipcRenderer.on(event, handler);
    return () => ipcRenderer.removeListener(event, handler);
  },
};

contextBridge.exposeInMainWorld('attic', bridge);
