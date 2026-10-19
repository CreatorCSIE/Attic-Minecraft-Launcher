/**
 * 应用设置与实例的渲染侧契约（Phase 3 UI v0）。
 * 戒律 #1：设置/实例是数据，落盘走宿主 `launcher.settings` / `instances/*.txt`（v1 格式兼容）；
 * 渲染侧只通过本契约读写，绝不直接碰文件。
 * 戒律 #2：本文件与 ipc.ts 通道、runtime 映射、docs/contract.md 四处同步。
 */

/** 主题模式（持久化以便双壳一致；解析/应用属渲染侧）。 */
export type ThemeMode = 'dark' | 'light' | 'system';

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
}

/** 全局应用设置（`launcher.settings` 的渲染侧视图；缺省字段 = 沿用宿主默认）。 */
export interface AppSettings {
  /** 手动 Java 路径；缺省 = 自动探测（探测失败再 Zulu 供给，风险 #7）。 */
  javaPath?: string;
  /** 堆内存上限 MB；缺省 = 1024。 */
  maxMemoryMb?: number;
  /** 离线/默认用户名；缺省 = Player。 */
  username?: string;
  /** 主题；缺省 = system。 */
  theme?: ThemeMode;
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
}

/**
 * 实例 addon 目录（数据驱动，戒律 #1）：id 入 v1 `addons` 档案键，
 * prop/mode 映射 legacyfix 的 -Dlf.* 开关（事实源：legacyfix docs/Additional settings.md）。
 * mode=enable：勾选才注入 prop；mode=disable：取消才注入（功能默认开，如皮肤/代理）。
 * placeholder：v1 addons 有、legacyfix 无对应开关 → UI 占位禁用，不参与装配。
 */
export interface AddonDef {
  id: string;
  /** legacyfix JVM 属性名（不含 `-Dlf.` 前缀）；placeholder 项为空串。 */
  prop: string;
  mode: 'enable' | 'disable';
  placeholder?: boolean;
}

export const INSTANCE_ADDONS: AddonDef[] = [
  { id: 'vsync', prop: 'vsync', mode: 'enable' },
  { id: 'visualizer', prop: 'visualizer', mode: 'enable' },
  { id: 'modloader', prop: 'modloader', mode: 'enable' },
  { id: 'beta-forge', prop: 'beta-forge', mode: 'enable' },
  { id: 'bouncycastle', prop: 'bouncycastle', mode: 'enable' },
  { id: 'show-notice', prop: 'showNotice', mode: 'enable' },
  { id: 'skins', prop: 'skin.disable', mode: 'disable' },
  { id: 'proxy', prop: 'proxy.disable', mode: 'disable' },
  { id: 'server-auth', prop: 'auth-on-server-join.disable', mode: 'disable' },
  // v1 addons 清单占位（legacyfix 无对应开关，接入后转正）
  { id: 'fullscreen', prop: '', mode: 'enable', placeholder: true },
  { id: 'game-mode-switch', prop: '', mode: 'enable', placeholder: true },
  { id: 'quit-game', prop: '', mode: 'enable', placeholder: true },
];

/** 新建实例的默认勾选集 = 默认开功能全开（与 legacyfix 自身缺省一致）。 */
export const DEFAULT_ADDONS: string[] = INSTANCE_ADDONS.filter((a) => a.mode === 'disable' && !a.placeholder).map((a) => a.id);
