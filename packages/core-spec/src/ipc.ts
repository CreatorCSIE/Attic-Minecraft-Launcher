/**
 * IPC 契约：通道名、请求/响应、事件、渲染桥面。
 * 双壳（TS/Rust）只允许引用此处定义（戒律 #2）；Rust 侧镜像见 docs/contract.md。
 */

import type { AccountView } from './account';
import type { CustomInfoView, CustomVersionView } from './custom';
import type { GameExit, GameSession, GameStatus, LaunchConfig } from './launch';
import type { JavaDetectionReport } from './java';
import type { ModCategoryView, ModInstallRequest } from './mods';
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
  /** 探测本地 client jar 是否含指定 class 条目（启动页「≡」菜单项启用判定；jar 未下载 = false）。 */
  VERSION_PROBE_CLASS: 'attic:version:probe-class',
  /** 干跑：返回拼装好的 LaunchConfig，不启动进程（契约测试与排障面板共用）。 */
  LAUNCH_DRY_RUN: 'attic:launch:dry-run',
  /** 启动游戏进程。 */
  LAUNCH: 'attic:launch',
  /** 取消进行中的启动（0.0.2 feat①）：中止启动前的下载/补全链；游戏已 spawn = 无效（走 KILL）。 */
  LAUNCH_CANCEL: 'attic:launch:cancel',
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
  /** 删除实例档案；withFiles=true 时连 gameDir 一并递归删（护栏在宿主），否则存档数据不动。 */
  INSTANCES_DELETE: 'attic:instances:delete',
  /** 改实例名（v1 语义：档案迁移，gameDir 原样带走——改名不动目录）。 */
  INSTANCES_RENAME: 'attic:instances:rename',
  /** 在系统文件管理器打开实例 gameDir（宿主 shell.openPath；目录不存在则先创建）。 */
  INSTANCES_OPEN_DIR: 'attic:instances:open-dir',
  /** 版本选中即写回实例（v1 SelectVersion.saveVersion 语义）：宿主 properties 级单字段
   * 读-改-写，保留档案其余全部键；name 空 → 回落默认实例（不存在则建档）。 */
  INSTANCES_SET_VERSION: 'attic:instances:set-version',
  /** 无边距窗控制（顶栏三键；动作见 WindowAction）。 */
  WINDOW_CONTROL: 'attic:window:control',
  /** 打开/聚焦独立控制台窗口（v1 语义：MC 日志独立窗，与主页解耦）。 */
  WINDOW_CONSOLE: 'attic:window:console',
  /** 控制台积压日志补拉（backlog）：新建控制台窗订阅后拉取本会话已发射的输出与退出事件，
   * 消除「spawn 即发射、窗未挂载即丢」竞态（LegacyFix premain 首批日志丢失的根因修复）。 */
  GAME_BACKLOG: 'attic:game:backlog',
  /** 自定义版本列表（仅 custom 项：裸 jar=未配置 / .info custom=true=已配置；官方版本不落入）。 */
  CUSTOM_LIST: 'attic:custom:list',
  /** 读取单个自定义版本的 .info 原始属性（未配置裸 jar 附 detectLaunchMethod 建议）。 */
  CUSTOM_GET_INFO: 'attic:custom:info',
  /** 保存自定义版本 .info（强制 custom=true；空值删除；非法 launch-method 显式报错）。 */
  CUSTOM_SAVE_INFO: 'attic:custom:info:save',
  /** 导入自定义版本 jar（宿主弹原生文件对话框；取消=返回 null）。 */
  CUSTOM_IMPORT_JAR: 'attic:custom:import-jar',
  /** 删除自定义版本（jar 与 .info 一并移除；官方版本拒绝）。 */
  CUSTOM_REMOVE: 'attic:custom:remove',
  /** Mod 仓库列表（一期 = Betacraft 单源；每次全量拉取上游 JSON，宿主附 installed 标记；失败=错误，UI 空态+重试）。 */
  MODS_LIST: 'attic:mods:list',
  /** 安装 mod = GET info_file_url 原子落 versions/jsons/<full_name>.info + 登记 launcher/mods.json（jar 与基座合成延迟到启动）。 */
  MODS_INSTALL: 'attic:mods:install',
  /** 系统/宿主快照（设置页一次性取：启动器版本/平台/数据根/日志目录/总内存/可用内存）。 */
  SYS_INFO: 'attic:sys:info',
  /** 检查更新（GitHub Releases latest；未配置/失败也以数据返回，UI 弹窗可见呈现）。 */
  UPDATE_CHECK: 'attic:update:check',
  /** 打开特殊目录（数据根/日志目录；枚举参数，渲染侧不传任意路径——openPath 面收紧到白名单目标）。 */
  SHELL_OPEN_DIR: 'attic:shell:open-dir',
  /** 清理启动器日志目录（只删 launcher/logs 下的 *.log；返回删除个数）。 */
  LOGS_CLEAR: 'attic:logs:clear',
  /** 原生文件/目录对话框选择（kind 见 PickTarget；取消 = null）。 */
  DIALOG_PICK: 'attic:dialog:pick',
  /** 系统浏览器打开外链（宿主校验 http/https 协议，拒绝其余 scheme）。 */
  SHELL_OPEN_URL: 'attic:shell:open-url',
  /** 渲染层错误静默上报（P2）：宿主落 launcher.log，不弹任何框（window error/unhandledrejection/Vue errorHandler）。 */
  CRASH_REPORT: 'attic:crash:report',
  /** 拉取崩溃诊断包（栈 + 环境 + 两日志尾部 + 预填 issue 链接）：CrashPanel 三按钮数据源。 */
  CRASH_BUNDLE: 'attic:crash:bundle',
} as const;

