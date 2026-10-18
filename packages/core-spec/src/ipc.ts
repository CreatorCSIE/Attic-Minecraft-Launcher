/**
 * IPC 契约：通道名、请求/响应、事件、渲染桥面。
 * 双壳（TS/Rust）只允许引用此处定义（戒律 #2）；Rust 侧镜像见 docs/contract.md。
 */

import type { AccountView } from './account';
import type { GameExit, GameSession, GameStatus, LaunchConfig } from './launch';
import type { JavaDetectionReport } from './java';
import type { AppSettings, InstanceView } from './settings';
import type { VersionJson, VersionRef } from './version';

/** 统一的 invoke 结果封装：错误不跨进程抛异常，以数据返回。 */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** IPC 请求通道（invoke/handle 风格，渲染 → 宿主）。 */
export const IPC_CHANNELS = {
  /** 骨架连通性探测（保留为健康检查）。 */
  PING: 'attic:ping',
  /** 版本清单（缓存优先，端点可配置）。 */
  VERSIONS_LIST: 'attic:versions:list',
  /** 单个版本的解析后 JSON（含 Betacraft 扩展）。 */
  VERSIONS_JSON: 'attic:versions:json',
  /** 干跑：返回拼装好的 LaunchConfig，不启动进程（契约测试与排障面板共用）。 */
  LAUNCH_DRY_RUN: 'attic:launch:dry-run',
  /** 启动游戏进程。 */
  LAUNCH: 'attic:launch',
  /** 请求终止当前游戏进程。 */
  KILL: 'attic:kill',
  /** 游戏进程状态（也可轮询）。 */
  STATUS: 'attic:status',
  /** Java 探测全量报告。 */
  JAVA_DETECT: 'attic:java:detect',
  /** 账户列表（脱敏视图；可为空——空列表时启动按钮禁用）。 */
  ACCOUNTS_LIST: 'attic:accounts:list',
  /** 添加离线账户（name 按 MC 规则 3-16 位字母数字下划线校验；同名幂等返回既有）。 */
  ACCOUNTS_ADD: 'attic:accounts:add',
  /** 移除账户（按 id；可移除至空，无默认账户回落）。 */
  ACCOUNTS_REMOVE: 'attic:accounts:remove',
  /** 重命名离线账户（同名校验；离线 UUID 随用户名重生成，id 即新 UUID）。 */
  ACCOUNTS_RENAME: 'attic:accounts:rename',
  /** 读取全局设置（launcher.settings 的渲染侧视图）。 */
  SETTINGS_GET: 'attic:settings:get',
  /** 写入全局设置（合并落盘，返回保存后的视图）。 */
  SETTINGS_SET: 'attic:settings:set',
  /** 实例列表（薄档案）。 */
  INSTANCES_LIST: 'attic:instances:list',
  /** 保存实例（新建/覆盖，返回保存后的视图）。 */
  INSTANCES_SAVE: 'attic:instances:save',
  /** 无边距窗控制（顶栏三键；动作见 WindowAction）。 */
  WINDOW_CONTROL: 'attic:window:control',
  /** 打开/聚焦独立控制台窗口（v1 语义：MC 日志独立窗，与主页解耦）。 */
  WINDOW_CONSOLE: 'attic:window:console',
} as const;

/** 窗口控制动作：toggle-maximize 由宿主在最大化/还原间切换。 */
export type WindowAction = 'minimize' | 'toggle-maximize' | 'close';

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/** 宿主未实现通道的统一错误值（Phase 2/4 实现前，桥面返回该错误而非挂起）。 */
export const NOT_IMPLEMENTED = 'not-implemented';

/** 事件通道（宿主 → 渲染，推送式）。 */
export const IPC_EVENTS = {
  /** 游戏 stdout/stderr 流（逐行或逐块，UI 控制台面板消费）。 */
  GAME_OUTPUT: 'attic:game:output',
  /** 游戏进程退出（含崩溃分类摘要）。 */
  GAME_EXIT: 'attic:game:exit',
  /** 下载进度（jar/资产/Java/legacyfix 统一形状）。 */
  DOWNLOAD_PROGRESS: 'attic:download:progress',
} as const;

