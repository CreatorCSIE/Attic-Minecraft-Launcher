/**
 * useSysInfo —— 宿主环境快照共享状态（SYS_INFO 通道唯一消费点）。
 * 模块级单例：通用栏（数据根/日志）、内存滑杆上限、关于页版本号三处共用一份数据；
 * 取不到（mock 无桥）= null，各栏自行降级展示（滑杆用保守上限、版本行隐藏）。
 */

import { onMounted, ref } from 'vue';
import type { SystemInfo } from '@attic/core-spec';
import { useBridge } from './useBridge';

const info = ref<SystemInfo | null>(null);
const error = ref<string | null>(null);
let started = false;

const { bridge } = useBridge();

async function refresh(): Promise<void> {
  const res = await bridge.getSystemInfo();
  if (res.ok) {
    info.value = res.value;
    error.value = null;
  } else {
    error.value = res.error;
  }
}

function ensureLoaded(): void {
  if (started) return;
  started = true;
  void refresh();
}

export function useSysInfo() {
  ensureLoaded();
  return { info, error, refresh };
}
