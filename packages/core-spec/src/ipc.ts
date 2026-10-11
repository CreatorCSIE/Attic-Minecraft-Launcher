/**
 * IPC 契约：通道名、请求/响应、事件、渲染桥面。
 * 双壳（TS/Rust）只允许引用此处定义（戒律 #2）；Rust 侧镜像见 docs/contract.md。
 */

import type { AccountView } from './account';
import type { GameExit, GameSession, GameStatus, LaunchConfig } from './launch';
import type { JavaDetectionReport } from './java';
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
  /** 账户列表（脱敏视图）。 */
  ACCOUNTS_LIST: 'attic:accounts:list',
} as const;

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
  /** 缺省 = 当前选中账户；离线单用户起步时可为空。 */
  accountId?: string;
  /** 覆盖 Java 探测自动选择的结果。 */
  javaPath?: string;
  maxMemoryMb?: number;
  /** 追加 JVM 参数（排障逃生舱）。 */
  extraJvmArgs?: string[];
  /** 游戏参数覆盖（server/port 等，进 gameArgs 拼装）。 */
  gameParams?: Record<string, string>;
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
  /** 订阅事件，返回退订函数。 */
  on<E extends keyof AtticEventPayloads>(event: E, cb: (payload: AtticEventPayloads[E]) => void): () => void;
}