/** 可打开的特殊目录目标（SHELL_OPEN_DIR 白名单；路径解析在宿主，渲染侧只给意图）。 */
export type SpecialDir = 'data-root' | 'logs-dir';

/**
 * 启动取消结果（LAUNCH_CANCEL）：cancelled=false = 没有在途启动可取消（或游戏已 spawn，
 * 取消窗口已过，应走 KILL）；true = 中止信号已发出，launch() 将以 LAUNCH_CANCELLED_MESSAGE 失败。
 */
export interface LaunchCancelResult {
  cancelled: boolean;
}

/**
 * 取消启动的归一失败文案（feat①）：宿主 launch() 因取消中止时以此文案抛/回，
 * UI 据此识别「用户主动取消」落中性态——不记 lastError、不显红态。
 */
export const LAUNCH_CANCELLED_MESSAGE = '启动已取消';

/** 对话框选择目标（DIALOG_PICK）：java 可执行文件 / 任意目录。 */
export type PickTarget = 'java-executable' | 'directory';

/** 宿主环境快照（设置页展示 + 内存滑杆上限推导的数据源）。 */
export interface SystemInfo {
  /** 启动器版本（宿主注入：electron = app.getVersion()）。 */
  launcherVersion: string;
  /** process.platform 原样值。 */
  platform: string;
  /** 生效中的数据根绝对路径（rootOverride 应用后的结果）。 */
  dataRoot: string;
  /** 平台默认根绝对路径（rootOverride 指针的落位，与宿主 bootstrap peek 同语义；portable 下也是它——指针位不随模式变）。 */
  defaultRoot: string;
  /** 默认根是否已有既有数据（文件标记口径：settings——须含便携登记簿 lastPortableRoot/portableFallback 之外的键，机器生成面包屑不算——/accounts/实例/版本 jar；ensureLayout 骨架不误判；首启向导门之三安装版数据源：true = 老用户，不弹）。 */
  defaultRootPopulated: boolean;
  /** 启动器日志目录（`<dataRoot>/launcher/logs`）。 */
  logsDir: string;
  /** 系统总物理内存 MB（取不到 = 0，UI 端滑杆回退保守上限）。 */
  totalMemMb: number;
  /** 系统当前可用内存 MB（取不到 = 0）。 */
  freeMemMb: number;
  /** 壳形态（宿主构造注入：tauri = sidecar 传 'tauri'；electron/legacy 缺省 'electron' 保守）。 */
  shell: 'tauri' | 'electron';
  /**
   * 上次启动器异常退出简报（P0 脏退出标记的下次启动消费，缺席 = 上次正常退出）：
   * 标记读后即删，本快照只弹一次横幅。stack = 崩溃栈（宿主侧截断），summary = 栈首行。
   */
  lastCrash?: CrashBrief;
  /**
   * portable 便携态（B 期，plan.md 2026-10-25 终拍；安装版省略本键）：
   * 宿主显式传程序目录（sidecar 的 process.execPath = node.exe 不可信，硬纪律），
   * runtime 按双指纹判定 = 程序目录 marker 在场 ∨（exe 旁 `.attic` ∧ 其内 `launcher/portable.anchor`）。
   */
  portable?: {
    /** 双指纹判定命中（含只读回落态——身份是便携，只是数据暂不随盘）。 */
    active: boolean;
    /** exeDir 实写探针不可写 → 生效根已回落默认根（数据未随盘，UI 常驻徽标）。 */
    fallback: boolean;
    /**
     * 便携生效根是否已有真实用户数据（B 期修复 2026-10-25：构造期 ensureLayout 前快照，
     * hasUserData 文件标记口径——骨架不误判）。向导门之三 portable 数据源 = 本键而非
     * defaultRootPopulated：安装版/dev 历史在默认根，不得压掉便携首启弹窗；
     * 只读回落态生效根 = 默认根，本键自然回落「默认根老用户」老语义。
     */
    rootPopulated: boolean;
    /** marker ini 缺席、anchor 自愈命中（升级重解压重置/误删 ini 后的便携身份恢复）。 */
    rebuilt?: boolean;
    /** 生效根路径警示（警告不拦截，LWJGL2/Java8 非 ASCII 翻车面留给用户决策）：非 ASCII / 含空格 / 长度逼近 260（阈值 ≥240）。 */
    pathWarning?: 'non_ascii' | 'space' | 'long';
  };
}

