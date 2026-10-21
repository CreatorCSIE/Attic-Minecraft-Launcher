<script setup lang="ts">
/**
 * 启动面板 —— 每屏唯一 accent 实心元素 = Play（ui-design.md §2）。
 * 排版（新主页）：Play 置右下角；右侧「| ≡」菜单收纳【实例设置】【测试启动】。
 * 主页保持净空（用户指定）：无卡片底/版本摘要/停止钮，为后续背景图留清晰画布；
 * 选中版本信息由左下版本面板单卡承载。
 * v1 语义：每次启动成功自动唤起独立控制台窗口（MC 日志与主页解耦）。
 * 请求形状全走契约（LaunchRequest），UI 不拼参数（戒律 #1）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { INSTANCE_ADDONS } from '@attic/core-spec';
import { useI18n } from '../i18n';
import { useSelection } from '../composables/useSelection';
import { useGame } from '../composables/useGame';
import { useSettings } from '../composables/useSettings';
import { useAccounts } from '../composables/useAccounts';
import { useBridge } from '../composables/useBridge';
import { useDownloads } from '../composables/useDownloads';
import { useInstances } from '../composables/useInstances';
import InstanceDock from './InstanceDock.vue';
import VersionSelector from './VersionSelector.vue';

const emit = defineEmits<{ (e: 'open-instances'): void }>();

const { t } = useI18n();
const { selected } = useSelection();
const { status, busy, lastError, launch, kill } = useGame();
const { settings } = useSettings();
const { current } = useAccounts();
const { bridge, hasBridge } = useBridge();
const { percent, rateBps, stage, active, failed, reset: resetDownloads } = useDownloads();
const { activeName } = useInstances();

const running = computed(() => status.value.running);
/* 聚合进度区可见性（BlockHelm 配方）：启动中展示；下载失败则常驻红态直到下次启动。 */
const showProgress = computed(() => active.value && (busy.value || failed.value !== null));
const canPlay = computed(() => hasBridge.value && !!selected.value && !!current.value && !running.value && !busy.value);
/* 启动/停止合为一体（用户指定）：同一按钮按状态切换动作——空闲=启动，运行=停止。
 * 空闲态真正可用的前置 = 有效账户 + 已选版本（用户指定：UI 侧硬门禁，不靠宿主兜底报错）。 */
const canToggle = computed(
  () => hasBridge.value && !busy.value && (running.value || (!!selected.value && !!current.value)),
);
/* 禁用原因提示（hover 标题）：缺哪个说哪个。 */
const playHint = computed(() => {
  if (running.value || busy.value || !hasBridge.value) return '';
  if (!current.value && !selected.value) return t('launch.hintNeedBoth');
  if (!current.value) return t('launch.hintNeedAccount');
  if (!selected.value) return t('launch.hintNeedVersion');
  return '';
});

// —— 「| ≡」菜单：点外部收起 ——
const menuOpen = ref(false);
const menuEl = ref<HTMLElement | null>(null);

function onDocClick(e: MouseEvent): void {
  if (!menuOpen.value) return;
  if (menuEl.value && !menuEl.value.contains(e.target as Node)) menuOpen.value = false;
}

onMounted(() => document.addEventListener('click', onDocClick, true));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick, true));

// —— 「≡」菜单 addon 动作项（INSTANCE_ADDONS 中 uiSection='launchmenu' 目录驱动；当前仅 visualizer）——
// 可点前置 = 启动页选中版本的本地 client jar 含 probeClass 条目（每次开菜单重探测）+ 常规可启动（canPlay）；
// 点击 = 一次性带 `-Dlf.visualizer` 启动（LaunchRequest.visualizer，不写实例档案）。
// legacyfix 侧生效待 nightly（用户拍板暂缓实现）；档案 addons 仍可携带同 id = 常开语义。
const menuAddonDefs = INSTANCE_ADDONS.filter((d) => d.uiSection === 'launchmenu');
const probeResults = ref<Record<string, boolean>>({});

async function probeMenuAddons(): Promise<void> {
  const v = selected.value;
  if (!v) {
    probeResults.value = {};
    return;
  }
  const next = { ...probeResults.value };
  for (const def of menuAddonDefs) {
    if (!def.probeClass) continue;
    const res = await bridge.probeVersionClass(v.id, def.probeClass);
    next[def.id] = res.ok ? res.value : false;
  }
  probeResults.value = next;
}

function onMenuToggle(): void {
  menuOpen.value = !menuOpen.value;
  if (menuOpen.value) void probeMenuAddons();
}

