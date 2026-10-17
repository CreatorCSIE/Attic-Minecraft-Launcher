<script setup lang="ts">
/**
 * 版本选择器 —— 年代分层信息架构（ui-design.md §2）。
 * 数据驱动：分组/排序全来自清单 era + 日期字段，UI 零版本判断（戒律 #1）。
 */
import { useI18n } from '../i18n';
import { useVersions } from '../composables/useVersions';
import { useSelection } from '../composables/useSelection';
import type { VersionEra } from '@attic/core-spec';

const { t } = useI18n();
const { search, groups, loading, error, total, load } = useVersions();
const { selectedId, select } = useSelection();

function fmtDate(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function eraKey(era: VersionEra | 'unknown'): string {
  return era;
}
</script>

<template>
  <section class="selector">
    <div class="head">
      <span class="label">{{ t('nav.launch') }}</span>
      <span class="count tabular">{{ t('version.count', { n: total }) }}</span>
    </div>

    <input
      v-model="search"
      class="search"
      type="search"
      :placeholder="t('common.search')"
      :aria-label="t('common.search')"
    />

    <div v-if="loading" class="skeleton" aria-hidden="true">
      <div v-for="n in 6" :key="n" class="sk-row"></div>
    </div>

    <div v-else-if="error" class="state state--error">
      <p class="state-msg">{{ t('common.error') }}：{{ error }}</p>
      <button class="ghost" @click="load()">{{ t('common.retry') }}</button>
    </div>

    <div v-else-if="groups.length === 0" class="state">
      <p class="state-msg">{{ t('version.empty') }}</p>
      <p class="state-hint">{{ t('version.emptyHint') }}</p>
    </div>

    <div v-else class="list">
      <div v-for="g in groups" :key="g.era" class="group">
        <div class="group-head">
          <span class="chip" :data-era="g.era">{{ t(`era.${eraKey(g.era)}`) }}</span>
          <span class="group-count tabular">{{ g.items.length }}</span>
        </div>
        <button
          v-for="v in g.items"
          :key="v.id"
          class="row"
          :class="{ 'row--active': selectedId === v.id }"
          @click="select(v.id)"
        >
          <span class="ver mono">{{ v.id }}</span>
          <span v-if="v.displayName" class="alias">{{ v.displayName }}</span>
          <span class="spacer"></span>
          <span v-if="v.installed" class="badge badge--ok">{{ t('version.installed') }}</span>
          <span v-if="fmtDate(v.compileDate ?? v.releaseDate)" class="date tabular">
            {{ fmtDate(v.compileDate ?? v.releaseDate) }}
          </span>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.selector {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: 0;
  height: 100%;
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
/* 分区标题：fs-lg 加粗（微标签形态保留给组内小标签） */
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
/* 搜索框：inset 质感（第3级底 + 底缘内阴影 + 无边框），focus accent 投影环 */
.search {
  padding: var(--space-3) var(--space-4);
  background: var(--surface-3);
  border: none;
  border-radius: var(--radius-md);
  color: var(--text-primary);
  box-shadow: var(--input-inset);
  transition: background-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
}
.search:hover {
  background: var(--surface-4);
}
.search:focus-visible {
  outline: none;
  box-shadow: var(--input-focus-shadow);
}
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding-right: var(--space-1);
}
/* 版本分组 = base-card 统一配方：第3级底 + 第4级 surface 描边 + 大圆角 + 单层弱投影 */
.group {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-4);
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}
.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-1) var(--space-2);
}
.group-count {
  font-size: var(--fs-xs);
  color: var(--text-muted);
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
.row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  text-align: left;
  transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
}
.row:hover {
  background: var(--surface-4);
}
.row--active {
  background: var(--accent-soft);
  border-color: var(--accent);
}
.ver {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  color: var(--text-primary);
}
.alias {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
}
.spacer {
  flex: 1;
}
.badge {
  font-size: var(--fs-xs);
  padding: 1px var(--space-2);
  border-radius: var(--radius-sm);
}
.badge--ok {
  color: var(--ok);
  background: var(--ok-soft);
}
.date {
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
/* 空态/错误态：同套 base-card 配方 */
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-6) var(--space-5);
  text-align: center;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}
.state-msg {
  color: var(--text-secondary);
}
.state--error .state-msg {
  color: var(--danger);
}
.state-hint {
  font-size: var(--fs-sm);
  color: var(--text-muted);
}
.ghost {
  padding: var(--space-2) var(--space-4);
  background: transparent;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  box-shadow: var(--inset-bottom);
  transition: background var(--dur-fast) var(--ease-out);
}
.ghost:hover {
  background: var(--surface-4);
}
.skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.sk-row {
  height: 32px;
  border-radius: var(--radius-md);
  background: var(--surface-3);
  animation: shimmer 1.2s var(--ease-in) infinite;
}
@keyframes shimmer {
  0% { opacity: 0.5; }
  50% { opacity: 1; }
  100% { opacity: 0.5; }
}
</style>
