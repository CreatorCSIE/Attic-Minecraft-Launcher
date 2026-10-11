<script setup lang="ts">
/**
 * 顶栏 —— 拖拽区（-webkit-app-region: drag）。
 * 窗口控制（关闭/最小化）桥面未提供通道，v0 不臆造未接线 IPC（戒律 #2），交由系统/壳处理。
 */
import { useI18n } from '../i18n';
import { useBridge } from '../composables/useBridge';

const { t } = useI18n();
const { hasBridge } = useBridge();
</script>

<template>
  <header class="titlebar">
    <div class="brand">
      <span class="mark" aria-hidden="true"></span>
      <span class="name">{{ t('app.title') }}</span>
    </div>
    <span class="dot" :class="hasBridge ? 'dot--ok' : 'dot--muted'" :title="hasBridge ? 'bridge' : 'no-bridge'"></span>
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
</style>
