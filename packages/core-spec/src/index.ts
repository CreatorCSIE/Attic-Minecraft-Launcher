/**
 * @attic/core-spec — IPC 契约唯一真相（戒律 #2）。
 * 纯形状与常量：不含任何实现逻辑；quirk/版本判断一律以数据字段表达（戒律 #1）。
 */

export type { Account, AccountType, AccountView, MicrosoftAccount, OfflineAccount } from './account';
export { IPC_CHANNELS, IPC_EVENTS, NOT_IMPLEMENTED } from './ipc';
export type {
  AtticEventPayloads,
  DownloadItem,
  DownloadProgressEvent,
  GameExitEvent,
  GameOutputEvent,
  IpcChannel,
  IpcEventName,
  IpcResult,
  LaunchRequest,
  RendererBridge,
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
  AppSettings,
  EndpointOverrides,
  InstanceView,
  ThemeMode,
} from './settings';