/**
 * 启动编排：accountId = 当前账户（契约可选字段，缺省回落宿主首个账户）；
 * test=true 走测试启动（宿主落盘启动前后日志）；成功后唤起独立控制台窗（v1 语义）——
 * 普通启动受全局开关 consoleOnLaunch（缺省开）约束；测试启动属显式诊断，恒弹。
 * visualizer=true = 一次性带 -Dlf.visualizer 启动（「≡」菜单动作项，不写档案）。
 */
async function doLaunch(test: boolean, visualizer = false): Promise<void> {
  const v = selected.value;
  if (!v) return;
  menuOpen.value = false;
  resetDownloads();
  const ok = await launch({
    versionId: v.id,
    // 激活实例（Play 左侧实例 dock 选择；未初始化时留空 = 宿主按契约回落 default instance）
    instanceId: activeName.value || undefined,
    accountId: current.value?.id,
    javaPath: settings.value.javaPath,
    maxMemoryMb: settings.value.maxMemoryMb,
    ...(test ? { testLaunch: true } : {}),
    ...(visualizer ? { visualizer: true } : {}),
  });
  if (ok && (test || settings.value.consoleOnLaunch !== false)) void bridge.openConsoleWindow();
}

function onToggle(): void {
  if (running.value) kill();
  else void doLaunch(false);
}

function onTestLaunch(): void {
  void doLaunch(true);
}

function onVisualizerLaunch(): void {
  void doLaunch(false, true);
}

function onInstanceSettings(): void {
  menuOpen.value = false;
  emit('open-instances');
}

/** 速率文本（MB/s，一位小数）。 */
function mb(bytes: number): string {
  return (bytes / 1048576).toFixed(1);
}
</script>

<template>
  <section class="panel">
    <p v-if="lastError" class="error">{{ t('launch.failed') }}：{{ lastError }}</p>
    <p v-else-if="status.lastError" class="error">{{ status.lastError }}</p>

    <!-- 聚合下载进度（BlockHelm 配方）：阶段文案 + 细进度条 + 速率；失败显式红态常驻 -->
    <div v-if="showProgress" class="progress" :class="{ 'progress--failed': failed !== null }">
      <div class="progress-top">
        <span class="progress-stage">
          {{ failed ? t('launch.downloadFailed') : stage ? t(`launch.stage.${stage}`) : '' }}
        </span>
        <span v-if="!failed && rateBps" class="progress-rate">{{ mb(rateBps) }} MB/s</span>
        <span v-else-if="!failed" class="progress-pct">{{ percent }}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: percent + '%' }"></div>
      </div>
      <p v-if="failed" class="progress-err">{{ failed.id }}：{{ failed.error }}</p>
    </div>

    <!-- 动作行：Play+菜单沉底靠右；实例 dock（用户指定）置于 Play 左侧，
         与版本 dock 同款交互，展开向上浮出、不吃布局空间。
         版本 dock 也在此行（margin-right:auto 钉左缘）：两 dock 同 flex 流互斥收缩，
         窄窗下不再重叠（曾因 stage-dock 绝对定位与实例 dock 互不感知而压盖）。 -->
    <div class="actions">
      <VersionSelector class="dock-version" />
      <InstanceDock class="dock-instance" />
      <button
        class="play"
        :class="{ 'play--stop': running }"
        :disabled="!canToggle"
        :title="playHint || undefined"
        @click="onToggle"
      >
        <span v-if="running" class="sq" aria-hidden="true"></span>
        <span v-else class="tri" aria-hidden="true"></span>
        {{ running ? t('launch.kill') : t('launch.play') }}
      </button>
      <div ref="menuEl" class="menu-wrap">
        <span class="divider" aria-hidden="true"></span>
        <button
          class="menu-btn"
          type="button"
          :aria-label="t('launch.menu')"
          :title="t('launch.menu')"
          :aria-expanded="menuOpen"
          @click="onMenuToggle"
        >
          <!-- lucide: align-left（≡） -->
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M15 12H3" />
            <path d="M17 6H3" />
            <path d="M21 18H3" />
          </svg>
        </button>
        <div v-if="menuOpen" class="menu-pop" role="menu">
          <button class="menu-item" type="button" role="menuitem" @click="onInstanceSettings">
            {{ t('launch.instanceSettings') }}
          </button>
          <button
            class="menu-item"
            type="button"
            role="menuitem"
            :disabled="!canPlay"
            @click="onTestLaunch"
          >
            {{ t('launch.testLaunch') }}
          </button>
          <!-- addon 动作项（目录驱动）：jar 探测不含 probeClass 或不可启动 = 禁用；点击 = 一次性带 -Dlf.visualizer 启动 -->
          <button
            v-for="def in menuAddonDefs"
            :key="def.id"
            class="menu-item"
            type="button"
            role="menuitem"
            :disabled="!canPlay || !probeResults[def.id]"
            :title="probeResults[def.id] ? t(`instance.addonList.${def.id}.desc`) : t('launch.visualizerOff')"
            @click="onVisualizerLaunch"
          >
            {{ t('launch.visualizerLaunch') }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 净空容器（用户指定）：无卡片底/描边/投影，为后续背景图留清晰画布 */
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  flex: 1;
  min-height: 0;
  background: transparent;
}
/* 动作行：版本 dock 钉左缘，Play+菜单沉底靠右 */
.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
  margin-top: auto;
}
/* 版本 dock 推至行首左缘；两 dock 允许收缩到内容以下（内部 name 有 ellipsis 配方接住），
   窄窗时横向让位而不是互相压盖 */
