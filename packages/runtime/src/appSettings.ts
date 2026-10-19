/**
 * 渲染侧 AppSettings / InstanceView ↔ 宿主 properties 文件的映射（Phase 3）。
 * 戒律 #1：设置是数据，落 `launcher.settings`（v1 格式）；本模块只做形状转换，不碰文件。
 * 未知键一律保留——launcher.settings 可能含 v1 遗留键，写回时不得丢失。
 */

import type { AppSettings, EndpointOverrides, InstanceView, ThemeMode } from '@attic/core-spec';

const ENDPOINT_PREFIX = 'endpoint.';
const ENDPOINT_KEYS: (keyof EndpointOverrides)[] = [
  'versionList',
  'filesBase',
  'legacyfixRelease',
  'zuluMetadata',
  'mojangManifest',
];
const THEMES: ThemeMode[] = ['dark', 'light', 'system'];

/** 从 launcher.settings 的扁平属性读出渲染侧设置视图（缺省字段省略）。 */
export function settingsFromProps(props: Record<string, string>): AppSettings {
  const out: AppSettings = {};
  if (props['javaPath']) out.javaPath = props['javaPath'];
  const mem = Number(props['maxMemoryMb']);
  if (Number.isFinite(mem) && mem > 0) out.maxMemoryMb = mem;
  if (props['username']) out.username = props['username'];
  if (THEMES.includes(props['theme'] as ThemeMode)) out.theme = props['theme'] as ThemeMode;
  if (props['levelServer']) out.levelServer = props['levelServer'];

  const endpoints: EndpointOverrides = {};
  let hasEndpoint = false;
  for (const key of ENDPOINT_KEYS) {
    const v = props[`${ENDPOINT_PREFIX}${key}`];
    if (v) {
      endpoints[key] = v;
      hasEndpoint = true;
    }
  }
  if (hasEndpoint) out.endpoints = endpoints;
  return out;
}

/**
 * 把 AppSettings 合并进既有属性（managed 键有值则写、无值则删；未知键原样保留）。
 * 返回新对象，不改入参。
 */
export function applySettingsToProps(
  existing: Record<string, string>,
  settings: AppSettings,
): Record<string, string> {
  const next: Record<string, string> = { ...existing };

  const put = (key: string, value: string | undefined): void => {
    if (value === undefined || value === '') delete next[key];
    else next[key] = value;
  };

  put('javaPath', settings.javaPath);
  put('maxMemoryMb', settings.maxMemoryMb === undefined ? undefined : String(settings.maxMemoryMb));
  put('username', settings.username);
  put('theme', settings.theme);
  put('levelServer', settings.levelServer);

  for (const key of ENDPOINT_KEYS) {
    put(`${ENDPOINT_PREFIX}${key}`, settings.endpoints?.[key]);
  }
  return next;
}

/** 实例视图 ↔ v1 InstanceConfig（对齐 v1 Instance Settings 可编辑集，全字段往返）。 */
export function instanceViewFromConfig(config: {
  name: string;
  version: string;
  gameDir?: string;
  launchArgs?: string;
  width?: number;
  height?: number;
  javaPath?: string;
  addons?: string;
}): InstanceView {
  const view: InstanceView = { name: config.name, version: config.version };
  if (config.gameDir) view.gameDir = config.gameDir;
  if (config.launchArgs) view.launchArgs = config.launchArgs;
  if (config.width !== undefined) view.width = config.width;
  if (config.height !== undefined) view.height = config.height;
  if (config.javaPath) view.javaPath = config.javaPath;
  // v1 `addons` 档案键 = 逗号分隔；空串 = 显式全关（与"无键 = legacyfix 缺省"区分，不可丢弃）
  if (config.addons !== undefined) {
    view.addons = config.addons.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return view;
}
