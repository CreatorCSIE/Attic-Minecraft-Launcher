<script setup lang="ts">
/**
 * 自定义版本配置页 —— 双栏形态（镜像 AccountsPanel 排版，用户指定）：
 * 左 = 搜索框 + 「导入 jar」按钮 + custom 版本列表（名称 + 已配置/未配置徽标）；
 * 右 = 选中版本的 .info 编辑表单（launch-method 下拉 + 其余字段文本输入）。
 * Betacraft 官方版本不落入本页（runtime 已过滤）；launch-method 合法键集由契约随数据下发（detail.launchMethods），零硬编码。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from '../i18n';
import { useCustomVersions } from '../composables/useCustomVersions';
import { useBridge } from '../composables/useBridge';
import ConfirmDialog from './ConfirmDialog.vue';

const { t } = useI18n();
const {
  versions,
  selected,
  detail,
  loading,
  detailLoading,
  saveError,
  saving,
  externalChanged,
  select,
  save,
  remove,
  importJar,
  setDirtyProbe,
} = useCustomVersions();
const { hasBridge } = useBridge();

const search = ref('');
const saved = ref(false);
let savedTimer: ReturnType<typeof setTimeout> | undefined;

// 删除确认（防误删，用户指定）：目标 id + 弹窗开关 + 在途态
const removeOpen = ref(false);
const removeTarget = ref('');
const removing = ref(false);

function askRemove(id: string): void {
  removeTarget.value = id;
  removeOpen.value = true;
}

async function onConfirmRemove(): Promise<void> {
  removing.value = true;
  const ok = await remove(removeTarget.value);
  removing.value = false;
  if (ok) removeOpen.value = false;
}

/** .info 可编辑文本字段（键即标签，保持与 properties 一致；launch-method 单独走下拉）。 */
const TEXT_FIELDS = [
  'main-class',
  'launch-method-link',
  'minecraft-arguments',
  'assets',
  'type',
  'protocolVersion',
  'base-version',
  'url',
  'sha1',
  'proxy-args',
  'release-date',
  'compile-date',
  'file-ver',
];

/**
 * 右栏编辑模型：detail 变化即重置——全部可编辑字段预置空串（保存时整表下发，
 * 选填留空由 runtime 落盘为 `key=`）；launch-method 必填，未配置裸 jar 用检测建议预填。
 * baseline = 载入快照：外部改动事件据此判脏（未脏自动重载，有编辑则提示不覆盖，见 composable）。
 */
const form = ref<Record<string, string>>({});
const baseline = ref('');
watch(
  detail,
  (d) => {
    if (!d) {
      form.value = {};
      baseline.value = '';
      return;
    }
    const base: Record<string, string> = {};
    for (const key of ['launch-method', ...TEXT_FIELDS]) base[key] = '';
    for (const [k, v] of Object.entries(d.props)) if (k !== 'custom') base[k] = v;
    if (!d.configured && d.detectedMethod && !base['launch-method']) {
      base['launch-method'] = d.detectedMethod;
    }
    form.value = base;
    baseline.value = JSON.stringify(base);
  },
  { immediate: true },
);

/** 表单是否存在未保存编辑（键序稳定：两对象同构造路径）。 */
const dirty = computed(() => JSON.stringify(form.value) !== baseline.value);

// 脏态探针交给 composable 的外部改动事件处理；面板卸载解除（模块级单例不泄漏到下次挂载外）。
setDirtyProbe(() => dirty.value);
onBeforeUnmount(() => setDirtyProbe(null));

/** 外部改动提示条的重载动作：丢弃未保存编辑，表单回到磁盘最新内容（select 同 id 重载即复位提示）。 */
function reloadFromDisk(): void {
  if (selected.value) void select(selected.value.id);
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return versions.value;
  return versions.value.filter((v) => v.id.toLowerCase().includes(q));
});

async function onSave(): Promise<void> {
  if (!selected.value) return;
  const ok = await save(selected.value.id, form.value);
  if (ok) {
    saved.value = true;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (saved.value = false), 1500);
  }
}
</script>

