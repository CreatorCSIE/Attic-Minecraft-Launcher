import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS, type IpcResult } from '@attic/core-spec';

/** 无边距主窗：拖拽区由 UI 的 .titlebar（-webkit-app-region: drag）承担。 */
function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // 开发模式：--dev-url=<vite 地址> 或 ELECTRON_RENDERER_URL 环境变量；否则加载 ui 构建产物。
  const devArg = process.argv.find((a) => a.startsWith('--dev-url='));
  const devUrl = devArg?.slice('--dev-url='.length) ?? process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    // Phase 0：直接加载 packages/ui 的构建产物；真正的打包分发留待 Phase 5。
    void win.loadFile(path.resolve(app.getAppPath(), '..', '..', 'packages', 'ui', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  // IPC 骨架：ping → pong（Phase 2 起被 launch/kill、stdout 流、下载进度等真实通道扩充）。
  ipcMain.handle(IPC_CHANNELS.PING, (): IpcResult<string> => ({ ok: true, value: 'pong' }));

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
