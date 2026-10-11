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

  for (const key of ENDPOINT_KEYS) {
    put(`${ENDPOINT_PREFIX}${key}`, settings.endpoints?.[key]);
  }
  return next;
}

/** 实例薄档案 ↔ v1 InstanceConfig 字段（gameDir 由调用方按 v1 惯例派生，不进视图）。 */
export function instanceViewFromConfig(config: {
  name: string;
  version: string;
  javaPath?: string;
}): InstanceView {
  const view: InstanceView = { name: config.name, version: config.version };
  if (config.javaPath) view.javaPath = config.javaPath;
  return view;
}
