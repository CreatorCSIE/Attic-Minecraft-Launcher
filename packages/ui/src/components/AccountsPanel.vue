<script setup lang="ts">
/**
 * 账户面板 —— 离线账户完整落实（添加/移除/设为当前，校验与落盘归 runtime）；
 * 微软账户为占位（登录流程未实现，按钮禁用 + 即将推出标注）。
 * 头像走 minotar 皮肤脸（SkinAvatar），对齐 BlockHelm 账户展示。
 */
import { computed, ref } from 'vue';
import { useI18n } from '../i18n';
import { useAccounts } from '../composables/useAccounts';
import { useBridge } from '../composables/useBridge';
import SkinAvatar from './SkinAvatar.vue';

const { t } = useI18n();
const { accounts, current, loading, error, add, remove, select } = useAccounts();
const { hasBridge } = useBridge();

const name = ref('');
const adding = ref(false);
const formError = ref<string | null>(null);

const canAdd = computed(() => hasBridge.value && !adding.value && name.value.trim() !== '');

async function onAdd(): Promise<void> {
  if (!canAdd.value) return;
  adding.value = true;
  formError.value = null;
  const ok = await add(name.value);
  if (ok) name.value = '';
  else formError.value = error.value;
  adding.value = false;
}
</script>

<template>
  <section class="accounts">
    <div class="head">
      <span class="label">{{ t('account.title') }}</span>
      <span class="count tabular">{{ accounts.length }}</span>
    </div>

    <form class="create" @submit.prevent="onAdd">
      <div class="field">
        <label class="label" for="acct-name">{{ t('account.add') }}</label>
        <input
          id="acct-name"
          v-model="name"
          class="input"
          type="text"
          maxlength="16"
          autocomplete="off"
          :placeholder="t('account.namePlaceholder')"
        />
      </div>
      <button class="primary" type="submit" :disabled="!canAdd">{{ t('account.create') }}</button>
      <p v-if="formError" class="form-err">{{ formError }}</p>
    </form>

    <div class="ms-card">
      <span class="ms-text">
        <span class="ms-title">{{ t('account.microsoft') }}</span>
        <span class="ms-note">{{ t('account.microsoftSoon') }}</span>
      </span>
      <button class="primary" type="button" disabled>{{ t('account.microsoft') }}</button>
    </div>

    <div v-if="loading" class="state">{{ t('common.loading') }}</div>
    <div v-else-if="accounts.length === 0" class="state empty">
      <p class="state-msg">{{ t('account.none') }}</p>
      <p class="state-hint">{{ t('account.hint') }}</p>
    </div>

    <ul v-else class="list">
      <li
        v-for="a in accounts"
        :key="a.id"
        class="card"
        :class="{ 'card--current': current?.id === a.id }"
      >
        <SkinAvatar :username="a.name" :size="40" />
        <span class="card-main">
          <span class="card-name">{{ a.name }}</span>
          <span class="card-meta">
            <span class="chip" :data-type="a.type">
              {{ a.type === 'microsoft' ? 'Microsoft' : t('account.offline') }}
            </span>
            <span v-if="current?.id === a.id" class="chip chip--current">{{ t('account.current') }}</span>
          </span>
        </span>
        <span class="card-actions">
          <button
            v-if="current?.id !== a.id"
            class="ghost"
            type="button"
            @click="select(a.id)"
          >
            {{ t('account.use') }}
          </button>
          <button class="ghost ghost--danger" type="button" :disabled="!hasBridge" @click="remove(a.id)">
            {{ t('account.remove') }}
          </button>
        </span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.accounts {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-5);
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.head .label {
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--text-primary);
}
.count {
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
/* base-card 配方：添加离线账户表单 */
.create {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-4);
  padding: var(--space-5);
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  flex: 1 1 240px;
}
.label {
  font-size: var(--fs-xs);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--text-muted);
}
.input {
  padding: var(--space-3) var(--space-4);
  background: var(--surface-3);
  border: none;
  border-radius: var(--radius-md);
  color: var(--text-primary);
  box-shadow: var(--input-inset);
  transition:
    background-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}
.input:hover {
  background: var(--surface-4);
}
.input:focus-visible {
  outline: none;
  box-shadow: var(--input-focus-shadow);
}
.primary {
  padding: var(--space-2) var(--space-5);
  background: var(--accent);
  color: var(--accent-ink);
  border: none;
  border-radius: var(--radius-md);
  font-weight: 600;
  transition:
    background var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}
.primary:hover:not(:disabled) {
  background: var(--accent-hover);
}
.primary:active:not(:disabled) {
  transform: scale(0.97);
}
.primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.form-err {
  flex: 1 1 100%;
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--danger);
}
/* 微软账户占位卡 */
.ms-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  background: var(--card-bg);
  border: 1px dashed var(--card-border);
  border-radius: var(--radius-lg);
}
.ms-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ms-title {
  font-weight: 600;
  color: var(--text-primary);
}
.ms-note {
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.card {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
  transition: border-color var(--dur-fast) var(--ease-out);
}
.card--current {
  border-color: var(--accent);
}
.card-main {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
  flex: 1;
}
.card-name {
  color: var(--text-primary);
  font-weight: 600;
}
.card-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.chip {
  font-size: var(--fs-xs);
  letter-spacing: var(--tracking-label);
  padding: 1px var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  background: var(--surface-1);
}
.chip--current {
  color: var(--accent);
  background: var(--accent-soft);
}
.card-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.ghost {
  padding: var(--space-1) var(--space-3);
  background: transparent;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: var(--fs-sm);
  box-shadow: var(--inset-bottom);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}
.ghost:hover:not(:disabled) {
  background: var(--surface-4);
}
.ghost:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ghost--danger:hover:not(:disabled) {
  background: var(--danger-soft);
  color: var(--danger);
}
.state {
  padding: var(--space-6) var(--space-5);
  text-align: center;
  color: var(--text-secondary);
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}
.empty {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.state-hint {
  font-size: var(--fs-sm);
  color: var(--text-muted);
}
</style>
