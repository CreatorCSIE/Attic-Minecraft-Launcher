<script setup lang="ts">
/**
 * 顶栏 —— 拖拽区（-webkit-app-region: drag）+ 右侧窗控制三键（no-drag）。
 * 窗控制走契约通道 WINDOW_CONTROL（attic:window:control），浏览器直开无桥时隐藏。
 */
import { useI18n } from '../i18n';
import { useBridge } from '../composables/useBridge';

const { t } = useI18n();
const { bridge, hasBridge } = useBridge();
</script>

<template>
  <header class="titlebar">
    <div class="brand">
      <span class="mark" aria-hidden="true"></span>
      <span class="name">{{ t('app.title') }}</span>
    </div>
    <div class="right">
      <span class="dot" :class="hasBridge ? 'dot--ok' : 'dot--muted'" :title="hasBridge ? 'bridge' : 'no-bridge'"></span>
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
.mark {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent-soft);
}
.name {
  font-size: var(--fs-sm);
  font-weight: 600;
  letter-spacing: var(--tracking-label);
  color: var(--text-secondary);
}
.right {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.dot--ok {
  background: var(--ok);
}
.dot--muted {
  background: var(--text-muted);
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