<template>
  <section class="custom-page">
    <!-- 左栏：搜索 + 导入 + custom 版本列表 -->
    <aside class="menu">
      <h2 class="menu-title">{{ t('custom.title') }}</h2>

      <div class="menu-tools">
        <div class="search-box">
          <!-- lucide: search -->
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input v-model="search" class="search-input" type="text" :placeholder="t('custom.search')" />
        </div>
        <button class="import-btn" type="button" :disabled="!hasBridge" @click="importJar">
          <!-- lucide: download -->
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" x2="12" y1="15" y2="3" />
          </svg>
          <span>{{ t('custom.import') }}</span>
        </button>
      </div>

      <div v-if="loading" class="menu-state">{{ t('common.loading') }}</div>
      <ul v-else-if="filtered.length" class="menu-list">
        <li v-for="v in filtered" :key="v.id" class="menu-row">
          <!-- title = 完整 id（248px 下长 id 必截断，hover 兜底看全值；实例页同款） -->
          <button
            class="menu-item"
            :class="{ 'menu-item--selected': selected?.id === v.id }"
            type="button"
            :title="v.id"
            @click="select(v.id)"
          >
            <span class="mi-name">{{ v.id }}</span>
            <span class="badge" :class="v.configured ? 'badge--ok' : 'badge--warn'">
              {{ v.configured ? t('custom.configured') : t('custom.unconfigured') }}
            </span>
          </button>
          <button
            class="mi-del"
            type="button"
            :disabled="!hasBridge"
            :title="t('custom.remove')"
            @click.stop="askRemove(v.id)"
          >
            <!-- lucide: trash-2 -->
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              <line x1="10" x2="10" y1="11" y2="17" />
              <line x1="14" x2="14" y1="11" y2="17" />
            </svg>
          </button>
        </li>
      </ul>
      <p v-else class="menu-empty">
        {{ versions.length ? t('custom.empty') : t('custom.none') }}
        <span class="menu-empty-hint">{{ t('custom.emptyHint') }}</span>
      </p>
    </aside>

    <!-- 右栏：.info 编辑器 -->
    <div class="detail">
      <div v-if="detailLoading" class="empty"><p class="state-hint">{{ t('common.loading') }}</p></div>
      <div v-else-if="detail && selected" class="editor">
        <div class="editor-head">
          <div class="head-main">
            <h3 class="id">{{ selected.id }}</h3>
            <span class="badge" :class="detail.configured ? 'badge--ok' : 'badge--warn'">
              {{ detail.configured ? t('custom.configured') : t('custom.unconfigured') }}
            </span>
          </div>
          <p v-if="!detail.configured && detail.detectedMethod" class="detected">
            {{ t('custom.detectedHint', { method: detail.detectedMethod }) }}
          </p>
          <p v-else-if="!detail.configured" class="detected detected--muted">
            {{ t('custom.notDetected') }}
          </p>
        </div>

        <!-- 外部改动冲突提示：编辑未保存时不覆盖表单，由用户决定是否重载 -->
        <div v-if="externalChanged" class="external-banner">
          <p class="external-text">{{ t('custom.externalChanged') }}</p>
          <button class="external-reload" type="button" @click="reloadFromDisk">
            {{ t('custom.reload') }}
          </button>
        </div>

        <div class="field">
          <label class="label" for="cv-launch">
            {{ t('custom.launchMethod') }}
            <span class="req">*</span>
          </label>
          <select id="cv-launch" v-model="form['launch-method']" class="input" :class="{ 'input--invalid': !form['launch-method'] }">
            <option value="">{{ t('custom.launchMethodNone') }}</option>
            <option v-for="m in detail.launchMethods" :key="m" :value="m">{{ m }}</option>
          </select>
          <p v-if="!form['launch-method']" class="req-hint">{{ t('custom.launchMethodRequired') }}</p>
        </div>

        <div v-for="key in TEXT_FIELDS" :key="key" class="field">
          <label class="label label--mono" :for="`cv-${key}`">{{ key }}</label>
          <input :id="`cv-${key}`" v-model="form[key]" class="input" type="text" />
        </div>

        <div class="actions">
          <button
            class="primary"
            type="button"
            :disabled="saving || !hasBridge || !form['launch-method']"
            @click="onSave"
          >
            {{ saving ? t('custom.saving') : t('custom.save') }}
          </button>
          <span v-if="saved" class="saved">{{ t('custom.saved') }}</span>
        </div>
        <p v-if="saveError" class="save-error">{{ saveError }}</p>
      </div>

      <!-- 空态：无卡片，仅居中文案（对齐账户页） -->
      <div v-else class="empty">
        <p class="state-hint">{{ t('custom.hint') }}</p>
      </div>
    </div>

    <!-- 删除确认（防误删）：文案含版本 id，确认即删 jar+.info -->
    <ConfirmDialog
      v-model:open="removeOpen"
      :title="t('custom.removeDialog.title')"
      :message="t('custom.removeDialog.message', { id: removeTarget })"
      :busy="removing"
      @confirm="onConfirmRemove"
    />
  </section>
</template>

<style scoped>
/* BlockHelm 骨架（用户指定）：SecondaryMenuFrame 贴左不随居中移动，
   详情内容在剩余空间内浮中（见 .editor 的 margin-inline）。 */
