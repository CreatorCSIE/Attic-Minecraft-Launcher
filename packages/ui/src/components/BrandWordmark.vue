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
    <span class="menu-text" :title="t('app.title')">{{ t('nav.menu') }}</span>
  </div>
</template>

<style scoped>
.wordmark {
  display: flex;
  align-items: center;
  padding: var(--space-2) var(--space-3);
  color: var(--text-primary);
  user-select: none;
  /* 折叠零离散切换（与 App.vue 侧栏同一配方）：≡ 居中走 padding-inline 连续过渡，
     「菜单」二字收放走 max-width/opacity/margin 过渡 */
  transition: padding-inline var(--dur-base) var(--ease-out);
}
/* 折叠态 ≡（28px）居中：内容列宽 = rail - 2*space-2 = 44 → padding = (44-28)/2 */
.wordmark--collapsed {
  padding-inline: calc((var(--rail-width) - 2 * var(--space-2) - 28px) / 2);
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
  margin-left: var(--space-3);
  max-width: 96px;
  opacity: 1;
  transition:
    max-width var(--dur-base) var(--ease-out),
    margin-left var(--dur-base) var(--ease-out),
    opacity var(--dur-fast) var(--ease-out);
}
.wordmark--collapsed .menu-text {
  margin-left: 0;
  max-width: 0;
  opacity: 0;
}
</style>
