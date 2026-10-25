<script setup lang="ts">
/**
 * 设置页 · 关于栏 —— 格式照搬 BlockHelm InfoSettingsView（用户定稿）：
 * 头区（名称 + v版本号 + GitHub/检查更新按钮）→ 启动器更新（通道占位）→
 * 版权及法律声明（版权/开源协议/用户协议三行）→ 引用的项目列表。
 * 许可证均经实查不虚构：上游四项目 LICENSE 逐字为 GPL-3.0，Vue/Electron=MIT，Lucide=ISC。
 * 外链走 openExternalUrl（宿主白名单校验；浏览器 mock 直放 window.open，demo 可用）；
 * 打开失败（无默认浏览器等）经 useExternalLink 全局弹窗显式报错，不再静默。
 */
import { ref } from 'vue';
import type { UpdateCheckResult } from '@attic/core-spec';
import { useI18n } from '../i18n';
import { useExternalLink } from '../composables/useExternalLink';
import { useSysInfo } from '../composables/useSysInfo';
import { useUpdateCheck } from '../composables/useUpdateCheck';
import { isDemo } from '../dev/demo';
import AppDialog from './AppDialog.vue';
import AppSelect from './AppSelect.vue';
import appIcon from '../assets/app-icon.png';

const { t } = useI18n();
const { openExternal } = useExternalLink();
const { info } = useSysInfo();
const { busy: checkingBusy, hasUpdate, check: runCheck } = useUpdateCheck();

// —— 检查更新弹窗（AppDialog 壳，ConfirmDialog 同款三段式；四分支全可见呈现）——
const dialogOpen = ref(false);
const dialogResult = ref<UpdateCheckResult | null>(null);

/** 发布说明纯文本截断（GitHub body 是 markdown，弹窗不渲染；超长截尾防弹窗被淹没）。 */
const NOTES_LIMIT = 600;
function displayNotes(notes: string): string {
  const trimmed = notes.trim();
  return trimmed.length > NOTES_LIMIT ? `${trimmed.slice(0, NOTES_LIMIT)}…` : trimmed;
}

async function onCheckUpdate(): Promise<void> {
  const res = await runCheck();
  if (!res) return; // 在途重入：不弹第二发
  dialogResult.value = res;
  dialogOpen.value = true;
}

/** 打开发布页：走 openExternal 通道（宿主白名单校验），失败经 useExternalLink 全局弹窗报错。 */
function openReleasePage(url: string): void {
  openExternal(url);
  dialogOpen.value = false;
}

const REPO_URL = 'https://github.com/CreatorCSIE/Attic-Minecraft-Launcher';
const LICENSE_URL = `${REPO_URL}/blob/HEAD/LICENSE`;

// 运行面后缀（宿主版本号零感知，标注全在 UI 侧合成）：
// vite dev server（pnpm/npm run dev）下 DEV=true → `-dev`；?demo=1 时续接 `-demo`
// （isDemo 仅 dev 存活，顺序恒为 -dev-demo）；构建产物两态恒 false，后缀整体消失。
const versionSuffix = `${import.meta.env.DEV ? '-dev' : ''}${isDemo() ? '-demo' : ''}`;

interface ReferenceProject {
  name: string;
  url: string;
  license: string;
  /** i18n 键后缀（settings.about.ref.<key>）。 */
  key: string;
}

const references: ReferenceProject[] = [
  { name: 'Betacraft Launcher (v1)', url: 'https://github.com/betacraftuk/betacraft-launcher', license: 'GPL-3.0', key: 'betacraft' },
  { name: 'LegacyFix', url: 'https://github.com/betacraftuk/legacyfix', license: 'GPL-3.0', key: 'legacyfix' },
  { name: 'MCANextGen', url: 'https://github.com/CreatorCSIE/MCANextGen', license: 'GPL-3.0', key: 'mcanextgen' },
  { name: 'BlockHelm Launcher', url: 'https://github.com/zqq-699/BlockHelm-Launcher', license: 'GPL-3.0', key: 'blockhelm' },
  { name: 'Vue', url: 'https://github.com/vuejs/core', license: 'MIT', key: 'vue' },
  { name: 'Electron', url: 'https://github.com/electron/electron', license: 'MIT', key: 'electron' },
  { name: 'Lucide Icons', url: 'https://github.com/lucide-icons/lucide', license: 'ISC', key: 'lucide' },
];

