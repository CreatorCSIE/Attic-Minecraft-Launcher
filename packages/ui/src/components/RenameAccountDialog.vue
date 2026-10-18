<script setup lang="ts">
/**
 * 重命名账户弹窗 —— BlockHelm RenameAccountDialogView 同款（标题/副标题/用户名输入/校验文案/取消·确定）。
 * 仅离线账户可用（runtime.renameAccount 同语义）；离线 UUID 随新名重生成。
 */
import { computed, ref, watch } from 'vue';
import type { AccountView } from '@attic/core-spec';
import { useI18n } from '../i18n';
import { useAccounts } from '../composables/useAccounts';
import { useBridge } from '../composables/useBridge';
import AppDialog from './AppDialog.vue';

const props = defineProps<{ open: boolean; account: AccountView | null }>();
const emit = defineEmits<{ 'update:open': [value: boolean] }>();

const { t } = useI18n();
const { rename, error } = useAccounts();
const { hasBridge } = useBridge();

const name = ref('');
const submitting = ref(false);

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const trimmed = computed(() => name.value.trim());
const nameValid = computed(() => NAME_RE.test(trimmed.value));
const canConfirm = computed(
  () =>
    hasBridge.value &&
    !submitting.value &&
    nameValid.value &&
    trimmed.value !== props.account?.name,
);

// 每次打开预填当前名（BlockHelm 同款），并复位上轮错误
watch(
  () => props.open,
  (v) => {
    if (!v) return;
    name.value = props.account?.name ?? '';
    submitting.value = false;
    error.value = null;
  },
);

function close(): void {
  emit('update:open', false);
}

async function onConfirm(): Promise<void> {
  if (!props.account || !canConfirm.value) return;
  error.value = null;
  submitting.value = true;
  const ok = await rename(props.account.id, trimmed.value);
  submitting.value = false;
  if (ok) close();
}
</script>

<template>
  <AppDialog :open="props.open" @close="close">
    <header class="head">
      <h2 class="title">{{ t('account.renameDialog.title') }}</h2>
      <p class="subtitle">{{ t('account.renameDialog.subtitle') }}</p>
    </header>

    <div class="form">
      <label class="field-label" for="rename-acct-name">{{ t('account.renameDialog.newUsernameLabel') }}</label>
      <input
        id="rename-acct-name"
        v-model="name"
        class="input"
        type="text"
        maxlength="16"
        autocomplete="off"
        :placeholder="t('account.namePlaceholder')"
        @keyup.enter="onConfirm"
      />
      <p v-if="name && !nameValid" class="invalid">{{ t('account.dialog.usernameValidation') }}</p>
    </div>

    <p v-if="error" class="err">{{ error }}</p>

    <footer class="foot">
      <span class="foot-spacer"></span>
      <button class="ghost" type="button" @click="close">{{ t('account.dialog.cancel') }}</button>
      <button class="primary" type="button" :disabled="!canConfirm" @click="onConfirm">
        {{ t('account.dialog.confirm') }}
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
.subtitle {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--text-secondary);
}
.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.field-label {
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
.invalid {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--danger);
}
.err {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--danger);
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
.ghost:hover {
  background: var(--surface-4);
}
.primary {
  padding: var(--space-2) var(--space-5);
  background: var(--accent);
  color: var(--accent-ink);
  border: none;
  border-radius: var(--radius-md);
  font-weight: 600;
  cursor: pointer;
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
</style>
