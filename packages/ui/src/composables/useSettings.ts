/**
 * useSettings —— 全局设置共享状态 + 主题应用。
 * 主题属渲染侧（契约只持久化 mode）；system 经 matchMedia 解析为 dark/light 落到 data-theme。
 * 写入走桥 setSettings（合并落盘属 runtime 职责）。
 */

import { computed, ref, type ComputedRef } from 'vue';
import type { AppSettings, ThemeMode } from '@attic/core-spec';
import { setLocale } from '../i18n';
import { useBridge } from './useBridge';

const settings = ref<AppSettings>({});
const loaded = ref(false);
const saving = ref(false);
let started = false;

const { bridge } = useBridge();

function prefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

function resolveMode(mode: ThemeMode | undefined): 'dark' | 'light' {
  if (mode === 'dark' || mode === 'light') return mode;
  return prefersDark() ? 'dark' : 'light';
}

function applyTheme(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolveMode(settings.value.theme));
}

if (typeof window !== 'undefined') {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if ((settings.value.theme ?? 'system') === 'system') applyTheme();
  };
  if (typeof media.addEventListener === 'function') media.addEventListener('change', onChange);
  else if (typeof (media as MediaQueryList).addListener === 'function')
    (media as MediaQueryList).addListener(onChange);
}

const themeMode = computed<ThemeMode>(() => settings.value.theme ?? 'system');

async function load(): Promise<void> {
  const res = await bridge.getSettings();
  if (res.ok) settings.value = res.value;
  loaded.value = true;
  applyTheme();
  applyLanguage();
}

/** 语言单一真相 = settings.language（localStorage 仅 bootstrap 缓存）；load 后即时无感应用。 */
function applyLanguage(): void {
  const lang = settings.value.language;
  if (lang === 'en' || lang === 'zh-CN') setLocale(lang);
}

/** 合并补丁并落盘；返回是否成功。 */
async function patch(partial: Partial<AppSettings>): Promise<boolean> {
  saving.value = true;
  const next: AppSettings = { ...settings.value, ...partial };
  const res = await bridge.setSettings(next);
  if (res.ok) settings.value = res.value;
  applyTheme();
  saving.value = false;
  return res.ok;
}

async function setTheme(mode: ThemeMode): Promise<boolean> {
  return patch({ theme: mode });
}

function ensureLoaded(): void {
  if (started) return;
  started = true;
  void load();
}

export interface SettingsStore {
  settings: typeof settings;
  loaded: typeof loaded;
  saving: typeof saving;
  themeMode: ComputedRef<ThemeMode>;
  load: () => Promise<void>;
  patch: (p: Partial<AppSettings>) => Promise<boolean>;
  setTheme: (m: ThemeMode) => Promise<boolean>;
  ensureLoaded: () => void;
}

export function useSettings(): SettingsStore {
  ensureLoaded();
  return { settings, loaded, saving, themeMode, load, patch, setTheme, ensureLoaded };
}
