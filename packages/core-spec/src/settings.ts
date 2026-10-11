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
  /** 端点覆盖；改动在下次启动应用后生效（端点属构造级配置）。 */
  endpoints?: EndpointOverrides;
}

/**
 * 实例的渲染侧视图——薄档案：仅携带版本与可选 Java 覆盖。
 * gameDir 由宿主按 v1 惯例派生（`<root>/<version>`），不进契约；内存取全局设置。
 */
export interface InstanceView {
  name: string;
  version: string;
  javaPath?: string;
}
