/**
 * useDebouncedField —— 即改即存页的文本/滑杆防抖写入（BlockHelm 350ms 防抖的 Attic 简版）。
 * 本地态即改即显，落盘延后 400ms；settings 外部变化（保存回执/demo 复位）回同步本地，
 * 但防抖窗口内不打断用户输入。
 */

import { ref, watch, type Ref } from 'vue';

export function useDebouncedField<T>(
  get: () => T,
  commit: (value: T) => void,
  delayMs = 400,
): { local: Ref<T> } {
  const local = ref(get()) as Ref<T>;
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(local, (v) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => commit(v), delayMs);
  });
  watch(get, (v) => {
    if (v !== local.value) local.value = v;
  });
  return { local };
}
