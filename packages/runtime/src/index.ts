/**
 * @attic/runtime — TS 侧启动器核心（Phase 2 落地）。
 * 分层：endpoints/properties/storage/info（基础）→ betacraft/java/zulu（数据）→ launch/process（执行）→ runtime（门面）。
 * 契约类型一律来自 @attic/core-spec（戒律 #2）。
 */

export { DEFAULT_ENDPOINTS, resolveEndpoints, endpointsFromOverrides, type Endpoints } from './endpoints';
export { parseProperties, serializeProperties } from './properties';
export {
  settingsFromProps,
  applySettingsToProps,
  instanceViewFromConfig,
  estimateMaxMemoryMb,
} from './appSettings';
export {
  resolveDataRoot,
  ensureLayout,
  launcherDir,
  instancesDir,
  langDir,
  addonsDir,
  launchMethodsDir,
  settingsFile,
  accountsFile,
  versionListCacheFile,
  binDir,
  nativesDir,
  versionsDir,
  jsonsDir,
  infoFile,
  clientJarFile,
  assetsDir,
  assetIndexFile,
  zuluJavaDir,
  readPropertiesFile,
  writePropertiesFile,
  loadSettings,
  saveSettings,
  listInstances,
  loadInstance,
  saveInstance,
  deleteInstance,
  renameInstance,
  assertInstanceName,
  scanBinPool,
  scanInstalledInfos,
  scanInstalledJars,
  scanInstalledVersions,
  loadAccounts,
  saveAccounts,
  offlineUuid,
  type ResolveDataRootOptions,
  type InstanceConfig,
} from './storage';
export { infoToVersionJson, LAUNCH_METHOD_MAIN_CLASS } from './info';
export { DEFAULT_AGENT_MOUNTS } from './quirks';
export {
  BetacraftClient,
  parseVersionList,
  eraForDate,
  hashFile,
  type BetacraftClientOptions,
  type FetchImpl,
} from './betacraft';
export { detectJavaRuntime } from './java/detect';
export { discoverJavaCandidates, type JavaCandidate } from './java/discover';
export { probeJavaExecutable, type ProbeResult } from './java/probe';
export { selectJavaInstallation, requiredMajor, type JavaDetectionOptions } from './java/select';
export { parseJavaVersion, parseVersionBanner, normaliseArchitecture } from './java/version';
export {
  queryZuluPackages,
  installZuluPackage,
  zuluOs,
  zuluArch,
  type ZuluPackage,
  type ZuluInstallOutcome,
} from './zulu';
export {
  assembleLaunchConfig,
  filterAgentMounts,
  APPLET_LAUNCHER_CLASS,
  APPLET_CLASS_BY_METHOD,
  type LaunchContext,
  type AssembleOptions,
} from './launch';
export { classifyCrash, GameProcessManager, type GameProcessEvents } from './process';
export { canonicalLaunchMethod, detectLaunchMethod, probeIndevEntry, probePreclassicEntry } from './wrapperDetector';
export { extractZipTo, listZipEntryNames, readZipEntries, writeZipEntries, type ZipEntry } from './zip';
export {
  applyLegacyfixDeawtPatch,
  patchDeawtClassBytes,
  reportLegacyfixDeawtPatch,
  type LfPatchOutcome,
} from './legacyfixPatch';
export {
  resolveAssetIndexId,
  resolveLaunchAssetIndexId,
  AUTHORITATIVE_ASSET_INDEXES,
  planAssetObjects,
  ASSET_INDEXES,
  type AssetIndexEntry,
  type AssetObjectPlan,
} from './legacyAssets';
export { AtticRuntime, type AtticRuntimeOptions } from './runtime';

// 契约面透传：壳层只 import 本包即可拿到全部通道常量与类型。
export {
  IPC_CHANNELS,
  IPC_EVENTS,
  NOT_IMPLEMENTED,
  type IpcResult,
  type RendererBridge,
} from '@attic/core-spec';
