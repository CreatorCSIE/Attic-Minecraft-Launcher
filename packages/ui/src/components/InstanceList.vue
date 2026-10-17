<script setup lang="ts">
/**
 * 实例列表 —— 对齐 v1 Instance Settings 可编辑集（名字/版本/目录/JVM 参数/窗口尺寸）。
 * 全字段走契约（InstanceView），UI 不碰文件（戒律 #1）；gameDir 留空 = 宿主派生 root/<实例名>。
 */
import { computed, ref } from 'vue';
import type { InstanceView } from '@attic/core-spec';
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
const gameDir = ref('');
const launchArgs = ref('');
const width = ref<number | ''>(854);
const height = ref<number | ''>(480);
const editingName = ref<string | null>(null);
const created = ref(false);
const saving = ref(false);

/** 已安装优先，其次按 id 升序，供版本下拉。 */
const options = computed(() =>
  [...versions.value].sort((a, b) => {
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    return a.id.localeCompare(b.id);
  }),
);

const canSave = computed(
  () => hasBridge.value && !saving.value && name.value.trim() !== '' && version.value !== '',
);

function resetForm(): void {
  name.value = '';
  version.value = '';
  gameDir.value = '';
  launchArgs.value = '';
  width.value = 854;
  height.value = 480;
  editingName.value = null;
}

/** 卡片点击 → 载入表单编辑（v1 Instance Settings 语义；名字为档案主键，编辑期锁定）。 */
function onEdit(inst: InstanceView): void {
  editingName.value = inst.name;
  name.value = inst.name;
  version.value = inst.version;
  gameDir.value = inst.gameDir ?? '';
  launchArgs.value = inst.launchArgs ?? '';
  width.value = inst.width ?? 854;
  height.value = inst.height ?? 480;
  created.value = false;
}

function onCancelEdit(): void {
  resetForm();
  created.value = false;
}

async function onSave(): Promise<void> {
  if (!canSave.value) return;
  saving.value = true;
  created.value = false;
  const inst: InstanceView = { name: name.value.trim(), version: version.value };
  if (gameDir.value.trim()) inst.gameDir = gameDir.value.trim();
  if (launchArgs.value.trim()) inst.launchArgs = launchArgs.value.trim();
  const w = Number(width.value);
  const h = Number(height.value);
  if (Number.isFinite(w) && w > 0) inst.width = w;
  if (Number.isFinite(h) && h > 0) inst.height = h;
  const ok = await save(inst);
  if (ok) {
    resetForm();
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

    <form class="create" @submit.prevent="onSave">
      <p v-if="editingName" class="editing-hint">
        {{ t('instance.editing', { name: editingName }) }}
        <button class="link" type="button" @click="onCancelEdit">{{ t('instance.cancelEdit') }}</button>
      </p>
      <div class="field">
        <label class="label" for="inst-name">{{ t('instance.name') }}</label>
        <input
          id="inst-name"
          v-model="name"
          class="input"
          type="text"
          :disabled="!!editingName"
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
      <div class="field field--wide">
        <label class="label" for="inst-dir">{{ t('instance.gameDir') }}</label>
        <input id="inst-dir" v-model="gameDir" class="input" type="text" :placeholder="t('instance.gameDirPlaceholder')" />
      </div>
      <div class="field field--wide">
        <label class="label" for="inst-jvm">{{ t('instance.launchArgs') }}</label>
        <input id="inst-jvm" v-model="launchArgs" class="input" type="text" :placeholder="t('instance.launchArgsPlaceholder')" />
      </div>
      <div class="field field--num">
        <label class="label" for="inst-w">{{ t('instance.width') }}</label>
        <input id="inst-w" v-model.number="width" class="input" type="number" min="1" step="1" />
      </div>
      <div class="field field--num">
        <label class="label" for="inst-h">{{ t('instance.height') }}</label>
        <input id="inst-h" v-model.number="height" class="input" type="number" min="1" step="1" />
      </div>
      <button class="primary" type="submit" :disabled="!canSave">
        {{ editingName ? t('instance.saveChanges') : t('instance.create') }}
      </button>
      <p v-if="created" class="saved">{{ t('instance.created') }}</p>
    </form>

    <div v-if="loading" class="state">{{ t('common.loading') }}</div>
    <div v-else-if="error" class="state state--err">{{ t('common.error') }}：{{ error }}</div>
    <div v-else-if="instances.length === 0" class="state empty">
      <p class="state-msg">{{ t('instance.empty') }}</p>
      <p class="state-hint">{{ t('instance.emptyHint') }}</p>
    </div>

    <ul v-else class="list">
      <li
        v-for="inst in instances"
        :key="inst.name"
        class="card"
        role="button"
        tabindex="0"
        @click="onEdit(inst)"
        @keydown.enter="onEdit(inst)"
      >
        <span class="card-main">
          <span class="card-name">{{ inst.name }}</span>
          <span class="card-meta mono">
            {{ inst.version }}
            <template v-if="inst.width && inst.height"> · {{ inst.width }}×{{ inst.height }}</template>
            <template v-if="inst.launchArgs"> · {{ inst.launchArgs }}</template>
          </span>
        </span>
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
  letter-spacing: 0;
  text-transform: none;
}
.count {
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
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
  min-width: 180px;
}
.field--wide {
  flex: 1 1 260px;
}
.field--num {
  min-width: 96px;
}
.editing-hint {
  flex: 1 1 100%;
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.link {
  background: none;
  border: none;
  padding: 0;
  color: var(--accent);
  cursor: pointer;
  font-size: var(--fs-xs);
}
.link:hover {
  text-decoration: underline;
}
/* 输入控件 inset 质感：第3级底 + 底缘内阴影 + 无边框，focus accent 投影环 */
.input {
  padding: var(--space-3) var(--space-4);
  background: var(--surface-3);
  border: none;
  border-radius: var(--radius-md);
  color: var(--text-primary);
  box-shadow: var(--input-inset);
  transition: background-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
}
.input:hover {
  background: var(--surface-4);
}
.input:focus-visible {
  outline: none;
  box-shadow: var(--input-focus-shadow);
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
  padding: var(--space-4) var(--space-5);
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
}
.card:hover {
  background: var(--surface-3);
  border-color: var(--accent);
}
.card-main {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}
.card-meta {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-name {
  color: var(--text-primary);
}
.card-ver {
  font-size: var(--fs-sm);
  color: var(--text-secondary);
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
