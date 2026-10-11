/**
 * useSelection —— 跨组件共享的"当前选中版本"（启动视图用）。
 */

import { ref, computed, type Ref, type ComputedRef } from 'vue';
import type { VersionRef } from '@attic/core-spec';
import { useVersions } from './useVersions';

const selectedId: Ref<string | null> = ref(null);

const { versions } = useVersions();

const selected: ComputedRef<VersionRef | null> = computed(
  () => versions.value.find((v) => v.id === selectedId.value) ?? null,
);

function select(id: string | null): void {
  selectedId.value = id;
}

export function useSelection() {
  return { selectedId, selected, select };
}