.custom-page {
  display: flex;
  flex: 1;
  gap: var(--space-5);
  min-height: 0;
  padding: var(--space-5);
}
/* —— 左栏：固定宽卡片（SecondaryMenuFrame 248px 等效，与账户页统一，用户指定） —— */
.menu {
  flex: 0 0 248px;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-4);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  overflow-y: auto;
}
.menu-title {
  margin: 0 0 0 var(--space-2);
  font-size: var(--fs-xl);
  font-weight: 700;
  color: var(--text-primary);
}
/* 搜索 + 导入：菜单顶部工具区（用户指定左栏必备） */
.menu-tools {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.search-box {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--surface-3);
  border-radius: var(--radius-md);
  box-shadow: var(--input-inset);
  transition: box-shadow var(--dur-fast) var(--ease-out);
}
.search-box:focus-within {
  box-shadow: var(--input-focus-shadow);
}
.search-box svg {
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  color: var(--text-muted);
}
.search-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-size: var(--fs-md);
}
.search-input::placeholder {
  color: var(--text-muted);
}
.import-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--accent-soft);
  border: 1px solid var(--accent);
  border-radius: var(--radius-md);
  color: var(--accent);
  font-size: var(--fs-md);
  font-weight: 600;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}
.import-btn svg {
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
}
.import-btn:hover:not(:disabled) {
  background: var(--accent);
  color: var(--accent-ink);
}
.import-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.menu-state {
  font-size: var(--fs-sm);
  color: var(--text-muted);
  padding: var(--space-2);
}
.menu-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
/* 行容器：hover 浮现删除钮（镜像账户页 mi-del 配方） */
.menu-row {
  position: relative;
}
.menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  padding-right: calc(var(--space-3) + 30px); /* 给 hover 删除钮让位 */
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: var(--fs-md);
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}
.menu-item:hover {
  background-color: var(--surface-3);
}
.menu-item--selected {
  background-color: var(--surface-3);
  box-shadow: inset 0 0 0 1px var(--surface-4);
}
.mi-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
}
/* 删除钮：hover 行时浮现（账户页同款配方） */
.mi-del {
  position: absolute;
  top: 50%;
  right: var(--space-2);
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--danger);
  opacity: 0;
  pointer-events: none;
  cursor: pointer;
  transition:
    opacity var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}
.mi-del svg {
  width: 16px;
  height: 16px;
}
.menu-row:hover .mi-del {
  opacity: 1;
  pointer-events: auto;
}
.mi-del:hover {
  background: var(--danger-soft);
}
.mi-del:disabled {
  display: none;
}
.menu-empty {
  margin: var(--space-2);
  font-size: var(--fs-md);
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.menu-empty-hint {
  font-size: var(--fs-sm);
  color: var(--text-muted);
}
/* 徽标：已配置=ok 绿 / 未配置=warn 琥珀（pill 形态） */
.badge {
  flex: 0 0 auto;
  padding: 2px var(--space-2);
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
  font-weight: 600;
  white-space: nowrap;
}
.badge--ok {
  background: var(--ok-soft);
  color: var(--ok);
}
.badge--warn {
  background: var(--warn-soft);
  color: var(--warn);
}
/* —— 右栏：info 编辑器 —— */
.detail {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-6) var(--space-3);
}
/* DetailPageContentMaxWidth 等效：限宽列在剩余空间中水平浮中（BlockHelm 用户指定）。 */
.editor {
  max-width: 620px;
  margin-inline: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.editor-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.head-main {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.id {
  margin: 0;
  font-size: var(--fs-xl);
  font-weight: 700;
  color: var(--text-primary);
  font-family: var(--font-mono);
  overflow-wrap: anywhere;
}
.detected {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--accent);
}
.detected--muted {
  color: var(--text-muted);
}
/* 外部改动横幅：warn 软底（非阻断——编辑仍可继续，重载由用户决定） */
.external-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--warn-soft);
  border: 1px solid var(--warn);
  border-radius: var(--radius-md);
}
.external-text {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--text-primary);
}
.external-reload {
  flex: 0 0 auto;
  padding: var(--space-1) var(--space-4);
  background: transparent;
  border: 1px solid var(--warn);
  border-radius: var(--radius-md);
  color: var(--warn);
  font-size: var(--fs-sm);
  font-weight: 600;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}
.external-reload:hover {
  background: var(--warn);
  /* 实心 warn 底上的文字：取反色层级 surface-1（深主题=近黑/浅主题=近白，两主题对比度均成立） */
  color: var(--surface-1);
}
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.label {
  font-size: var(--fs-sm);
  color: var(--text-secondary);
}
.label--mono {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
}
/* 输入控件 inset 质感（与实例页同款配方） */
.input {
  padding: var(--space-3) var(--space-4);
  background: var(--surface-3);
  border: none;
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: var(--fs-md);
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
select.input {
  cursor: pointer;
}
/* 必填标记与缺失反馈（launch-method） */
.req {
  color: var(--danger);
  font-weight: 700;
}
.req-hint {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--danger);
}
.input--invalid {
  box-shadow: var(--input-inset), inset 0 0 0 1px var(--danger);
}
.actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-2);
}
.primary {
  padding: var(--space-2) var(--space-5);
  background: var(--accent);
  color: var(--accent-ink);
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--fs-md);
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
  opacity: 0.6;
  cursor: default;
}
.saved {
  font-size: var(--fs-sm);
  color: var(--ok);
}
.save-error {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--danger);
}
.empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.state-hint {
  margin: 0;
  font-size: var(--fs-md);
  color: var(--text-secondary);
}
</style>
