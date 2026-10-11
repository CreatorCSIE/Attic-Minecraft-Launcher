<script setup lang="ts">
/**
 * 实例列表 —— 左栏薄档案 + 新建实例选版本。
 * 仅 name/version/javaPath 进契约；gameDir/内存属宿主，UI 不派生（戒律 #1）。
 */
import { computed, ref } from 'vue';
import { useI18n } from '../i18n';
import { useInstances } from '../composables/useInstances';
import { useVersions } from '../composables/useVersions';
import { useBridge } from '../composables/useBridge';

const { t } = useI18n();
const { instances, loading, error, save } = useInstances();
const { versions } = useVersions();
const { hasBridge } = useBridge();

const name = ref('');
const version = ref('');
const created = ref(false);
const saving = ref(false);

/** 已安装优先，其次按 id 升序，供版本下拉。 */
const options = computed(() =>
  [...versions.value].sort((a, b) => {
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    return a.id.localeCompare(b.id);
  }),
);

const canCreate = computed(
  () => hasBridge.value && !saving.value && name.value.trim() !== '' && version.value !== '',
);

async function onCreate(): Promise<void> {
  if (!canCreate.value) return;
  saving.value = true;
  created.value = false;
  const ok = await save({ name: name.value.trim(), version: version.value });
  if (ok) {
    name.value = '';
    version.value = '';
    created.value = true;
  }
  saving.value = false;
}
</script>

<template>
  <section class="instances">
    <div class="head">
      <span class="label">{{ t('nav.instances') }}</span>
      <span class="count tabular">{{ instances.length }}</span>
    </div>

    <form class="create" @submit.prevent="onCreate">
      <div class="field">
        <label class="label" for="inst-name">{{ t('instance.name') }}</label>
        <input
          id="inst-name"
          v-model="name"
          class="input"
          type="text"
          :placeholder="t('instance.namePlaceholder')"
        />
      </div>
      <div class="field">
        <label class="label" for="inst-ver">{{ t('instance.version') }}</label>
        <select id="inst-ver" v-model="version" class="input">
          <option value="" disabled>{{ t('instance.selectVersion') }}</option>
          <option v-for="o in options" :key="o.id" :value="o.id">
            {{ o.id }}{{ o.installed ? ' · ✓' : '' }}
          </option>
        </select>
      </div>
      <button class="primary" type="submit" :disabled="!canCreate">{{ t('instance.create') }}</button>
      <p v-if="created" class="saved">{{ t('instance.created') }}</p>
    </form>

    <div v-if="loading" class="state">{{ t('common.loading') }}</div>
    <div v-else-if="error" class="state state--err">{{ t('common.error') }}：{{ error }}</div>
    <div v-else-if="instances.length === 0" class="state empty">
      <p class="state-msg">{{ t('instance.empty') }}</p>
      <p class="state-hint">{{ t('instance.emptyHint') }}</p>
    </div>

    <ul v-else class="list">
      <li v-for="inst in instances" :key="inst.name" class="card">
        <span class="card-name">{{ inst.name }}</span>
        <span class="card-ver mono">{{ inst.version }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.instances {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-4);
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.count {
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
.create {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--card-highlight);
}
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 180px;
}
.input {
  padding: var(--space-2) var(--space-3);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  transition: border-color var(--dur-fast) var(--ease-out);
}
.input:hover {
  border-color: var(--border-strong);
}
select.input {
  cursor: pointer;
}
.primary {
  padding: var(--space-2) var(--space-5);
  background: var(--accent);
  color: var(--accent-ink);
  border: none;
  border-radius: var(--radius-md);
  font-weight: 600;
  transition: background var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
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
.saved {
  font-size: var(--fs-xs);
  color: var(--ok);
  align-self: center;
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
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  background: var(--raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.card-name {
  color: var(--text-primary);
}
.card-ver {
  font-size: var(--fs-sm);
  color: var(--text-secondary);
}
.state {
  padding: var(--space-6);
  text-align: center;
  color: var(--text-secondary);
}
.state--err {
  color: var(--danger);
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