/** 启动器异常退出简报（脏退出标记内容；SYS_INFO.lastCrash 投给 UI 横幅）。 */
export interface CrashBrief {
  /** ISO 时间（崩溃当场）。 */
  at: string;
  /** 崩溃类别（uncaught-exception / unhandled-rejection / render-process-gone / …）。 */
  category: string;
  /** 栈首行摘要（≤120 字符）。 */
  summary: string;
  /** 崩溃栈（宿主截断至 4000 字符；全量在 launcher/logs/crash-*.txt）。 */
  stack: string;
}

/** 渲染层错误上报（CRASH_REPORT，P2）：静默落 launcher.log，不弹框。 */
export interface RendererErrorReport {
  /** 来源标识：window-error | unhandled-rejection | vue-error。 */
  source: string;
  message: string;
  stack?: string;
}

/** 崩溃诊断包（CRASH_BUNDLE 响应）：text 供剪贴板，issuesUrl = releaseRepo 派生的预填报告链接。 */
export interface CrashBundleResult {
  /** 完整诊断文本（环境 + 栈 + launcher.log/output-client.log 尾 200 行）。 */
  text: string;
  /** GitHub 预填 issue 链接（repo 未配置 = 空串，UI 隐藏报告钮）。 */
  issuesUrl: string;
}

/**
 * 检查更新结果（判别联合；全部分支以数据返回、不抛异常——UI 弹窗可见呈现）。
 * 数据源按轨分流：stable 构件 = GitHub Releases API `/releases/latest`（天然排除 draft/prerelease）；
 * nightly 构件（含 `-nightly.`）= `/releases` 列表轨中匹配（只认同轨 prerelease，跨 base 允许不混 stable）；
 * 其余预发布构件（0.0.x、-rc 等）→ 永不提示，归入 upToDate。
 */
