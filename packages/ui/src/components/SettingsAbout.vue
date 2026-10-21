<script setup lang="ts">
/**
 * 设置页 · 关于栏 —— 格式照搬 BlockHelm InfoSettingsView（用户定稿）：
 * 头区（名称 + v版本号 + GitHub/检查更新按钮）→ 启动器更新（通道占位）→
 * 版权及法律声明（版权/开源协议/用户协议三行）→ 引用的项目列表。
 * 许可证均经实查不虚构：上游四项目 LICENSE 逐字为 GPL-3.0，Vue/Electron=MIT，Lucide=ISC。
 * 外链走 openExternalUrl（宿主白名单校验；浏览器 mock 直放 window.open，demo 可用）。
 */
import { useI18n } from '../i18n';
import { useBridge } from '../composables/useBridge';
import { useSysInfo } from '../composables/useSysInfo';
import { isDemo } from '../dev/demo';
import AppSelect from './AppSelect.vue';

const { t } = useI18n();
const { bridge } = useBridge();
const { info } = useSysInfo();

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
  void bridge.openExternalUrl(url);
}
</script>

<template>
  <section class="pane">
    <h3 class="pane-title">{{ t('settings.sectionAbout') }}</h3>

    <!-- 头区：名称 + 版本 + 动作键（版本号来自宿主快照，无桥时隐藏版本行） -->
    <div class="card head-card">
      <div class="head-brand">
        <span class="head-logo" aria-hidden="true">
          <!-- lucide: mountain (品牌占位图形，与字标同源) -->
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m8 3 4 8 5-5 5 11H2L8 3z" />
          </svg>
        </span>
        <div>
          <p class="head-name">{{ t('app.title') }}</p>
          <p v-if="info" class="head-version mono">v{{ info.launcherVersion }}{{ versionSuffix }}</p>
        </div>
      </div>
      <div class="head-actions">
        <button class="mini" @click="openUrl(REPO_URL)">{{ t('settings.about.ghRepo') }}</button>
        <button class="mini" disabled>
          {{ t('settings.about.checkUpdate') }}
          <span class="soon">{{ t('settings.soon') }}</span>
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
  align-items: center;
  justify-content: center;
  background: var(--surface-3);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  color: var(--accent);
}
.head-logo svg {
  width: 28px;
  height: 28px;
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
