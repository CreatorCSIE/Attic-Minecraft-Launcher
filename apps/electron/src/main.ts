import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  type AppSettings,
  type AtticEventPayloads,
  type CustomVersionView,
  type GameBacklog,
  type GameExitEvent,
  type GameOutputEvent,
  type InstanceView,
  type IpcResult,
  type LaunchRequest,
  type PickTarget,
  type SpecialDir,
  type WindowAction,
} from '@attic/core-spec';
import { AtticRuntime, launcherDir, loadSettings, resolveDataRoot } from '@attic/runtime';

/**
 * 数据根覆盖引导：设置页「更换数据根」写的是平台默认根 launcher.settings 的 rootOverride
 * （root 属构造级配置，运行期不换根）——启动时从默认根 peek 一次，指过去即完成迁移式切换。
 * portable/env 覆盖在 resolveDataRoot 内部优先于此（本函数只读默认根的键，不与之争）。
 */
function bootstrapRootDir(): string | undefined {
  try {
    return loadSettings(resolveDataRoot())['rootOverride'] || undefined;
  } catch {
    return undefined; // 首启无 settings = 走平台默认根
  }
}

/** TS 启动器核心门面（Phase 2）：主进程唯一实例。 */
const runtime = new AtticRuntime({ rootDir: bootstrapRootDir(), version: app.getVersion() });

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
function broadcast<E extends keyof AtticEventPayloads>(event: E, payload: AtticEventPayloads[E]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(event, payload);
  }
}

/**
 * 控制台 backlog（GAME_BACKLOG 通道的数据源）：按 pid 缓存本会话已发射的输出与退出事件。
 * 根因修复——独立控制台窗是启动后才新建/挂载的，spawn 瞬间的 LegacyFix premain 首批输出
 * 在窗内 useConsole 订阅前就广播完了，实时事件面永远收不到（用户实测"丢前段日志"）。
 * 新窗订阅完成后按 pid 补拉，seq 去重；每会话缓冲封顶 1MB（截断置 truncated），最多保留 4 个会话。
 */
interface SessionBacklog {
  seq: number;
  entries: GameOutputEvent[];
  bytes: number;
  exit: GameExitEvent | null;
  truncated: boolean;
}
const backlogs = new Map<number, SessionBacklog>();
const BACKLOG_BYTES_LIMIT = 1024 * 1024;

function backlogFor(pid: number): SessionBacklog {
  let b = backlogs.get(pid);
  if (!b) {
    b = { seq: 0, entries: [], bytes: 0, exit: null, truncated: false };
    backlogs.set(pid, b);
    while (backlogs.size > 4) {
      const oldest = backlogs.keys().next().value as number;
      backlogs.delete(oldest);
    }
  }
  return b;
}

function wireEvents(): void {
  // 输出事件：盖会话内单调 seq 戳 → 进 backlog → 广播（渲染侧以 seq 对补拉去重）。
  runtime.on(IPC_EVENTS.GAME_OUTPUT, (payload) => {
    const b = backlogFor(payload.pid);
    const stamped: GameOutputEvent = { ...payload, seq: ++b.seq };
    b.entries.push(stamped);
    b.bytes += stamped.chunk.length;
    while (b.bytes > BACKLOG_BYTES_LIMIT && b.entries.length > 1) {
      const drop = b.entries.shift() as GameOutputEvent;
      b.bytes -= drop.chunk.length;
      b.truncated = true;
    }
    broadcast(IPC_EVENTS.GAME_OUTPUT, stamped);
  });
  // 退出事件同样入档：游戏秒退时新建控制台窗收不到实时 exit，靠补拉恢复崩溃摘要卡。
  runtime.on(IPC_EVENTS.GAME_EXIT, (payload) => {
    backlogFor(payload.pid).exit = payload;
    broadcast(IPC_EVENTS.GAME_EXIT, payload);
  });
  for (const event of [IPC_EVENTS.DOWNLOAD_PROGRESS, IPC_EVENTS.CUSTOM_INFO_CHANGED] as const) {
    runtime.on(event, (payload: AtticEventPayloads[typeof event]) => {
      broadcast(event, payload);
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
  handle(IPC_CHANNELS.LAUNCH, async (request: LaunchRequest) => {
    const session = await runtime.launch(request);
    // 「启动后最小化启动器」：窗行为归壳层，开关消费点在成功启动之后（失败不缩窗）
    if (runtime.getSettings().minimizeOnLaunch) mainWindow?.minimize();
    return session;
  });
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
  // —— 设置页宿主能力面（SYS_INFO/目录/日志/对话框/外链）——
  handle(IPC_CHANNELS.SYS_INFO, () => runtime.getSystemInfo());
  // 打开特殊目录：白名单枚举、路径宿主解析（渲染侧给不出任意路径）；logs 未生成时先建再开。
  handle(IPC_CHANNELS.SHELL_OPEN_DIR, async (target: SpecialDir) => {
    const dir = target === 'logs-dir' ? path.join(launcherDir(runtime.root), 'logs') : runtime.root;
    fs.mkdirSync(dir, { recursive: true });
    const err = await shell.openPath(dir);
    if (err) throw new Error(err);
  });
  handle(IPC_CHANNELS.LOGS_CLEAR, () => runtime.clearLogs());
  // 原生对话框选择（java 可执行 / 目录）：取消 = ok(null)，与 CUSTOM_IMPORT_JAR 同语义。
  ipcMain.handle(IPC_CHANNELS.DIALOG_PICK, async (_event, kind: PickTarget): Promise<IpcResult<string | null>> => {
    try {
      const res = await dialog.showOpenDialog({
        title: kind === 'java-executable' ? '选择 Java 可执行文件' : '选择文件夹',
        properties: kind === 'java-executable' ? ['openFile'] : ['openDirectory', 'createDirectory'],
        ...(kind === 'java-executable' && process.platform === 'win32'
          ? { filters: [{ name: 'java 可执行文件', extensions: ['exe'] }] }
          : {}),
      });
      const picked = res.filePaths[0];
      return { ok: true, value: res.canceled || !picked ? null : picked };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  // 外链出门：协议白名单 http/https（渲染进程拿不到 shell，唯一出门口收紧校验）。
  handle(IPC_CHANNELS.SHELL_OPEN_URL, async (url: string) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`非法 URL：${url}`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`仅允许 http/https 协议：${parsed.protocol}`);
    }
    await shell.openExternal(parsed.toString());
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
  // 控制台 backlog 补拉（丢首批日志的竞态修复）：新窗订阅后按 pid 拉取已发射输出与退出事件。
  handle<[number], GameBacklog>(IPC_CHANNELS.GAME_BACKLOG, (pid) => {
    const b = backlogs.get(pid);
    if (!b) return { lines: [], exit: null, truncated: false };
    return { lines: [...b.entries], exit: b.exit, truncated: b.truncated };
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
