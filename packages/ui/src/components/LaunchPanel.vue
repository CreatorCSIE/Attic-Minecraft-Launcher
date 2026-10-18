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
import { useI18n } from '../i18n';
import { useSelection } from '../composables/useSelection';
import { useGame } from '../composables/useGame';
import { useSettings } from '../composables/useSettings';
import { useAccounts } from '../composables/useAccounts';
import { useBridge } from '../composables/useBridge';
import { useDownloads } from '../composables/useDownloads';

const emit = defineEmits<{ (e: 'open-instances'): void }>();

const { t } = useI18n();
const { selected } = useSelection();
const { status, busy, lastError, launch, kill } = useGame();
const { settings } = useSettings();
const { current } = useAccounts();
const { bridge, hasBridge } = useBridge();
const { percent, rateBps, stage, active, failed, reset: resetDownloads } = useDownloads();

const running = computed(() => status.value.running);
/* 聚合进度区可见性（BlockHelm 配方）：启动中展示；下载失败则常驻红态直到下次启动。 */
const showProgress = computed(() => active.value && (busy.value || failed.value !== null));
const canPlay = computed(() => hasBridge.value && !!selected.value && !!current.value && !running.value && !busy.value);
/* 启动/停止合为一体（用户指定）：同一按钮按状态切换动作——空闲=启动，运行=停止 */
const canToggle = computed(() => hasBridge.value && !busy.value && (running.value || !!selected.value));

// —— 「| ≡」菜单：点外部收起 ——
const menuOpen = ref(false);
const menuEl = ref<HTMLElement | null>(null);

function onDocClick(e: MouseEvent): void {
  if (!menuOpen.value) return;
  if (menuEl.value && !menuEl.value.contains(e.target as Node)) menuOpen.value = false;
}

onMounted(() => document.addEventListener('click', onDocClick, true));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick, true));

/**
 * 启动编排：accountId = 当前账户（契约可选字段，缺省回落宿主首个账户）；
 * test=true 走测试启动（宿主落盘启动前后日志）；成功后唤起独立控制台窗（v1 语义）。
 */
async function doLaunch(test: boolean): Promise<void> {
  const v = selected.value;
  if (!v) return;
  menuOpen.value = false;
  resetDownloads();
  const ok = await launch({
    versionId: v.id,
    accountId: current.value?.id,
    javaPath: settings.value.javaPath,
    maxMemoryMb: settings.value.maxMemoryMb,
    ...(test ? { testLaunch: true } : {}),
  });
  if (ok) void bridge.openConsoleWindow();
}

function onToggle(): void {
  if (running.value) kill();
  else void doLaunch(false);
}

function onTestLaunch(): void {
  void doLaunch(true);
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

    <!-- 动作行：Play+菜单沉底靠右（空闲/运行状态灯已移除——合一体按钮文案即状态） -->
    <div class="actions">
      <button
        class="play"
        :class="{ 'play--stop': running }"
        :disabled="!canToggle"
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
          @click="menuOpen = !menuOpen"
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
/* 动作行：Play+菜单沉底靠右 */
.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
  margin-top: auto;
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
