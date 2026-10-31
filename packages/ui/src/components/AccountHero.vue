<script setup lang="ts">
/**
 * 账户英雄区 —— 主区左上（非侧栏）：minotar 皮肤头 + 用户名（未选中=「未选择账户」）+ 欢迎行（截图2）。
 * 整块可点，跳账户视图。
 */
import { useI18n } from '../i18n';
import { useAccounts } from '../composables/useAccounts';
import SkinAvatar from './SkinAvatar.vue';

const emit = defineEmits<{ (e: 'open-accounts'): void }>();
const { t } = useI18n();
const { current } = useAccounts();
</script>

<template>
  <button class="hero" type="button" :title="t('account.title')" @click="emit('open-accounts')">
    <SkinAvatar class="face" :username="current?.name ?? 'Steve'" :uuid="current?.id" :size="56" rounded="var(--radius-md)" />
    <span class="text">
      <span class="name">{{ current ? current.name : t('account.none') }}</span>
      <span class="welcome">{{ t('account.welcome') }}</span>
    </span>
  </button>
</template>

<style scoped>
.hero {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: transparent;
  border: none;
  border-radius: var(--radius-lg);
  cursor: pointer;
  text-align: left;
  transition: background-color var(--dur-fast) var(--ease-out);
}
.hero:hover {
  background: var(--surface-2);
}
/* 背景图启用态（html[data-bg-image]，App.vue 同源条件）：暗上下文下 hover 底不能用
   surface-2（浅主题=羊皮纸，亮字压浅底反而糊），用半透暗 chip 与舞台同调 */
html[data-bg-image] .hero:hover {
  background: rgba(22, 24, 28, 0.45);
}
.face {
  border: 1px solid var(--card-border);
}
.text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.name {
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--text-primary);
}
.welcome {
  font-size: var(--fs-sm);
  color: var(--text-secondary);
}
</style>
