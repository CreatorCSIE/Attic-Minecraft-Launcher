import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  type AppSettings,
  type AtticEventPayloads,
  type InstanceView,
  type IpcResult,
  type LaunchRequest,
} from '@attic/core-spec';
import { AtticRuntime } from '@attic/runtime';

/** TS 启动器核心门面（Phase 2）：主进程唯一实例。 */
const runtime = new AtticRuntime();

/**
 * 通道注册器：IpcResult 封装归壳层（runtime 以异常抛出）。
 * 参数透传：渲染侧 invoke(channel, ...args) → handle 回调 (event, ...args)。
 */
function handle<I extends unknown[], T>(channel: string, fn: (...args: I) => T | Promise<T>): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<IpcResult<T>> => {
    try {
      return { ok: true, value: await fn(...(args as I)) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

/** 事件广播：runtime 事件面 → 全部窗口的 webContents（preload 的 on() 订阅侧）。 */
function wireEvents(): void {
  for (const event of [IPC_EVENTS.GAME_OUTPUT, IPC_EVENTS.GAME_EXIT, IPC_EVENTS.DOWNLOAD_PROGRESS] as const) {
    runtime.on(event, (payload: AtticEventPayloads[typeof event]) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(event, payload);
      }
    });
  }
}

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
  // 九请求通道（ipc.ts 契约一一对应）。
  handle(IPC_CHANNELS.PING, () => runtime.ping());
  handle(IPC_CHANNELS.VERSIONS_LIST, () => runtime.listVersions());
  handle(IPC_CHANNELS.VERSIONS_JSON, (versionId: string) => runtime.getVersionJson(versionId));
  handle(IPC_CHANNELS.LAUNCH_DRY_RUN, (request: LaunchRequest) => runtime.dryRunLaunch(request));
  handle(IPC_CHANNELS.LAUNCH, (request: LaunchRequest) => runtime.launch(request));
  handle(IPC_CHANNELS.KILL, () => runtime.kill());
  handle(IPC_CHANNELS.STATUS, () => runtime.status());
  handle(IPC_CHANNELS.JAVA_DETECT, () => runtime.detectJava());
  handle(IPC_CHANNELS.ACCOUNTS_LIST, () => runtime.listAccounts());
  handle(IPC_CHANNELS.SETTINGS_GET, () => runtime.getSettings());
  handle(IPC_CHANNELS.SETTINGS_SET, (settings: AppSettings) => runtime.setSettings(settings));
  handle(IPC_CHANNELS.INSTANCES_LIST, () => runtime.listInstances());
  handle(IPC_CHANNELS.INSTANCES_SAVE, (instance: InstanceView) => runtime.saveInstance(instance));

  wireEvents();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 退出清理：游戏进程在跑则先 kill（进程生命周期归 runtime，壳只触发）。
app.on('before-quit', () => {
  if (runtime.status().running) void runtime.kill().catch(() => undefined);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
