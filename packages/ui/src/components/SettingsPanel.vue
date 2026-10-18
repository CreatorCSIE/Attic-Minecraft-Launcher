<script setup lang="ts">
/**
 * 设置面板 —— Java 路径（含探测全候选面板，风险 #7）、内存、端点（下次启动生效）、主题。
 * 写入统一走桥 setSettings（合并落盘属 runtime）；UI 不碰文件（戒律 #1）。
 */
import { reactive, ref, watch } from 'vue';
import { useI18n } from '../i18n';
import { useSettings } from '../composables/useSettings';
import { useJava } from '../composables/useJava';
import type { EndpointOverrides, ThemeMode } from '@attic/core-spec';

const { t } = useI18n();
const { settings, loaded, saving, themeMode, patch, setTheme } = useSettings();
const { report, loading: javaLoading, error: javaError, detect } = useJava();

const form = reactive({
  javaPath: '',
  maxMemoryMb: 1024,
  username: '',
  endpoints: {
    versionList: '',
    filesBase: '',
    legacyfixRelease: '',
    zuluMetadata: '',
    mojangManifest: '',
  } as Record<keyof EndpointOverrides, string>,
});

function syncForm(): void {
  form.javaPath = settings.value.javaPath ?? '';
  form.maxMemoryMb = settings.value.maxMemoryMb ?? 1024;
  form.username = settings.value.username ?? '';
  const ep = settings.value.endpoints ?? {};
  (Object.keys(form.endpoints) as (keyof EndpointOverrides)[]).forEach((k) => {
    form.endpoints[k] = ep[k] ?? '';
  });
}

watch(loaded, (v) => {
  if (v) syncForm();
});

const saved = ref(false);

function cleanEndpoints(): EndpointOverrides | undefined {
  const out: EndpointOverrides = {};
  let any = false;
  (Object.keys(form.endpoints) as (keyof EndpointOverrides)[]).forEach((k) => {
    const val = form.endpoints[k].trim();
    if (val) {
      out[k] = val;
      any = true;
    }
  });
  return any ? out : undefined;
}

async function onSave(): Promise<void> {
  saved.value = false;
  const ok = await patch({
    javaPath: form.javaPath.trim() || undefined,
    maxMemoryMb: form.maxMemoryMb,
    username: form.username.trim() || undefined,
    endpoints: cleanEndpoints(),
  });
  saved.value = ok;
}

const themes: ThemeMode[] = ['dark', 'light', 'system'];
</script>

