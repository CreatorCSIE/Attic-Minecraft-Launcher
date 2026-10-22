/**
 * 应用设置与实例的渲染侧契约（Phase 3 UI v0）。
 * 戒律 #1：设置/实例是数据，落盘走宿主 `launcher.settings` / `instances/*.txt`（v1 格式兼容）；
 * 渲染侧只通过本契约读写，绝不直接碰文件。
 * 戒律 #2：本文件与 ipc.ts 通道、runtime 映射、docs/contract.md 四处同步。
 */

/** 主题模式（持久化以便双壳一致；解析/应用属渲染侧）。 */
export type ThemeMode = 'dark' | 'light' | 'system';

/** 内存分配模式（BlockHelm 语义移植）：auto = 宿主按总内存估算；manual = 用 maxMemoryMb。 */
export type MemoryMode = 'auto' | 'manual';

/**
 * 端点覆盖（风险 #1）：全部为可 IPC 序列化的纯字符串。
 * 函数形态的 `versionJson(id)`/`assetIndex(id)` 由 `filesBase` 在 runtime 侧派生，
 * 契约层不携带可调用形状（跨进程不可序列化）。
 */
export interface EndpointOverrides {
  /** 版本清单 URL；缺省 = `<filesBase>/version_list.txt`。 */
  versionList?: string;
  /** Betacraft files 基址（派生 versionJson/assetIndex）；缺省 = `http://files.betacraft.uk/launcher/assets`。 */
  filesBase?: string;
  /** legacyfix GitHub Release API；缺省 = betacraftuk/legacyfix latest。 */
  legacyfixRelease?: string;
  /** Azul Zulu 元数据 API。 */
  zuluMetadata?: string;
  /** Mojang 版本清单（库池回填）。 */
  mojangManifest?: string;
  /** Betacraft mod 仓库列表（getmods.jsp JSON）；缺省 = `http://api.betacraft.uk/getmods.jsp`。 */
  modsList?: string;
}

/** 全局应用设置（`launcher.settings` 的渲染侧视图；缺省字段 = 沿用宿主默认）。 */
export interface AppSettings {
  /** 手动 Java 路径；缺省 = 自动探测（探测失败再 Zulu 供给，风险 #7）。设置即手动模式，清空即回自动（Java 栏双态由此派生）。 */
  javaPath?: string;
  /** 堆内存上限 MB；缺省 = 1024（memoryMode=auto 时被宿主估算值取代）。 */
  maxMemoryMb?: number;
  /** 内存分配模式；缺省 = manual（保持老用户/老档案既有的定值 1024 语义，auto 属 opt-in）。 */
  memoryMode?: MemoryMode;
  // （原 username 字段已删，2026-10-22 用户拍板：账户体系落地后零消费方的孤儿设置——
  // 启动玩家名恒取所选账户 account.name；launcher.settings 里的 v1 遗留 username 键
  // 按「未知键原样保留」纪律不再读写、不清除。）
  /** 主题；缺省 = system。 */
  theme?: ThemeMode;
  /** 启动器界面语言（i18n locale 键，如 `zh-CN`/`en`）；缺省 = 渲染侧默认。渲染侧热切换生效，无重启语义。 */
  language?: string;
  /**
   * 全局 JVM 参数（BlockHelm 语义：固定 `-Xmx/-Xms` 之后、实例 launchArgs 之前注入，
   * 实例级同名参数按 JVM「后者胜」规则覆盖全局）。空白分隔。
   */
  jvmArgs?: string;
  /** 启动前复核版本 jar sha1；缺省 true。false = 本地存在即复用（大 jar 省哈希时间，坏文件不发现）。 */
  checkIntegrity?: boolean;
  /** 缺失/损坏自动补全（重下载）；缺省 true，仅在 checkIntegrity 生效时有意义。false = 发现问题显式报错，不擅动文件。 */
  fixMissing?: boolean;
  /** 启动成功后最小化主窗（宿主窗行为）；缺省 false。 */
  minimizeOnLaunch?: boolean;
  /** 诊断日志：每次启动都写 launcher/logs（普通启动也落盘，testLaunch 通道不受此开关影响恒写）；缺省 false。 */
  diagnosticLog?: boolean;
  /**
   * 启动成功后自动打开独立控制台窗（v1「Game log」开关的全局化转置——v1 放实例对话框属其时代产物，
   * Attic 判定为用户习惯而非实例属性）；缺省 true = 维持既有"每次启动弹窗"行为。
   * testLaunch 不受此开关影响恒弹（显式诊断语义）。
   */
  consoleOnLaunch?: boolean;
  /**
   * 数据根覆盖（更换目录逃生舱）：下次启动应用后生效——root 属构造级配置，
   * 宿主启动时从平台默认根的 launcher.settings 读本键。portable/env 覆盖优先级更高。
   */
  rootOverride?: string;
  /**
   * LegacyFix 关卡存档模式（JVM 属性 `lf.proxy.levelServer` 直通）：
   * `local`=强制本地单人存档；URL=在线关卡代理；缺省=LegacyFix 一次性对话框。
   * 有值时对话框永不弹，且覆盖游戏目录里陈旧的 `legacyfix/level-server.txt`（属性优先于文件）。
   */
  levelServer?: string;
  /** 端点覆盖；改动在下次启动应用后生效（端点属构造级配置）。 */
  endpoints?: EndpointOverrides;
}

