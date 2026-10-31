<script setup lang="ts">
/**
 * 顶栏 —— 拖拽区（-webkit-app-region: drag）+ 右侧窗控制三键（no-drag）。
 * 窗控制走契约通道 WINDOW_CONTROL（attic:window:control），浏览器直开无桥时隐藏。
 * B 期③：portable 只读回落 = 头区常驻徽标「数据未随盘」（tooltip = 生效根）——
 * 一次性告知会被第二台只读机静默复用，必须常驻。
 */
import { computed } from 'vue';
import { useI18n } from '../i18n';
import { useBridge } from '../composables/useBridge';
import { useSysInfo } from '../composables/useSysInfo';

const { t } = useI18n();
const { bridge, hasBridge } = useBridge();
const { info } = useSysInfo();
const portableFallback = computed(() => info.value?.portable?.fallback === true);
</script>

<template>
  <!-- data-tauri-drag-region = Tauri 壳拖拽通道（-webkit-app-region 仅 Electron 认，双壳并用无副作用） -->
  <header class="titlebar" data-tauri-drag-region>
    <div class="brand">
      <span class="name">{{ t('app.title') }}</span>
    </div>
    <span
      v-if="portableFallback"
      class="portable-badge"
      :title="t('portable.fallbackTooltip', { path: info?.dataRoot ?? '' })"
    >{{ t('portable.fallbackBadge') }}</span>
    <div class="right">
      <div v-if="hasBridge" class="wctls">
        <button
          class="wctl"
          type="button"
          :aria-label="t('window.minimize')"
          :title="t('window.minimize')"
          @click="bridge.windowControl('minimize')"
        >
          <!-- lucide: minus -->
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M5 12h14" />
          </svg>
        </button>
        <button
          class="wctl"
          type="button"
          :aria-label="t('window.maximize')"
          :title="t('window.maximize')"
          @click="bridge.windowControl('toggle-maximize')"
        >
          <!-- lucide: square -->
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
            <rect x="4" y="4" width="16" height="16" rx="2" />
          </svg>
        </button>
        <button
          class="wctl wctl--close"
          type="button"
          :aria-label="t('window.close')"
          :title="t('window.close')"
          @click="bridge.windowControl('close')"
        >
          <!-- lucide: x -->
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  height: 36px;
  flex: 0 0 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-4);
  background: var(--raised);
  border-bottom: 1px solid var(--border);
  -webkit-app-region: drag;
  user-select: none;
}
.brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.name {
  font-size: var(--fs-sm);
  font-weight: 600;
  letter-spacing: var(--tracking-label);
  color: var(--text-secondary);
}
/* —— 只读回落徽标：警示色描边胶囊，纯展示不参与拖拽判定 —— */
.portable-badge {
  padding: 2px var(--space-2);
  border: 1px solid var(--warn);
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
  color: var(--warn);
  white-space: nowrap;
}
.right {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
/* —— 窗控制三键：no-drag，否则点击被拖拽区吞掉 —— */
.wctls {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  -webkit-app-region: no-drag;
}
.wctl {
  width: var(--space-6);
  height: var(--space-6);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}
.wctl:hover {
  background: var(--surface-3);
  color: var(--text-primary);
}
.wctl:active {
  background: var(--surface-4);
}
.wctl--close:hover {
  background: var(--danger-soft);
  color: var(--danger);
}
</style>
