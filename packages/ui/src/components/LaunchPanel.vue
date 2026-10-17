<script setup lang="ts">
/**
 * 启动面板 —— 每屏唯一 accent 实心元素 = Play（ui-design.md §2）。
 * 请求形状全走契约（LaunchRequest），UI 不拼参数（戒律 #1）。
 */
import { computed } from 'vue';
import { useI18n } from '../i18n';
import { useSelection } from '../composables/useSelection';
import { useGame } from '../composables/useGame';
import { useSettings } from '../composables/useSettings';
import { useBridge } from '../composables/useBridge';
import type { VersionEra } from '@attic/core-spec';

const { t } = useI18n();
const { selected } = useSelection();
const { status, busy, lastError, launch, kill } = useGame();
const { settings } = useSettings();
const { hasBridge } = useBridge();

const running = computed(() => status.value.running);
const canPlay = computed(() => hasBridge.value && !!selected.value && !running.value && !busy.value);
const canStop = computed(() => hasBridge.value && running.value && !busy.value);

const memoryLabel = computed(() => `${settings.value.maxMemoryMb ?? 1024} MB`);

function eraClass(era?: VersionEra): string {
  return era ?? 'unknown';
}

async function onPlay(): Promise<void> {
  const v = selected.value;
  if (!v) return;
  await launch({
    versionId: v.id,
    javaPath: settings.value.javaPath,
    maxMemoryMb: settings.value.maxMemoryMb,
  });
}
</script>

<template>
  <section class="panel">
    <div class="summary">
      <div class="field">
        <span class="label">{{ t('launch.version') }}</span>
        <div class="value">
          <template v-if="selected">
            <span class="chip" :data-era="eraClass(selected.era)">
              {{ t(`era.${eraClass(selected.era)}`) }}
            </span>
            <span class="ver mono">{{ selected.id }}</span>
          </template>
          <span v-else class="placeholder">{{ t('launch.noVersion') }}</span>
        </div>
      </div>
      <div class="meta">
        <span class="meta-item">
          <span class="label">{{ t('launch.memory') }}</span>
          <span class="tabular mono">{{ memoryLabel }}</span>
        </span>
        <span class="meta-item">
          <span class="label">{{ t('launch.java') }}</span>
          <span class="mono">{{ settings.javaPath ? 'manual' : 'auto' }}</span>
        </span>
      </div>
    </div>

    <div class="actions">
      <button class="play" :disabled="!canPlay" @click="onPlay">
        <span class="tri" aria-hidden="true"></span>
        {{ t('launch.play') }}
      </button>
      <button class="stop" :disabled="!canStop" @click="kill()">
        {{ t('launch.kill') }}
      </button>
      <span class="status" :class="running ? 'status--run' : 'status--idle'">
        <span class="led"></span>
        {{ running ? t('launch.running') : t('launch.idle') }}
      </span>
    </div>

    <p v-if="lastError" class="error">{{ t('launch.failed') }}：{{ lastError }}</p>
    <p v-else-if="status.lastError" class="error">{{ status.lastError }}</p>
  </section>
</template>

<style scoped>
/* base-card 新配方：第3级 surface 底 + 第4级 surface 描边 + 大圆角 + 卡片内 padding 升档 */
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5);
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}
.summary {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.field .label {
  display: block;
  margin-bottom: var(--space-1);
}
.value {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.placeholder {
  color: var(--text-muted);
  font-size: var(--fs-sm);
}
.meta {
  display: flex;
  gap: var(--space-5);
}
.meta-item {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--fs-sm);
}
.ver {
  font-size: var(--fs-md);
  color: var(--text-primary);
}
.chip {
  --chip: var(--text-muted);
  --chip-soft: var(--surface-1);
  font-size: var(--fs-xs);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  padding: 2px var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--chip);
  background: var(--chip-soft);
}
.chip[data-era='pre-classic'] { --chip: var(--era-pre-classic); --chip-soft: var(--era-pre-classic-soft); }
.chip[data-era='classic'] { --chip: var(--era-classic); --chip-soft: var(--era-classic-soft); }
.chip[data-era='indev'] { --chip: var(--era-indev); --chip-soft: var(--era-indev-soft); }
.chip[data-era='infdev'] { --chip: var(--era-infdev); --chip-soft: var(--era-infdev-soft); }
.chip[data-era='alpha'] { --chip: var(--era-alpha); --chip-soft: var(--era-alpha-soft); }
.chip[data-era='beta'] { --chip: var(--era-beta); --chip-soft: var(--era-beta-soft); }
.chip[data-era='release-1.0-1.5.2'] { --chip: var(--era-release); --chip-soft: var(--era-release-soft); }
.actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
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
/* Stop —— 保持描边/幽灵样式（每屏唯一 accent 实心 = Play），仅补底缘内阴影厚度与 disabled 去影 */
.stop {
  padding: var(--space-2) var(--space-4);
  background: transparent;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  box-shadow: var(--inset-bottom);
  transition:
    background var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}
.stop:hover:not(:disabled) {
  background: var(--surface-4);
}
.stop:disabled {
  opacity: 0.4;
  box-shadow: none;
  cursor: not-allowed;
}
.status {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
  font-size: var(--fs-sm);
  color: var(--text-secondary);
}
.led {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
}
.status--run .led {
  background: var(--ok);
}
.status--idle .led {
  background: var(--text-muted);
}
.error {
  font-size: var(--fs-sm);
  color: var(--danger);
}
</style>