export type IpcEventName = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS];

export interface GameOutputEvent {
  stream: 'stdout' | 'stderr';
  chunk: string;
  pid: number;
}

export interface GameExitEvent extends GameExit {
  pid: number;
  versionId: string;
}

/** 下载项类别。 */
export type DownloadItem =
  | 'version-manifest'
  | 'version-json'
  | 'client-jar'
  | 'asset-index'
  | 'asset'
  | 'library'
  | 'java-runtime'
  | 'legacyfix';

export interface DownloadProgressEvent {
  item: DownloadItem;
  /** 被下载对象的标识（版本 id / 资产 hash / 文件名）。 */
  id: string;
  /** 阶段：排队、传输、校验（sha1）、完成。 */
  phase: 'queued' | 'transferring' | 'verifying' | 'done' | 'failed';
  bytesDone: number;
  /** 未知大小（chunked）时缺省。 */
  bytesTotal?: number;
  /** 瞬时速率 B/s（可得时）。 */
  bytesPerSec?: number;
  /** failed 阶段的短原因。 */
  error?: string;
}

/** 事件名 → payload 映射（on() 的类型安全来源）。 */
export interface AtticEventPayloads {
  'attic:game:output': GameOutputEvent;
  'attic:game:exit': GameExitEvent;
  'attic:download:progress': DownloadProgressEvent;
}

export interface LaunchRequest {
  versionId: string;
  /** 实例名；缺省 = `default instance`（v1 语义：gameDir 由实例派生，同实例切版本共享存档，选中版本写回实例）。 */
  instanceId?: string;
  /** 缺省 = 当前选中账户；离线单用户起步时可为空。 */
  accountId?: string;
  /** 覆盖 Java 探测自动选择的结果。 */
  javaPath?: string;
  maxMemoryMb?: number;
  /** 追加 JVM 参数（排障逃生舱）。 */
  extraJvmArgs?: string[];
  /** 游戏参数覆盖（server/port 等，进 gameArgs 拼装）。 */
  gameParams?: Record<string, string>;
  /**
   * 测试启动：宿主把启动前后日志（启动器侧时间戳行 + 游戏 stdout/stderr 全量）
   * 落盘 `<root>/launcher/logs/test-launch-<ISO>.log`，并自动唤起独立控制台窗口。
   */
  testLaunch?: boolean;
}

/** preload/桥面：渲染进程看到的全部能力面。 */
export interface RendererBridge {
  ping(): Promise<IpcResult<string>>;
  listVersions(): Promise<IpcResult<VersionRef[]>>;
  getVersionJson(versionId: string): Promise<IpcResult<VersionJson>>;
  dryRunLaunch(request: LaunchRequest): Promise<IpcResult<LaunchConfig>>;
  launch(request: LaunchRequest): Promise<IpcResult<GameSession>>;
  kill(): Promise<IpcResult<GameExit>>;
  status(): Promise<IpcResult<GameStatus>>;
  detectJava(): Promise<IpcResult<JavaDetectionReport>>;
  listAccounts(): Promise<IpcResult<AccountView[]>>;
  addAccount(name: string): Promise<IpcResult<AccountView>>;
  removeAccount(id: string): Promise<IpcResult<void>>;
  renameAccount(id: string, name: string): Promise<IpcResult<AccountView>>;
  getSettings(): Promise<IpcResult<AppSettings>>;
  setSettings(settings: AppSettings): Promise<IpcResult<AppSettings>>;
  listInstances(): Promise<IpcResult<InstanceView[]>>;
  saveInstance(instance: InstanceView): Promise<IpcResult<InstanceView>>;
  windowControl(action: WindowAction): Promise<IpcResult<void>>;
  openConsoleWindow(): Promise<IpcResult<void>>;
  /** 订阅事件，返回退订函数。 */
  on<E extends keyof AtticEventPayloads>(event: E, cb: (payload: AtticEventPayloads[E]) => void): () => void;
}
