/**
 * useInstances —— 实例薄档案共享状态（list/save）。
 * 实例数据驱动：name/version/javaPath 全走契约，UI 不派生 gameDir（属宿主）。
 */

import { ref } from 'vue';
import type { InstanceView } from '@attic/core-spec';
import { useBridge } from './useBridge';

const instances = ref<InstanceView[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
let started = false;

const { bridge } = useBridge();

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
  return { instances, loading, error, load, save };
}
