import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  type AtticEventPayloads,
  type IpcResult,
  type LaunchRequest,
  type RendererBridge,
} from '@attic/core-spec';

/** 请求通道统一走 IpcResult 封装（错误不跨进程抛异常）。 */
function invoke<T>(channel: string, ...args: unknown[]): Promise<IpcResult<T>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<T>>;
}

const bridge: RendererBridge = {
  ping: () => invoke(IPC_CHANNELS.PING),
  listVersions: () => invoke(IPC_CHANNELS.VERSIONS_LIST),
  getVersionJson: (versionId) => invoke(IPC_CHANNELS.VERSIONS_JSON, versionId),
  dryRunLaunch: (request: LaunchRequest) => invoke(IPC_CHANNELS.LAUNCH_DRY_RUN, request),
  launch: (request: LaunchRequest) => invoke(IPC_CHANNELS.LAUNCH, request),
  kill: () => invoke(IPC_CHANNELS.KILL),
  status: () => invoke(IPC_CHANNELS.STATUS),
  detectJava: () => invoke(IPC_CHANNELS.JAVA_DETECT),
  listAccounts: () => invoke(IPC_CHANNELS.ACCOUNTS_LIST),
  addAccount: (name) => invoke(IPC_CHANNELS.ACCOUNTS_ADD, name),
  removeAccount: (id) => invoke(IPC_CHANNELS.ACCOUNTS_REMOVE, id),
  renameAccount: (id, name) => invoke(IPC_CHANNELS.ACCOUNTS_RENAME, id, name),
  getSettings: () => invoke(IPC_CHANNELS.SETTINGS_GET),
  setSettings: (settings) => invoke(IPC_CHANNELS.SETTINGS_SET, settings),
  listInstances: () => invoke(IPC_CHANNELS.INSTANCES_LIST),
  saveInstance: (instance) => invoke(IPC_CHANNELS.INSTANCES_SAVE, instance),
  windowControl: (action) => invoke(IPC_CHANNELS.WINDOW_CONTROL, action),
  openConsoleWindow: () => invoke(IPC_CHANNELS.WINDOW_CONSOLE),
  on: <E extends keyof AtticEventPayloads>(event: E, cb: (payload: AtticEventPayloads[E]) => void) => {
    const handler = (_: unknown, payload: AtticEventPayloads[E]): void => {
      if (event === IPC_EVENTS.GAME_EXIT) console.log(`[attic-preload] recv ${event}`);
      cb(payload);
    };
    ipcRenderer.on(event, handler);
    return () => ipcRenderer.removeListener(event, handler);
  },
};

contextBridge.exposeInMainWorld('attic', bridge);
// 诊断：确认 preload 执行且桥已注入（经 main 的 console-message 透传可见）。
console.log('[attic-preload] contextBridge.attic exposed');