export type UpdateCheckResult =
  | {
      status: 'update';
      /** 新版本号（tag 去 v 前缀）。 */
      version: string;
      /** 发布页 URL（html_url；「打开发布页」动作面）。 */
      url: string;
      /** 发布说明（body 原样纯文本，可空串）。 */
      notes: string;
      /** 发布时间（GitHub published_at 原样 ISO 字符串，可空串）。 */
      publishedAt: string;
    }
  | { status: 'upToDate'; /** 当前版本（宿主注入）。 */ current: string }
  | { status: 'unconfigured' }
  | { status: 'error'; /** 可读失败原因（网络/HTTP 状态/响应形状/仓库格式）。 */ message: string };

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
  /** 自定义版本 .info 外部改动（宿主监视 jsons 目录、按 id 去抖后发射；配置页实时刷新消费）。 */
  CUSTOM_INFO_CHANGED: 'attic:custom:info-changed',
} as const;

export type IpcEventName = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS];

export interface GameOutputEvent {
  stream: 'stdout' | 'stderr';
  chunk: string;
  pid: number;
  /** 宿主在会话内分配的单调序号（electron 主进程广播时盖戳）：
   * 控制台窗用它对「实时事件」与 backlog 补拉结果去重。宿主不实现 backlog 时缺省。 */
  seq?: number;
}

export interface GameExitEvent extends GameExit {
  pid: number;
  versionId: string;
}

/** 控制台 backlog 响应（GAME_BACKLOG）：会话已发射输出 + 已发生的退出事件的补拉快照。 */
export interface GameBacklog {
  /** 本会话输出（按 seq 升序；宿主环形缓冲溢出时只含尾部）。 */
  lines: GameOutputEvent[];
  /** 会话已退出时的退出事件（游戏秒退、控制台窗收不到实时事件的补拉场景）；在跑 = null。 */
  exit: GameExitEvent | null;
  /** 宿主缓冲封顶截断过更早的行。 */
  truncated: boolean;
}

/** 自定义版本 .info 外部改动事件（jsons 目录监视 → 去抖 → 按 id 发射）。 */
export interface CustomInfoChangedEvent {
  /** 改动的 `jsons/<id>.info` 对应版本 id。 */
  id: string;
}

/** 下载项类别。 */
export type DownloadItem =
  | 'version-manifest'
  | 'version-json'
  | 'client-jar'
  | 'mod-jar'
  | 'asset-index'
  | 'asset'
  | 'library'
  | 'java-runtime'
  | 'legacyfix';

export interface DownloadProgressEvent {
  item: DownloadItem;
  /** 被下载对象的标识（版本 id / 资产 hash / 文件名）。 */
  id: string;
  /** 阶段：排队、传输、校验（sha1）、完成、失败、取消（feat①中止——UI 落中性态不报红）。 */
  phase: 'queued' | 'transferring' | 'verifying' | 'done' | 'failed' | 'cancelled';
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
  'attic:custom:info-changed': CustomInfoChangedEvent;
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
  /**
   * 一次性以无限地图可视化器启动（启动页「≡」菜单动作项，探针命中才可发）：
   * 注入 `-Dlf.visualizer`（与 addons 同位，§2.6），**不写实例档案**、本次启动后不留痕。
   */
  visualizer?: boolean;
}

