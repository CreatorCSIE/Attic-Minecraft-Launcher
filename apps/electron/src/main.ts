import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  type AppSettings,
  type AtticEventPayloads,
  type CustomVersionView,
  type InstanceView,
  type IpcResult,
  type LaunchRequest,
  type WindowAction,
} from '@attic/core-spec';
import { AtticRuntime } from '@attic/runtime';

/** TS 启动器核心门面（Phase 2）：主进程唯一实例。 */
const runtime = new AtticRuntime();

/** 无边距主窗引用（WINDOW_CONTROL 通道操作目标）。 */
let mainWindow: BrowserWindow | null = null;

/** 每次启动一个独立控制台窗（用户指定）：集合仅用于生命周期跟踪，不做复用。 */
const consoleWindows = new Set<BrowserWindow>();

/** 开发模式渲染地址：--dev-url= 或 ELECTRON_RENDERER_URL；缺省 = ui 构建产物。 */
function resolveDevUrl(): string | undefined {
  const devArg = process.argv.find((a) => a.startsWith('--dev-url='));
  return devArg?.slice('--dev-url='.length) ?? process.env['ELECTRON_RENDERER_URL'];
}

function uiDistIndex(): string {
  return path.resolve(app.getAppPath(), '..', '..', 'packages', 'ui', 'dist', 'index.html');
}

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
  for (const event of [
    IPC_EVENTS.GAME_OUTPUT,
    IPC_EVENTS.GAME_EXIT,
    IPC_EVENTS.DOWNLOAD_PROGRESS,
    IPC_EVENTS.CUSTOM_INFO_CHANGED,
  ] as const) {
    runtime.on(event, (payload: AtticEventPayloads[typeof event]) => {
      console.log(`[attic-main] broadcast ${event} → ${BrowserWindow.getAllWindows().length} window(s)`);
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(event, payload);
      }
    });
  }
}

/** 无边距主窗：拖拽区由 UI 的 .titlebar（-webkit-app-region: drag）承担。 */
function createWindow(): void {
  const win = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // preload 需要 require('@attic/core-spec') 取通道常量；Electron 20+ 默认沙箱
      // 只允许 require 少数内置模块，不禁用沙箱 preload 会静默失败（缺桥横幅的根因）。
      sandbox: false,
    },
  });
  mainWindow = win;
  win.on('closed', () => {
    mainWindow = null;
  });

  // 诊断期（基建调试）：直接 show，不等 ready-to-show——页面 JS 异常/加载失败时
  // ready-to-show 可能永不触发，导致"日志正常但窗口不出现"。视觉验收后此段可还原。
  win.show();
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error(`[attic-main] did-fail-load ${code}: ${desc}`);
  });
  win.webContents.on('console-message', (_e, _level, msg, _line, src) => {
    console.log(`[renderer] ${msg} (${src})`);
  });
  win.webContents.openDevTools({ mode: 'detach' });

  const devUrl = resolveDevUrl();
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    // Phase 0：直接加载 packages/ui 的构建产物；真正的打包分发留待 Phase 5。
    void win.loadFile(uiDistIndex());
  }
}

/**
 * 独立控制台窗（v1 语义 + 用户指定"每次启动独立控制台"）：加载同一 UI 带 ?window=console&pid=<会话pid>。
 * 每次调用都新建窗口（旧控制台不复用）；窗内 ConsolePanel 按 pid 过滤本会话输出，旧窗保留各自历史日志。
 */
