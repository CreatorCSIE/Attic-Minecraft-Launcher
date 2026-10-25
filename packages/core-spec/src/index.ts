/**
 * @attic/core-spec — IPC 契约唯一真相（戒律 #2）。
 * 纯形状与常量：不含任何实现逻辑；quirk/版本判断一律以数据字段表达（戒律 #1）。
 */

export type { Account, AccountType, AccountView, MicrosoftAccount, OfflineAccount } from './account';
export type { CustomInfoView, CustomVersionView } from './custom';
export type { ModCategoryRaw, ModCategoryView, ModEntryRaw, ModEntryView, ModInstallRequest } from './mods';
export { IPC_CHANNELS, IPC_EVENTS, NOT_IMPLEMENTED } from './ipc';
export type {
  AtticEventPayloads,
  DownloadItem,
  DownloadProgressEvent,
  GameBacklog,
  GameExitEvent,
  GameOutputEvent,
  IpcChannel,
  IpcEventName,
  IpcResult,
  LaunchRequest,
  PickTarget,
  RendererBridge,
  SpecialDir,
  SystemInfo,
  UpdateCheckResult,
  WindowAction,
} from './ipc';
export type {
  AgentMount,
  BetacraftExtension,
  DownloadArtifact,
  LibraryInfo,
  VersionArgument,
  VersionEra,
  VersionJson,
  VersionManifest,
  VersionRef,
  VersionRepository,
  VersionRule,
} from './version';
export type {
  JavaArchitecture,
  JavaDetectionReport,
  JavaDiscoverySource,
  JavaInstall,
  JavaProbeFailure,
  JavaSelection,
  JavaVersion,
} from './java';
export type {
  CrashCategory,
  CrashSummary,
  GameExit,
  GameSession,
  GameStatus,
  LaunchConfig,
} from './launch';
export type {
  AddonDef,
  AppSettings,
  EndpointOverrides,
  InstanceView,
  MemoryMode,
  ThemeMode,
} from './settings';
export { INSTANCE_ADDONS, DEFAULT_ADDONS } from './settings';
