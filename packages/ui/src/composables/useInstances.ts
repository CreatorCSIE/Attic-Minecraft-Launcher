/**
 * useInstances —— 实例薄档案共享状态（list/save/激活实例）。
 * 实例数据驱动：name/version/javaPath 全走契约，UI 不派生 gameDir（属宿主）。
 * 激活实例（activeName）本期为 UI 层共享态：localStorage 持久化 + 清单加载后兜底，
 * AppSettings 契约不动（实例页改版时再议是否升为设置项）。
 */

import { computed, ref, watch } from 'vue';
import type { InstanceView } from '@attic/core-spec';
import { useBridge } from './useBridge';

const instances = ref<InstanceView[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
let started = false;

const { bridge } = useBridge();

// —— 激活实例：localStorage 持久化（键名纪律：attic:<域>:v1） ——
const ACTIVE_KEY = 'attic:active-instance:v1';
const activeName = ref<string>('');
try {
  activeName.value = localStorage.getItem(ACTIVE_KEY) ?? '';
} catch {
  /* 隐私模式：空激活名 = 宿主按契约缺省回落 default instance */
}

const active = computed(() => instances.value.find((i) => i.name === activeName.value) ?? null);

function setActive(name: string): void {
  activeName.value = name;
  try {
    localStorage.setItem(ACTIVE_KEY, name);
  } catch {
    /* 隐私模式：仅内存态 */
  }
}

// 兜底：激活名未初始化/已失效 → 契约文档缺省 `default instance`（LaunchRequest.instanceId
// 注释所载宿主缺省，非 UI 自造规则）→ 回落首个实例。清单为空则不动。
watch(instances, (list) => {
  if (list.length === 0 || active.value) return;
  const fallback = list.find((i) => i.name === 'default instance') ?? list[0];
  if (fallback) setActive(fallback.name);
});

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  const res = await bridge.listInstances();
  if (res.ok) instances.value = res.value;
  else error.value = res.error;
  loading.value = false;
}

/** 保存（新建/覆盖），成功后就地 upsert。 */
async function save(inst: InstanceView): Promise<boolean> {
  const res = await bridge.saveInstance(inst);
  if (res.ok) {
    const saved = res.value;
    const idx = instances.value.findIndex((i) => i.name === saved.name);
    if (idx >= 0) instances.value[idx] = saved;
    else instances.value.push(saved);
  }
  return res.ok;
}

function ensureLoaded(): void {
  if (started) return;
  started = true;
  void load();
}

export function useInstances() {
  ensureLoaded();
  return { instances, loading, error, load, save, activeName, active, setActive };
}