function createConsoleWindow(): void {
  const session = runtime.status().session;
  const win = new BrowserWindow({
    width: 860,
    height: 600,
    minWidth: 520,
    minHeight: 360,
    frame: false,
    show: false,
    title: session ? `Attic Console — ${session.versionId} (${session.pid})` : 'Attic Minecraft Launcher — Console',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  consoleWindows.add(win);
  win.on('closed', () => {
    consoleWindows.delete(win);
  });
  win.show();

  const query: Record<string, string> = { window: 'console' };
  if (session) query['pid'] = String(session.pid);
  const devUrl = resolveDevUrl();
  if (devUrl) {
    const sep = devUrl.includes('?') ? '&' : '?';
    void win.loadURL(`${devUrl}${sep}${new URLSearchParams(query).toString()}`);
  } else {
    void win.loadFile(uiDistIndex(), { query });
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
  handle(IPC_CHANNELS.ACCOUNTS_ADD, (name: string) => runtime.addAccount(name));
  handle(IPC_CHANNELS.ACCOUNTS_REMOVE, (id: string) => runtime.removeAccount(id));
  handle(IPC_CHANNELS.ACCOUNTS_RENAME, (id: string, name: string) => runtime.renameAccount(id, name));
  handle(IPC_CHANNELS.SETTINGS_GET, () => runtime.getSettings());
  handle(IPC_CHANNELS.SETTINGS_SET, (settings: AppSettings) => runtime.setSettings(settings));
  handle(IPC_CHANNELS.INSTANCES_LIST, () => runtime.listInstances());
  handle(IPC_CHANNELS.INSTANCES_SAVE, (instance: InstanceView) => runtime.saveInstance(instance));
  handle(IPC_CHANNELS.INSTANCES_DELETE, (name: string, withFiles: boolean) => runtime.deleteInstance(name, withFiles));
  handle(IPC_CHANNELS.INSTANCES_RENAME, (name: string, newName: string) => runtime.renameInstance(name, newName));
  // 打开实例目录：先 mkdir 保证可见（首启未落盘的场景不失败），再交系统文件管理器。
  // openPath 失败语义 = 返回非空错误字符串（成功 = ''），回抛给渲染侧可见。
  handle(IPC_CHANNELS.INSTANCES_OPEN_DIR, async (name: string) => {
    const dir = runtime.instanceGameDir(name);
    fs.mkdirSync(dir, { recursive: true });
    const err = await shell.openPath(dir);
    if (err) throw new Error(err);
  });
  // 自定义版本配置页通道（list/get/save/remove 直连 runtime；import 见下方对话框）。
  handle(IPC_CHANNELS.CUSTOM_LIST, () => runtime.listCustomVersions());
  handle(IPC_CHANNELS.CUSTOM_GET_INFO, (id: string) => runtime.getCustomVersionInfo(id));
  handle(IPC_CHANNELS.CUSTOM_SAVE_INFO, (id: string, props: Record<string, string>) => runtime.saveCustomVersionInfo(id, props));
  handle(IPC_CHANNELS.CUSTOM_REMOVE, (id: string) => runtime.removeCustomVersion(id));
  // 导入 jar：主进程弹原生文件对话框（渲染侧无 fs 权限）；取消 = ok(null)，选中路径交 runtime 复制落位。
  ipcMain.handle(IPC_CHANNELS.CUSTOM_IMPORT_JAR, async (): Promise<IpcResult<CustomVersionView | null>> => {
    try {
      const res = await dialog.showOpenDialog({
        title: '导入自定义版本 jar',
        properties: ['openFile'],
        filters: [{ name: 'Minecraft jar', extensions: ['jar', 'zip'] }],
      });
      const file = res.filePaths[0];
      if (res.canceled || !file) return { ok: true, value: null };
      return { ok: true, value: runtime.importCustomJar(file) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  // 窗控制：动作合法性由契约类型保证；toggle-maximize 在最大化/还原间切换。
  // 按发送方窗口操作（非固定 mainWindow）——独立控制台窗的顶栏三键才能控自己的窗。
  ipcMain.handle(IPC_CHANNELS.WINDOW_CONTROL, async (event, action: WindowAction): Promise<IpcResult<void>> => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
      if (!win) return { ok: true, value: undefined };
      if (action === 'minimize') win.minimize();
      else if (action === 'close') win.close();
      else if (win.isMaximized()) win.unmaximize();
      else win.maximize();
      return { ok: true, value: undefined };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  // 独立控制台窗：唤起/聚焦（v1 语义；主页 Play/测试启动后由 UI 侧触发）。
  handle<[], void>(IPC_CHANNELS.WINDOW_CONSOLE, () => {
    createConsoleWindow();
  });

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
