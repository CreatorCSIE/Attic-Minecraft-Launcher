/**
 * useExternalLink —— 外链出门共享状态（模块级单例，全局一枚错误弹窗）。
 * 修「找不到默认浏览器静默失败」（用户报障）：宿主 shell.openExternal 在无
 * http/https 关联时 reject → IpcResult{ok:false}，旧调用面 `void` 丢弃结果 =
 * 点了没反应也没提示。本通道把失败落进 error，由 ExternalLinkErrorDialog 呈现。
 */
import { ref } from "vue";
import { useBridge } from "./useBridge";

const { bridge } = useBridge();

/** 最近一次外链打开失败的原因（null = 无弹窗）。 */
const error = ref<string | null>(null);

function openExternal(url: string): void {
  void (async () => {
    const res = await bridge.openExternalUrl(url);
    if (!res.ok) error.value = res.error;
  })();
}

function dismiss(): void {
  error.value = null;
}

export function useExternalLink() {
  return { error, openExternal, dismiss };
}