.dock-version {
  margin-right: auto;
}
.dock-version,
.dock-instance {
  min-width: 0;
}
.play,
.menu-wrap {
  flex-shrink: 0;
}
/* Play —— 质感配方样板：pill 大圆角 + 五层叠影 + 顶部内高光 + hover 抬升 + active 下压 + focus 投影环（token 定义见 tokens.css） */
.play {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-6);
  background: var(--accent);
  color: var(--accent-ink);
  border: none;
  border-radius: var(--radius-pill);
  font-weight: 600;
  font-size: var(--fs-md);
  box-shadow: var(--btn-primary-shadow);
  transition:
    transform var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}
.play:hover:not(:disabled) {
  background: var(--accent-hover);
  transform: translateY(-1px);
  box-shadow: var(--btn-primary-hover-shadow);
}
.play:active:not(:disabled) {
  background: var(--accent-press);
  transform: translateY(0) scale(0.97);
  box-shadow: var(--btn-primary-active-shadow);
}
/* 投影式 focus 环（替代全局描边式，Modrinth ring-4 手法）；置后保证 hover 下环不被覆盖 */
.play:focus-visible {
  outline: none;
  box-shadow: var(--btn-primary-focus-shadow);
}
.play:disabled {
  opacity: 0.5;
  filter: grayscale(50%);
  box-shadow: none;
  cursor: not-allowed;
}
.tri {
  width: 0;
  height: 0;
  border-left: 8px solid var(--accent-ink);
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
}
/* 运行态：同一按钮切为停止（danger 底 + 方块图标），保持同一质感配方 */
.play--stop {
  background: var(--danger);
}
.play--stop:hover:not(:disabled) {
  background: var(--danger);
}
.sq {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: var(--accent-ink);
}
.error {
  font-size: var(--fs-sm);
  color: var(--danger);
}
/* —— 聚合下载进度（BlockHelm 配方：阶段文案 + 220×5 细进度条 + 速率；与动作行同侧右对齐） —— */
.progress {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-2);
}
.progress-top {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
}
.progress-stage {
  font-size: var(--fs-sm);
  color: var(--text-secondary);
}
.progress-rate,
.progress-pct {
  font-size: var(--fs-xs);
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}
.progress-bar {
  width: 220px;
  height: 5px;
  background: var(--surface-1);
  border-radius: var(--radius-pill);
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: var(--radius-pill);
  transition: width var(--dur-base) var(--ease-out);
}
.progress-err {
  max-width: 220px;
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--danger);
  text-align: right;
  overflow-wrap: anywhere;
}
.progress--failed .progress-stage {
  color: var(--danger);
}
.progress--failed .progress-fill {
  background: var(--danger);
}
/* —— 「| ≡」：竖分隔线 + 幽灵菜单钮；弹层向上右对齐（Play 在右下角，菜单在其右侧） —— */
.menu-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.divider {
  width: 1px;
  height: var(--space-5);
  background: var(--border-strong);
}
.menu-btn {
  width: var(--rail-item-size);
  height: var(--rail-item-size);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}
.menu-btn:hover {
  background: var(--surface-4);
  color: var(--text-primary);
}
.menu-pop {
  position: absolute;
  right: 0;
  bottom: calc(100% + var(--space-2));
  min-width: 160px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-2);
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-3);
  z-index: 20;
}
.menu-item {
  padding: var(--space-2) var(--space-3);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: var(--fs-sm);
  text-align: left;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}
.menu-item:hover:not(:disabled) {
  background: var(--surface-4);
}
.menu-item:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