<template>
  <section class="settings">
    <div class="head">
      <span class="label">{{ t('settings.title') }}</span>
    </div>

    <!-- Java -->
    <div class="block">
      <div class="block-head">
        <span class="label">{{ t('settings.java') }}</span>
        <button class="mini" :disabled="javaLoading" @click="detect()">
          {{ javaLoading ? t('common.loading') : t('settings.javaDetect') }}
        </button>
      </div>
      <input v-model="form.javaPath" class="input mono" type="text" :placeholder="t('settings.javaAuto')" />

      <div v-if="javaError" class="err">{{ t('common.error') }}：{{ javaError }}</div>

      <div v-else-if="report" class="java-report">
        <div class="sub">
          <span class="label">{{ t('settings.selection') }}</span>
          <span v-if="report.selection.install" class="mono sel">
            {{ report.selection.install.executable }}
            <span class="tag">Java {{ report.selection.install.major }} · {{ report.selection.install.architecture }}</span>
          </span>
          <span v-else class="muted">{{ t('settings.noneDetected') }}</span>
          <p class="reason">{{ report.selection.reason }}</p>
          <p v-if="report.selection.usedFallback" class="warn">{{ t('settings.usedFallback') }}</p>
        </div>

        <div v-if="report.installs.length" class="sub">
          <span class="label">{{ t('settings.candidates') }}</span>
          <ul class="rows">
            <li v-for="i in report.installs" :key="i.executable">
              <span class="mono">{{ i.executable }}</span>
              <span class="tag">{{ i.raw }} · {{ i.architecture }} · {{ i.source }}</span>
            </li>
          </ul>
        </div>

        <div v-if="report.failures.length" class="sub">
          <span class="label">{{ t('settings.failures') }}</span>
          <ul class="rows">
            <li v-for="f in report.failures" :key="f.executable">
              <span class="mono">{{ f.executable }}</span>
              <span class="tag tag--err">{{ f.reason }}</span>
            </li>
          </ul>
        </div>

        <div v-if="report.diagnostics.length" class="sub">
          <span class="label">{{ t('settings.diagnostics') }}</span>
          <ul class="rows muted">
            <li v-for="(d, idx) in report.diagnostics" :key="idx">{{ d }}</li>
          </ul>
        </div>
      </div>
    </div>

    <!-- 内存 / 用户名 -->
    <div class="grid">
      <div class="block">
        <label class="label" for="mem">{{ t('settings.memory') }}</label>
        <input id="mem" v-model.number="form.maxMemoryMb" class="input tabular" type="number" min="256" step="128" />
      </div>
      <div class="block">
        <label class="label" for="user">{{ t('settings.username') }}</label>
        <input id="user" v-model="form.username" class="input" type="text" placeholder="Player" />
      </div>
    </div>

    <!-- 主题 -->
    <div class="block">
      <span class="label">{{ t('settings.theme') }}</span>
      <div class="segmented">
        <button
          v-for="th in themes"
          :key="th"
          class="seg"
          :class="{ 'seg--active': themeMode === th }"
          @click="setTheme(th)"
        >
          {{ t(`settings.theme${th.charAt(0).toUpperCase()}${th.slice(1)}`) }}
        </button>
      </div>
    </div>

    <!-- 端点 -->
    <div class="block">
      <div class="block-head">
        <span class="label">{{ t('settings.endpoints') }}</span>
        <span class="note">{{ t('settings.endpointsNote') }}</span>
      </div>
      <div class="grid grid--2">
        <input v-model="form.endpoints.versionList" class="input mono" type="text" placeholder="versionList" />
        <input v-model="form.endpoints.filesBase" class="input mono" type="text" placeholder="filesBase" />
        <input v-model="form.endpoints.legacyfixRelease" class="input mono" type="text" placeholder="legacyfixRelease" />
        <input v-model="form.endpoints.zuluMetadata" class="input mono" type="text" placeholder="zuluMetadata" />
        <input v-model="form.endpoints.mojangManifest" class="input mono" type="text" placeholder="mojangManifest" />
      </div>
    </div>

    <div class="foot">
      <button class="primary" :disabled="saving" @click="onSave">
        {{ saving ? t('common.loading') : t('settings.save') }}
      </button>
      <span v-if="saved" class="saved">{{ t('settings.saved') }}</span>
    </div>
  </section>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-5);
  max-width: 720px;
  /* 组居中（用户指定）：单栏页同样水平居中，不留左侧贴边 */
  margin-inline: auto;
}
.head {
  display: flex;
  align-items: baseline;
}
/* 分区标题：fs-lg 加粗（java-report 内的微标签保留 uppercase tracking 形态） */
.head .label,
.block > .label,
.block-head > .label {
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: 0;
  text-transform: none;
}
/* Settings 分区 = base-card 统一配方 */
.block {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-5);
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}
.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.grid {
  display: grid;
  gap: var(--space-4);
}
.grid--2 {
  grid-template-columns: 1fr 1fr;
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
.mini {
  padding: var(--space-1) var(--space-3);
  background: transparent;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  font-size: var(--fs-sm);
  color: var(--text-primary);
  box-shadow: var(--inset-bottom);
  transition: background var(--dur-fast) var(--ease-out);
}
.mini:hover:not(:disabled) {
  background: var(--surface-4);
}
.mini:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.note {
  font-size: var(--fs-xs);
  color: var(--warn);
}
.err {
  font-size: var(--fs-sm);
  color: var(--danger);
}
.warn {
  font-size: var(--fs-sm);
  color: var(--warn);
}
.muted {
  color: var(--text-muted);
}
/* 探测面板 = 卡片上的下沉井：第1级底 + 底缘内阴影 */
.java-report {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--surface-1);
  border: none;
  border-radius: var(--radius-md);
  box-shadow: var(--input-inset);
}
.sub {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.sel {
  font-size: var(--fs-sm);
  color: var(--text-primary);
}
.reason {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: var(--fs-xs);
}
.rows li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.rows .mono {
  font-family: var(--font-mono);
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag {
  color: var(--text-muted);
  flex: 0 0 auto;
}
.tag--err {
  color: var(--danger);
}
/* 主题分段器：第1级下沉轨道 + 内衬圆角块，激活=第4级高亮 */
.segmented {
  display: inline-flex;
  gap: var(--space-1);
  padding: var(--space-1);
  background: var(--surface-1);
  border: none;
  border-radius: var(--radius-md);
  box-shadow: var(--input-inset);
  width: fit-content;
}
.seg {
  padding: var(--space-2) var(--space-4);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.seg:hover {
  background: var(--surface-3);
}
.seg--active {
  background: var(--surface-4);
  color: var(--text-primary);
}
.foot {
  display: flex;
  align-items: center;
  gap: var(--space-3);
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
  font-size: var(--fs-sm);
  color: var(--ok);
}
</style>
