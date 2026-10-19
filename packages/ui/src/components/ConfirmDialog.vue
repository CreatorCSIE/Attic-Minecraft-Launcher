<script setup lang="ts">
/**
 * 通用危险操作确认弹窗（防误删，用户指定：账户删除与自定义版本删除共用）：
 * AppDialog 壳 + 标题/说明文案/取消·删除两键；删除键 danger 形态。
 * confirm 事件由宿主执行实际删除，busy=true 期间两键禁用（防双击重复触发）。
 */
import { useI18n } from '../i18n';
import AppDialog from './AppDialog.vue';

const props = defineProps<{
  open: boolean;
  title: string;
  message: string;
  busy?: boolean;
}>();
const emit = defineEmits<{ 'update:open': [value: boolean]; confirm: [] }>();

const { t } = useI18n();

function close(): void {
  if (props.busy) return;
  emit('update:open', false);
}
</script>

<template>
  <AppDialog :open="props.open" @close="close">
    <header class="head">
      <h2 class="title">{{ props.title }}</h2>
      <p class="message">{{ props.message }}</p>
      <!-- 可选附加选项（如实例删除的"同时删除目录"复选框），由宿主页面注入 -->
      <slot />
    </header>

    <footer class="foot">
      <span class="foot-spacer"></span>
      <button class="ghost" type="button" :disabled="props.busy" @click="close">
        {{ t('confirmDialog.cancel') }}
      </button>
      <button class="danger" type="button" :disabled="props.busy" @click="emit('confirm')">
        {{ props.busy ? t('confirmDialog.busy') : t('confirmDialog.confirm') }}
      </button>
    </footer>
  </AppDialog>
</template>

<style scoped>
.head {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.title {
  margin: 0;
  font-size: var(--fs-xl);
  font-weight: 700;
  color: var(--text-primary);
}
.message {
  margin: 0;
  font-size: var(--fs-md);
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.foot {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.foot-spacer {
  flex: 1;
}
.ghost {
  padding: var(--space-2) var(--space-5);
  background: var(--surface-3);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-md);
  box-shadow: var(--inset-bottom);
  color: var(--text-primary);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}
.ghost:hover:not(:disabled) {
  background: var(--surface-4);
}
.ghost:disabled {
  opacity: 0.45;
  cursor: default;
}
/* 删除键：danger 底色（BlockHelm 破坏性动作按钮同语义——与主 accent 行动键区分层级） */
.danger {
  padding: var(--space-2) var(--space-5);
  background: var(--danger);
  color: var(--danger-ink);
  border: none;
  border-radius: var(--radius-md);
  font-weight: 600;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}
.danger:hover:not(:disabled) {
  background: var(--danger);
  filter: brightness(1.12);
}
.danger:active:not(:disabled) {
  transform: scale(0.97);
}
.danger:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