function openUrl(url: string): void {
  openExternal(url);
}
</script>

<template>
  <section class="pane">
    <h3 class="pane-title">{{ t('settings.sectionAbout') }}</h3>

    <!-- 头区：名称 + 版本 + 动作键（版本号来自宿主快照，无桥时隐藏版本行） -->
    <div class="card head-card">
      <div class="head-brand">
        <span class="head-logo">
          <!-- 品牌图标（源 = apps/tauri/brand/attic-icon.png 母版，与安装包图标同源） -->
          <img :src="appIcon" alt="" />
        </span>
        <div>
          <p class="head-name">{{ t('app.title') }}</p>
          <p v-if="info" class="head-version mono">v{{ info.launcherVersion }}{{ versionSuffix }}</p>
        </div>
      </div>
      <div class="head-actions">
        <button class="mini" @click="openUrl(REPO_URL)">{{ t('settings.about.ghRepo') }}</button>
        <!-- 检查更新：手动触发 + 结果弹窗（启动静默检查的红点徽标由 useUpdateCheck 共享） -->
        <button class="mini" :disabled="checkingBusy" @click="onCheckUpdate">
          {{ checkingBusy ? t('settings.about.checking') : t('settings.about.checkUpdate') }}
          <span v-if="hasUpdate" class="update-dot">{{ t('settings.about.newBadge') }}</span>
        </button>
      </div>
    </div>

    <!-- 启动器更新（未来更新系统的挂载点，现占位） -->
    <div class="card">
      <h4 class="group-title">{{ t('settings.about.updateSection') }}</h4>
      <div class="row">
        <div class="row-info">
          <span class="row-name">{{ t('settings.about.updateChannel') }}</span>
          <p class="row-desc">{{ t('settings.about.updateSoon') }}</p>
        </div>
        <AppSelect
          class="select"
          :model-value="'release'"
          :options="[
            { value: 'release', label: t('settings.about.channelRelease') },
            { value: 'beta', label: t('settings.about.channelBeta') },
          ]"
          :aria-label="t('settings.about.updateChannel')"
          disabled
        />
      </div>
    </div>

    <!-- 版权及法律声明 -->
    <div class="card">
      <h4 class="group-title">{{ t('settings.about.legalSection') }}</h4>
      <div class="row">
        <div class="row-info">
          <span class="row-name">{{ t('settings.about.copyright') }}</span>
          <p class="row-desc">{{ t('settings.about.copyrightDesc') }}</p>
        </div>
        <button class="mini" @click="openUrl(REPO_URL)">{{ t('settings.about.view') }}</button>
      </div>
      <div class="row">
        <div class="row-info">
          <span class="row-name">{{ t('settings.about.license') }}</span>
          <p class="row-desc">{{ t('settings.about.licenseDesc') }}</p>
        </div>
        <button class="mini" @click="openUrl(LICENSE_URL)">{{ t('settings.about.view') }}</button>
      </div>
      <div class="row">
        <div class="row-info">
          <span class="row-name">
            {{ t('settings.about.agreement') }}
            <span class="soon">{{ t('settings.soon') }}</span>
          </span>
          <p class="row-desc">{{ t('settings.about.agreementDesc') }}</p>
        </div>
        <button class="mini" disabled>{{ t('settings.about.view') }}</button>
      </div>
    </div>

    <!-- 引用的项目 -->
    <div class="card">
      <h4 class="group-title">{{ t('settings.about.refsSection') }}</h4>
      <div v-for="p in references" :key="p.name" class="row">
        <div class="row-info">
          <span class="row-name">{{ p.name }}</span>
          <p class="row-desc">{{ t(`settings.about.ref.${p.key}`) }}</p>
          <p class="row-license mono">{{ p.license }}</p>
        </div>
        <button class="mini" @click="openUrl(p.url)">{{ t('settings.about.view') }}</button>
      </div>
    </div>

    <!-- 检查更新结果弹窗：update/upToDate/unconfigured/error 四分支全可见呈现（不静默） -->
    <AppDialog :open="dialogOpen" @close="dialogOpen = false">
      <header class="upd-head">
        <h2 class="upd-title">{{ t('settings.about.updateDialog.title') }}</h2>
        <template v-if="dialogResult">
          <p v-if="dialogResult.status === 'upToDate'" class="upd-body">
            {{ t('settings.about.updateDialog.upToDate', { version: dialogResult.current }) }}
          </p>
          <template v-else-if="dialogResult.status === 'update'">
            <p class="upd-body">{{ t('settings.about.updateDialog.found', { version: dialogResult.version }) }}</p>
            <p v-if="dialogResult.publishedAt" class="upd-date">
              {{ t('settings.about.updateDialog.published', { date: dialogResult.publishedAt.slice(0, 10) }) }}
            </p>
            <pre v-if="dialogResult.notes" class="upd-notes">{{ displayNotes(dialogResult.notes) }}</pre>
          </template>
          <p v-else-if="dialogResult.status === 'unconfigured'" class="upd-body">
            {{ t('settings.about.updateDialog.unconfigured') }}
          </p>
          <p v-else class="upd-body upd-failed">
            {{ t('settings.about.updateDialog.failed', { message: dialogResult.message }) }}
          </p>
        </template>
      </header>
      <footer class="upd-foot">
        <button class="ghost" type="button" @click="dialogOpen = false">
          {{ t('settings.about.updateDialog.close') }}
        </button>
        <button
          v-if="dialogResult && dialogResult.status === 'update' && dialogResult.url"
          class="primary"
          type="button"
          @click="openReleasePage(dialogResult.url)"
        >
          {{ t('settings.about.updateDialog.openReleases') }}
        </button>
      </footer>
    </AppDialog>
  </section>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.pane-title {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 600;
}
.card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-5);
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}
/* GroupBox 标题（BlockHelm LauncherContentSection Header 等效） */
.group-title {
  margin: 0;
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.head-card {
  gap: var(--space-4);
}
.head-brand {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.head-logo {
  display: inline-flex;
  width: 56px;
  height: 56px;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: var(--radius-lg);
}
.head-logo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.head-name {
  margin: 0;
  font-size: var(--fs-xl);
  font-weight: 600;
  color: var(--text-primary);
}
.head-version {
  margin: var(--space-1) 0 0;
  font-size: var(--fs-sm);
  color: var(--text-secondary);
}
.head-actions {
  display: flex;
  gap: var(--space-3);
}
/* 声明/引用行：左信息 + 右动作（BlockHelm Grid * / Auto 配方） */
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border);
}
.row:first-of-type {
  padding-top: 0;
}
.row:last-child {
  padding-bottom: 0;
  border-bottom: none;
}
.row-info {
  min-width: 0;
}
.row-name {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--text-primary);
}
.row-desc {
  margin: 2px 0 0;
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
.row-license {
  margin: 2px 0 0;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
}
.soon {
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
}
/* 有新版红点徽标（复用 .soon 样式位换 danger 色——「有新版」是行动提示，非状态占位） */
.update-dot {
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 600;
  color: var(--danger-ink);
  background: var(--danger);
  border: 1px solid var(--danger);
  border-radius: var(--radius-pill);
}
/* —— 检查更新弹窗（ConfirmDialog 三段式同构，四分支共用） —— */
.upd-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.upd-title {
  margin: 0;
  font-size: var(--fs-xl);
  font-weight: 700;
  color: var(--text-primary);
}
.upd-body {
  margin: 0;
  font-size: var(--fs-md);
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.upd-failed {
  color: var(--danger);
}
.upd-date {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
/* 发布说明：纯文本 pre（markdown 不渲染，截断在脚本侧），超高内滚 */
.upd-notes {
  margin: 0;
  padding: var(--space-3);
  max-height: 220px;
  overflow-y: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  line-height: 1.6;
  color: var(--text-secondary);
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.upd-foot {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: var(--space-3);
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
    filter var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}
.primary:hover {
  filter: brightness(1.12);
}
.primary:active {
  transform: scale(0.97);
}
.mini {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  background: transparent;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  font-size: var(--fs-sm);
  color: var(--text-primary);
  box-shadow: var(--inset-bottom);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}
.mini:hover:not(:disabled) {
  background: var(--surface-4);
}
.mini:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.select {
  flex: 0 0 auto;
}
.mono {
  font-family: var(--font-mono);
}
.input {
  color: var(--text-primary);
}
</style>