/** preload/桥面：渲染进程看到的全部能力面。 */
export interface RendererBridge {
  ping(): Promise<IpcResult<string>>;
  listVersions(): Promise<IpcResult<VersionRef[]>>;
  getVersionJson(versionId: string): Promise<IpcResult<VersionJson>>;
  /** 本地 jar class 条目探测（VERSION_PROBE_CLASS）：条目路径如 `net/minecraft/isom/IsomPreviewApplet.class`。 */
  probeVersionClass(versionId: string, className: string): Promise<IpcResult<boolean>>;
  dryRunLaunch(request: LaunchRequest): Promise<IpcResult<LaunchConfig>>;
  launch(request: LaunchRequest): Promise<IpcResult<GameSession>>;
  /** 取消进行中的启动前下载/补全链（LAUNCH_CANCEL）；无在途启动/已 spawn = cancelled:false。 */
  cancelLaunch(): Promise<IpcResult<LaunchCancelResult>>;
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
  /** 删除实例档案（档案不存在 = 显式报错，可见失败）；
   * withFiles=true 时宿主连实例目录（gameDir）一并递归删除。 */
  deleteInstance(name: string, withFiles: boolean): Promise<IpcResult<void>>;
  /** 改实例名：成功返回改名后的权威视图；重名/非法名/不存在 = 宿主显式报错。 */
  renameInstance(name: string, newName: string): Promise<IpcResult<InstanceView>>;
  /** 打开实例 gameDir（系统文件管理器；宿主保证目录存在后 openPath）。 */
  openInstanceDir(name: string): Promise<IpcResult<void>>;
  /** 版本选中即写回实例：单字段读-改-写（其余键不动），name 空 → 默认实例；返回宿主权威视图。 */
  setInstanceVersion(name: string | null, versionId: string): Promise<IpcResult<InstanceView>>;
  windowControl(action: WindowAction): Promise<IpcResult<void>>;
  openConsoleWindow(): Promise<IpcResult<void>>;
  /** 拉取指定会话的积压输出与退出事件（控制台窗订阅后补拉；宿主未实现时返回错误、UI 静默降级）。 */
  getGameBacklog(pid: number): Promise<IpcResult<GameBacklog>>;
  listCustomVersions(): Promise<IpcResult<CustomVersionView[]>>;
  getCustomVersionInfo(id: string): Promise<IpcResult<CustomInfoView>>;
  saveCustomVersionInfo(id: string, props: Record<string, string>): Promise<IpcResult<CustomVersionView>>;
  /** 导入自定义版本 jar：宿主弹文件对话框，取消返回 ok(null)。 */
  importCustomJar(): Promise<IpcResult<CustomVersionView | null>>;
  /** 删除自定义版本（jar + .info 一并移除，mod 项联动清 mods.json 登记；官方版本/不存在报错）。 */
  removeCustomVersion(id: string): Promise<IpcResult<void>>;
  /** Mod 仓库列表（Betacraft 单源；宿主每次全量重拉，无进程内缓存残留——v1 loadMods 追加不清空缺陷的结构性修复）。 */
  listMods(): Promise<IpcResult<ModCategoryView[]>>;
  /** 安装 mod（只落 .info + 登记；full_name 非法或与官方清单同名 = 宿主显式拒绝）。 */
  installMod(request: ModInstallRequest): Promise<IpcResult<void>>;
  /** 宿主环境快照（版本/数据根/日志目录/内存——设置页多栏共用）。 */
  getSystemInfo(): Promise<IpcResult<SystemInfo>>;
  /** 检查更新（GitHub Releases latest；未配置/失败也在 value 分支内，不占 error 封装）。 */
  checkUpdate(): Promise<IpcResult<UpdateCheckResult>>;
  /** 在系统文件管理器打开特殊目录（白名单枚举，路径宿主解析）。 */
  openSpecialDir(target: SpecialDir): Promise<IpcResult<void>>;
  /** 清理启动器日志（launcher/logs 下 *.log），返回删除个数。 */
  clearLogs(): Promise<IpcResult<number>>;
  /** 原生对话框选 java 可执行文件（取消 = null）。 */
  pickJavaExecutable(): Promise<IpcResult<string | null>>;
  /** 原生对话框选目录（取消 = null）。 */
  pickDirectory(): Promise<IpcResult<string | null>>;
  /** 系统浏览器打开外链（宿主限 http/https；渲染内导航被禁止后的唯一出门口）。 */
  openExternalUrl(url: string): Promise<IpcResult<void>>;
  /** 渲染层错误静默上报（CRASH_REPORT）：宿主落 launcher.log；本调用永不弹框、失败可忽略。 */
  reportRendererError(report: RendererErrorReport): Promise<IpcResult<void>>;
  /** 拉取崩溃诊断包（CRASH_BUNDLE）：category = 现场类别（可带来源上下文），stack = 渲染侧已知的栈。 */
  getCrashBundle(category: string, stack: string): Promise<IpcResult<CrashBundleResult>>;
  /** 订阅事件，返回退订函数。 */
  on<E extends keyof AtticEventPayloads>(event: E, cb: (payload: AtticEventPayloads[E]) => void): () => void;
}
