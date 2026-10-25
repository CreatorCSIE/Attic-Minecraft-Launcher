/**
 * useUpdateCheck —— 检查更新共享状态（UPDATE_CHECK 通道唯一消费点，模块级单例）。
 * 启动一次性静默检查 + 24h 周期轮询（App.vue onMounted 挂载，控制台窗不挂）；
 * 自动结果不打扰用户——有新版只点亮关于页按钮红点徽标，弹窗由手动检查驱动。
 * 桥面 err（无桥/壳未接线）也归一化为 error 分支：弹窗可见呈现，不静默。
 */

import { computed, ref } from 'vue';
import type { UpdateCheckResult } from '@attic/core-spec';
import { useBridge } from './useBridge';

const { bridge } = useBridge();

/** 周期轮询间隔（24h，plan 拍板；跨日在线即再查一次，无需精确调度）。 */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 最近一次检查结果（null = 尚未出结果）；启动静默检查与手动检查共用同一份。 */
const result = ref<UpdateCheckResult | null>(null);
/** 检查在途（手动按钮禁用 + 文案切「检查中」）。 */
const busy = ref(false);
let started = false;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * 执行一次检查（静默轮询与手动点击共用一条路径，弹窗决策在调用方 = 关于页）；
 * 返回值供手动路径弹窗展示（busy 重入时返回 null = 调用方不弹窗）。
 */
async function check(): Promise<UpdateCheckResult | null> {
  if (busy.value) return null;
  busy.value = true;
  try {
    const res = await bridge.checkUpdate();
    // 桥面异常封装（如 no-bridge）也归一化为 error 分支——弹窗可见呈现纪律。
    result.value = res.ok ? res.value : { status: 'error', message: res.error };
    return result.value;
  } finally {
    busy.value = false;
  }
}

/** 有新版 = 红点徽标数据源（error/unconfigured 不打红点——误报比漏报烦人）。 */
const hasUpdate = computed(() => result.value?.status === 'update');

/** 启动后台检查链（幂等）：立即静默查一次 + 24h 周期；App.vue 主页挂载。 */
function start(): void {
  if (started) return;
  started = true;
  void check();
  timer = setInterval(() => void check(), CHECK_INTERVAL_MS);
}

export function useUpdateCheck() {
  return { result, busy, hasUpdate, check, start };
}
