<script setup lang="ts">
/**
 * 控制台 —— stdout/stderr 滚动 + 崩溃摘要卡 + 下载进度（数字必带，§7 加载有数）。
 * 订阅在 useConsole 模块级，切视图不丢日志。
 */
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from '../i18n';
import { useConsole } from '../composables/useConsole';
import type { DownloadProgressEvent } from '@attic/core-spec';

const { t } = useI18n();
const { lines, lastExit, downloads, clear } = useConsole();

const autoscroll = ref(true);
const scroller = ref<HTMLElement | null>(null);

const downloadList = computed<DownloadProgressEvent[]>(() => Object.values(downloads.value));

const crash = computed(() => lastExit.value?.crash ?? null);

function mb(bytes: number): string {
  return (bytes / 1048576).toFixed(1);
}

function pct(e: DownloadProgressEvent): number {
  if (!e.bytesTotal) return 0;
  return Math.min(100, Math.round((e.bytesDone / e.bytesTotal) * 100));
}

watch(
  () => lines.value.length,
  async () => {
    if (!autoscroll.value) return;
    await nextTick();
    const el = scroller.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
);
</script>

<template>
  <section class="console">
    <div class="bar">
      <span class="label">{{ t('console.title') }}</span>
      <div class="bar-actions">
        <label class="toggle">
          <input v-model="autoscroll" type="checkbox" />
          {{ t('console.autoscroll') }}
        </label>
        <button class="mini" @click="clear">{{ t('console.clear') }}</button>
      </div>
    </div>

    <div v-if="crash" class="crash">
      <span class="crash-cat">{{ t(`crash.${crash.category}`) }}</span>
      <span class="crash-head mono">{{ crash.headline }}</span>
    </div>

    <div v-if="downloadList.length" class="downloads">
      <div class="label">{{ t('console.download') }}</div>
      <div v-for="e in downloadList" :key="`${e.item}:${e.id}`" class="dl">
        <div class="dl-top">
          <span class="dl-id mono">{{ e.id }}</span>
          <span class="dl-phase" :data-phase="e.phase">{{ e.phase }}</span>
          <span v-if="e.bytesPerSec" class="dl-rate tabular">{{ mb(e.bytesPerSec) }} MB/s</span>
        </div>
        <div class="dl-bar">
          <div class="dl-fill" :class="`dl-fill--${e.phase}`" :style="{ width: pct(e) + '%' }"></div>
        </div>
        <div v-if="e.error" class="dl-err">{{ e.error }}</div>
      </div>
    </div>

    <div ref="scroller" class="out">
      <p v-if="lines.length === 0" class="empty">{{ t('console.empty') }}</p>
      <pre
        v-for="l in lines"
        :key="l.seq"
        class="line"
        :class="l.stream === 'stderr' ? 'line--err' : 'line--out'"
        >{{ l.text }}</pre>
    </div>
  </section>
</template>

<style scoped>
/* base-card 统一配方：第3级底 + 第4级 surface 描边 + radius-lg + 弱投影 + padding 升档 */
.console {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: 0;
  height: 100%;
  padding: var(--space-5);
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.bar .label {
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: 0;
  text-transform: none;
}
.bar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--fs-xs);
  color: var(--text-secondary);
}
.mini {
  padding: 2px var(--space-2);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  transition: background var(--dur-fast) var(--ease-out);
}
.mini:hover {
  background: var(--surface-4);
}
.crash {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  background: var(--danger-soft);
  border: 1px solid var(--danger);
  border-radius: var(--radius-md);
}
.crash-cat {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--danger);
}
.crash-head {
  font-size: var(--fs-xs);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.downloads {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.dl {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dl-top {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-xs);
}
.dl-id {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dl-phase {
  margin-left: auto;
  color: var(--text-muted);
}
.dl-phase[data-phase='failed'] {
  color: var(--danger);
}
.dl-phase[data-phase='done'] {
  color: var(--ok);
}
.dl-rate {
  color: var(--accent);
}
.dl-bar {
  height: 4px;
  background: var(--surface-1);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.dl-fill {
  height: 100%;
  background: var(--accent);
  transition: width var(--dur-base) var(--ease-out);
}
.dl-fill--done {
  background: var(--ok);
}
.dl-fill--failed {
  background: var(--danger);
}
.dl-err {
  font-size: var(--fs-xs);
  color: var(--danger);
}
/* 日志输出区 = 卡片上的下沉井：第1级底 + 底缘内阴影 */
.out {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-3);
  background: var(--surface-1);
  border-radius: var(--radius-md);
  box-shadow: var(--input-inset);
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  line-height: 1.45;
}
.empty {
  color: var(--text-muted);
  font-family: var(--font-sans);
}
.line {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.line--out {
  color: var(--text-secondary);
}
.line--err {
  color: var(--danger);
}
</style>
