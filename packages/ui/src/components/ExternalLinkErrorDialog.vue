<script setup lang="ts">
/**
 * 外链打开失败弹窗（用户指定）：宿主无默认浏览器 / 浏览器拦截弹窗时显式报错，
 * 不再静默失败。全局单例挂 App.vue，状态源 = useExternalLink（Mods 页与关于页共用）。
 */
import { useI18n } from '../i18n';
import { useExternalLink } from '../composables/useExternalLink';
import AppDialog from './AppDialog.vue';

const { t } = useI18n();
const { error, dismiss } = useExternalLink();
</script>

<template>
  <AppDialog :open="error !== null" :z-index="200" @close="dismiss">
    <h3 class="title">{{ t('external.openError') }}</h3>
    <p class="msg">{{ error }}</p>
    <p class="hint">{{ t('external.openErrorHint') }}</p>
    <footer class="foot">
      <button class="ghost" type="button" @click="dismiss">{{ t('external.close') }}</button>
    </footer>
  </AppDialog>
</template>

<style scoped>
.title {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 700;
  color: var(--text-primary);
}
.msg {
  margin: 0;
  font-size: var(--fs-md);
  color: var(--danger);
  overflow-wrap: anywhere;
}
.hint {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--text-muted);
  line-height: 1.5;
}
.foot {
  display: flex;
  justify-content: flex-end;
}
.ghost {
  padding: var(--space-2) var(--space-5);
  background: transparent;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: var(--fs-md);
  cursor: pointer;
  box-shadow: var(--inset-bottom);
  transition: background var(--dur-fast) var(--ease-out);
}
.ghost:hover {
  background: var(--surface-4);
}
</style>
