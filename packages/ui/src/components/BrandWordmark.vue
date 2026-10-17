<script setup lang="ts">
/**
 * 侧栏顶部菜单钮（截图3形态：≡ + 「菜单」二字）—— 完整名称双行过长，用户指定改为「菜单」。
 * ≡ 为侧栏折叠开关：点击在 图标+文字侧栏 ↔ 窄图标 rail 间切换。
 */
import { useI18n } from '../i18n';

defineProps<{ collapsed?: boolean }>();
const emit = defineEmits<{ (e: 'toggle'): void }>();
const { t } = useI18n();
</script>

<template>
  <div class="wordmark" :class="{ 'wordmark--collapsed': collapsed }">
    <button
      class="bars-btn"
      type="button"
      :title="collapsed ? t('nav.expand') : t('nav.collapse')"
      :aria-label="collapsed ? t('nav.expand') : t('nav.collapse')"
      :aria-expanded="!collapsed"
      @click="emit('toggle')"
    >
      <!-- lucide: align-left（≡） -->
      <svg
        class="bars"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <path d="M15 12H3" />
        <path d="M17 6H3" />
        <path d="M21 18H3" />
      </svg>
    </button>
    <span v-if="!collapsed" class="menu-text" :title="t('app.title')">{{ t('nav.menu') }}</span>
  </div>
</template>

<style scoped>
.wordmark {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  color: var(--text-primary);
  user-select: none;
}
.wordmark--collapsed {
  justify-content: center;
  padding-inline: 0;
}
.bars-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--accent);
  cursor: pointer;
  flex: 0 0 auto;
  transition: background var(--dur-fast) var(--ease-out);
}
.bars-btn:hover {
  background: var(--surface-4);
}
.bars {
  color: currentColor;
}
.menu-text {
  font-size: var(--fs-md);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
