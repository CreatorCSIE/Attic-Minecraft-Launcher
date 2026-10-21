/**
 * useSelection —— 跨组件共享的"当前选中版本"（启动视图用）。
 * 实例联动：实例档案记录上次启动版本（宿主 persistInstanceVersion 回写），
 * 启动后清单加载 / 切换激活实例 → 版本选择跟随档案版本，启动页版本列表随之定位；
 * 用户手动选版本不被覆盖（只在激活实例变化时跟随）。
 */

import { ref, computed, watch, type Ref, type ComputedRef } from 'vue';
import type { VersionRef } from '@attic/core-spec';
import { useVersions } from './useVersions';
import { useInstances } from './useInstances';

const selectedId: Ref<string | null> = ref(null);

const { versions } = useVersions();
const { active } = useInstances();

const selected: ComputedRef<VersionRef | null> = computed(
  () => versions.value.find((v) => v.id === selectedId.value) ?? null,
);

function select(id: string | null): void {
  selectedId.value = id;
}

// 激活实例 → 版本联动（immediate 覆盖"激活名已从 localStorage 恢复"的同步场景）。
// 只在"切换激活实例"或"档案版本变化"（启动回写/改名）时跟随；
// 保存实例（如「≡」菜单勾 addons）产生的同 (name, version) 新对象不得拽回用户手选版本。
let lastFollowed: string | null = null;
watch(
  active,
  (inst) => {
    if (!inst) return;
    const tag = `${inst.name}\u0000${inst.version}`;
    if (tag === lastFollowed) return;
    lastFollowed = tag;
    if (inst.version !== selectedId.value) selectedId.value = inst.version;
  },
  { immediate: true },
);

export function useSelection() {
  return { selectedId, selected, select };
}
