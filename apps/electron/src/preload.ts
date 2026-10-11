import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type IpcResult, type RendererBridge } from '@attic/core-spec';

const bridge: RendererBridge = {
  ping: async () => (await ipcRenderer.invoke(IPC_CHANNELS.PING)) as IpcResult<string>,
};

contextBridge.exposeInMainWorld('attic', bridge);
