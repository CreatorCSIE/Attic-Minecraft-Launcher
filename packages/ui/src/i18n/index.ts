/**
 * i18n —— 手写深合并（零依赖）。
 * 策略：en 为 base/fallback，zh-CN 覆盖同名键；默认 locale = zh-CN，持久化到 localStorage。
 * t(key) 走点路径；缺键回落 en，仍缺则原样返回路径。
 */

import { ref, computed, type Ref } from 'vue';
import { en } from './locales/en';
import { zhCN } from './locales/zh-CN';

export type Locale = 'en' | 'zh-CN';

const LOCALE_KEY = 'attic.locale';

type Dict = Record<string, unknown>;

/** 深合并：override 的同名叶子覆盖 base，对象递归合并。 */
function deepMerge(base: Dict, override: Dict): Dict {
  const out: Dict = { ...base };
  for (const key of Object.keys(override)) {
    const b = out[key];
    const o = override[key];
    if (isDict(b) && isDict(o)) {
      out[key] = deepMerge(b, o);
    } else {
      out[key] = o;
    }
  }
  return out;
}

function isDict(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const dicts: Record<Locale, Dict> = {
  en,
  'zh-CN': deepMerge(en, zhCN),
};

function readStoredLocale(): Locale {
  try {
    const v = localStorage.getItem(LOCALE_KEY);
    if (v === 'en' || v === 'zh-CN') return v;
  } catch {
    /* 浏览器隐私模式可能禁 storage，回落默认 */
  }
  return 'zh-CN';
}

const locale: Ref<Locale> = ref(readStoredLocale());

const activeDict = computed<Dict>(() => dicts[locale.value]);

/** 点路径取值。 */
function lookup(dict: Dict, path: string): string | undefined {
  let cur: unknown = dict;
  for (const seg of path.split('.')) {
    if (isDict(cur) && seg in cur) {
      cur = cur[seg];
    } else {
      return undefined;
    }
  }
  return typeof cur === 'string' ? cur : undefined;
}

/** 翻译：当前 locale → 回落 en → 原样路径；支持 {name} 插值。 */
export function t(key: string, params?: Record<string, string | number>): string {
  let s = lookup(activeDict.value, key) ?? lookup(en, key) ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

export function setLocale(next: Locale): void {
  locale.value = next;
  try {
    localStorage.setItem(LOCALE_KEY, next);
  } catch {
    /* 忽略持久化失败 */
  }
}

/** 组合式入口。 */
export function useI18n() {
  return { t, locale, setLocale };
}