/**
 * 实例的渲染侧视图——对齐 v1 Instance Settings 可编辑集（名字/版本/目录/JVM 参数/窗口尺寸/Java 路径）。
 * 版本是实例属性（v1 `InstanceSettings` 语义：同实例切版本存档共享）。gameDir 缺省 = 宿主派生
 * `root/<实例名>`（v1 `Instance.newInstance`）；内存另有全局设置，实例 `launchArgs` 在其后注入（后者生效）。
 */
export interface InstanceView {
  name: string;
  version: string;
  /** 游戏目录；缺省 = `root/<实例名>`。 */
  gameDir?: string;
  /** JVM 参数（v1 `launchArgs`，如 `-Xmx1G`），空白分隔注入 jvmArgs。 */
  launchArgs?: string;
  /** 窗口宽（Applet 容器 `--width`；v1 缺省 854）。 */
  width?: number;
  /** 窗口高（Applet 容器 `--height`；v1 缺省 480）。 */
  height?: number;
  javaPath?: string;
  /** 勾选的 addon id 集（v1 `addons` 档案键 = 逗号分隔；视图用数组，宿主序列化）。 */
  addons?: string[];
  /**
   * Intel 显卡修复（v1 `intelFix` 档案键，同名；v1 缺省 true）。Windows 上注入
   * `-XX:HeapDumpPath=java.exe_minecraft.exe.heapdump`（v1 Launcher.java L576-578 原样），
   * 其余平台宿主不注入。缺键 = true（v1 语义）。
   */
  intelFix?: boolean;
  /**
   * 强制更新（Attic 扩展键；v1 是全局 static `Launcher.forceUpdate`，不落实例档案——
   * Attic 判定为实例属性放基本设置）。true = 启动时旁路 jar/库/资产的「已存在即复用」检查重下。
   */
  forceUpdate?: boolean;
}

/**
 * 实例 addon 目录（数据驱动，戒律 #1）：id 入 v1 `addons` 档案键，
 * prop/mode 映射 legacyfix 的 -Dlf.* 开关（事实源：legacyfix docs/Additional settings.md）。
 * mode=enable：勾选才注入 prop；mode=disable：取消才注入（功能默认开，如皮肤/代理）。
 * placeholder：v1 addons 有、legacyfix 无对应开关 → UI 占位禁用，不参与装配。
 * uiSection：渲染归属——'basic'=实例页基本设置 card，'launchmenu'=启动页「≡」菜单
 * （动作项：点击 = `LaunchRequest.visualizer` 一次性启动，不读写档案），缺省 'addons'=Addons card。
 * 仅影响 UI 布局，数据模型不变。
 * probeClass：launchmenu 项的启用前置探测（选中版本 client jar 需含此 class 条目才可点击）。
 */
export interface AddonDef {
  id: string;
  /** legacyfix JVM 属性名（不含 `-Dlf.` 前缀）；placeholder 项为空串。 */
  prop: string;
  mode: 'enable' | 'disable';
  placeholder?: boolean;
  uiSection?: 'basic' | 'addons' | 'launchmenu';
  /** jar 内条目路径（如 `net/minecraft/isom/IsomPreviewApplet.class`）；uiSection=launchmenu 时提供。 */
  probeClass?: string;
}

export const INSTANCE_ADDONS: AddonDef[] = [
  // 基本设置 card（v1 实例对话框常用项，用户指定迁出 Addons 列表）
  { id: 'vsync', prop: 'vsync', mode: 'enable', uiSection: 'basic' },
  { id: 'proxy', prop: 'proxy.disable', mode: 'disable', uiSection: 'basic' },
  { id: 'skins', prop: 'skin.disable', mode: 'disable', uiSection: 'basic' },
  { id: 'server-auth', prop: 'auth-on-server-join.disable', mode: 'disable', uiSection: 'basic' },
  // Addons card
  { id: 'modloader', prop: 'modloader', mode: 'enable' },
  { id: 'beta-forge', prop: 'beta-forge', mode: 'enable' },
  { id: 'bouncycastle', prop: 'bouncycastle', mode: 'enable' },
  { id: 'show-notice', prop: 'showNotice', mode: 'enable' },
  // v1 Demo addon 转正：legacyfix 原生 -Dlf.demo 即等价开关（GameArgs.isDemo），无需 wrapper；
  // v1 官方生效区间 12w16a–1.5.2，区间外该属性无感
  { id: 'demo', prop: 'demo', mode: 'enable' },
  // v1 addons 清单占位（legacyfix 无对应开关，接入后转正）
  { id: 'fullscreen', prop: '', mode: 'enable', placeholder: true },
  { id: 'game-mode-switch', prop: '', mode: 'enable', placeholder: true },
  { id: 'quit-game', prop: '', mode: 'enable', placeholder: true },
  // 启动页「≡」菜单动作项（探测到类才可点击；点击 = LaunchRequest.visualizer 一次性注入，
  // 档案 addons 仍可携带同 id = 常开语义，装配器去重不双注；legacyfix 26.10 Release
  // 已含 VisualizerPatch/VisualizerLauncher（nightly 依赖废除，生效条件满足））
  {
    id: 'visualizer',
    prop: 'visualizer',
    mode: 'enable',
    uiSection: 'launchmenu',
    probeClass: 'net/minecraft/isom/IsomPreviewApplet.class',
  },
];

/** 新建实例的默认勾选集 = 默认开功能全开（与 legacyfix 自身缺省一致）。 */
export const DEFAULT_ADDONS: string[] = INSTANCE_ADDONS.filter((a) => a.mode === 'disable' && !a.placeholder).map((a) => a.id);
