<script setup lang="ts">
/**
 * 首启欢迎向导（Phase 5 A 期定稿）：三步 stepper 模态「目录 → 账户 → Java」，安装版/portable 通用。
 * 三重门判定（任一不满足即不弹，误弹方向保守）：无 wizardDone ∧ 无 rootOverride ∧ 默认根无既有数据；
 * sysinfo 取不到（缺桥/读失败）= 永不弹。判定只发生一次（decided 闩），会话内不因数据回流复弹。
 * 目录步骤 = 消解式两选项（默认根 / 自定义）——安装版没有"exe 旁本地目录"分支；
 * 手选撞进安装目录由宿主 setSettings 护栏拒绝，拒绝原文（实际动作+出路）直陈错误行。
 * 账户/Java 步骤 = 既有通道纯编排（accounts:add / detectJava 全候选 / settings.javaPath），零新 IPC。
 * 完成与跳过皆写 wizardDone（"已见过向导"语义收敛于此键，与指针职责分离）。
 * 视觉纪律（ui-design §2/§6/§7）：每屏恰一 accent（下一步/开始游戏实心）、stepper 顶置、
 * 五态齐全、动效走 AppDialog 既有 200ms 律。
 */
import { ref, watch } from 'vue';
import AppDialog from './AppDialog.vue';
import { useI18n } from '../i18n';
import { useSettings } from '../composables/useSettings';
import { useSysInfo } from '../composables/useSysInfo';
import { useAccounts } from '../composables/useAccounts';
import { useJava } from '../composables/useJava';
import { useBridge } from '../composables/useBridge';

const { t } = useI18n();
const { settings, loaded, patchDetailed } = useSettings();
const { info } = useSysInfo();
const { accounts, add: addAccount, error: accountsError } = useAccounts();
const { report: javaReport, loading: javaLoading, detect: detectJava } = useJava();
const { bridge } = useBridge();

// —— 三重门：两个数据源（settings 视图 + sysinfo 快照）都就绪才判一次 ——
const visible = ref(false);
let decided = false;
watch(
  [loaded, () => info.value],
  ([l, i]) => {
    if (decided) return;
    if (!l || !i) return;
    decided = true;
    visible.value = !settings.value.wizardDone && !settings.value.rootOverride && !i.defaultRootPopulated;
  },
  { immediate: true },
);

const step = ref(0);
const err = ref<string | null>(null);
const busy = ref(false);

// —— 步骤 1：目录（消解式两选项；默认 = 不写 rootOverride，零键即默认根）——
const dirChoice = ref<'default' | 'custom'>('default');
const customPath = ref('');
async function pickDir(): Promise<void> {
  err.value = null;
  const res = await bridge.pickDirectory();
  if (!res.ok) {
    err.value = res.error;
    return;
  }
  if (res.value) customPath.value = res.value; // 取消 = 不动
}

// —— 步骤 2：账户（已有则纯展示；空则一个输入框，留空 = 跳过本步）——
const newName = ref('');

// —— 步骤 3：Java（进步即探测；手动覆盖可选，继续自动 = 不写 javaPath）——
const manualJava = ref(settings.value.javaPath ?? '');
watch(step, (s) => {
  if (s === 2 && !javaReport.value && !javaLoading.value) void detectJava();
});
async function pickJava(): Promise<void> {
  err.value = null;
  const res = await bridge.pickJavaExecutable();
  if (!res.ok) {
    err.value = res.error;
    return;
  }
  if (res.value) manualJava.value = res.value;
}

const javaCandidateCount = () => (javaReport.value ? javaReport.value.installs.length + javaReport.value.failures.length : 0);

/** 下一步 / 完成；返回 false 拦在当步（错误行已就位）。 */
async function next(): Promise<void> {
  err.value = null;
  busy.value = true;
  try {
    if (step.value === 0) {
      if (dirChoice.value === 'custom') {
        if (!customPath.value) {
          err.value = t('wizard.dirPick');
          return;
        }
        const r = await patchDetailed({ rootOverride: customPath.value });
        if (!r.ok) {
          err.value = r.error ?? null;
          return;
        }
      }
    } else if (step.value === 1) {
      const name = newName.value.trim();
      if (name) {
        const ok = await addAccount(name);
        if (!ok) {
          err.value = accountsError.value ?? 'add account failed';
          return;
        }
      }
    } else {
      // 完成：wizardDone 与 Java 手动覆盖一并落（undefined = 键不动/清除语义由合并映射处理）
      const r = await patchDetailed({ wizardDone: true, javaPath: manualJava.value || undefined });
      if (!r.ok) {
        err.value = r.error ?? null;
        return;
      }
      visible.value = false;
      return;
    }
    step.value += 1;
  } finally {
    busy.value = false;
  }
}

/** 跳过 = 用默认，同样写 wizardDone（防"跳过不标记 → 反复弹"，定稿修正点）。 */
async function skip(): Promise<void> {
  err.value = null;
  busy.value = true;
  try {
    const r = await patchDetailed({ wizardDone: true });
    if (!r.ok) {
      err.value = r.error ?? null;
      return;
    }
    visible.value = false;
  } finally {
    busy.value = false;
  }
}

function back(): void {
  err.value = null;
  if (step.value > 0) step.value -= 1;
}

/** stepper 三标签（静态键，t 不做动态拼接）。 */
const STEP_KEYS = ['wizard.stepDir', 'wizard.stepAccounts', 'wizard.stepJava'] as const;
</script>

<template>
  <AppDialog :open="visible">
    <!-- 不绑定 close：Esc/遮罩点击不关向导（出路只有「跳过」与「完成」两个显式按钮，状态完备性） -->
    <header class="head">
      <h2 class="title">{{ t('wizard.title') }}</h2>
      <p class="sub">{{ t('wizard.subtitle') }}</p>
      <ol class="stepper" :aria-label="t('wizard.stepOf', { n: step + 1 })">
        <li
          v-for="(k, i) in STEP_KEYS"
          :key="k"
          class="stepper-item"
          :class="{ 'stepper-item--on': i === step, 'stepper-item--done': i < step }"
        >
          <span class="stepper-dot">{{ i < step ? '✓' : i + 1 }}</span>
          <span class="stepper-label">{{ t(k) }}</span>
        </li>
      </ol>
    </header>

    <!-- 步骤 1：数据目录 -->
    <section v-if="step === 0" class="body">
      <button class="opt" :class="{ 'opt--on': dirChoice === 'default' }" type="button" @click="dirChoice = 'default'">
        <span class="opt-title">{{ t('wizard.dirDefaultTitle') }}</span>
        <span class="opt-path mono">{{ info?.defaultRoot }}</span>
        <span class="opt-hint">{{ t('wizard.dirDefaultHint') }}</span>
      </button>
      <button class="opt" :class="{ 'opt--on': dirChoice === 'custom' }" type="button" @click="dirChoice = 'custom'">
        <span class="opt-title">{{ t('wizard.dirCustomTitle') }}</span>
        <span class="opt-path mono">{{ customPath || '—' }}</span>
        <span class="opt-hint">{{ t('wizard.dirCustomHint') }}</span>
      </button>
      <div v-if="dirChoice === 'custom'" class="row">
        <button class="btn btn--ghost" type="button" @click="pickDir">{{ t('wizard.dirPick') }}</button>
        <p v-if="customPath" class="pending">{{ t('wizard.dirPending', { path: customPath }) }}</p>
      </div>
    </section>

    <!-- 步骤 2：账户 -->
    <section v-else-if="step === 1" class="body">
      <template v-if="accounts.length > 0">
        <p class="hint">{{ t('wizard.accountsHave') }}</p>
        <ul class="acc-list">
          <li v-for="a in accounts" :key="a.id" class="acc-item">
            <span class="acc-name">{{ a.name }}</span>
            <span class="acc-type muted">{{ a.type === 'offline' ? t('account.typeOffline') : t('account.typeMicrosoft') }}</span>
          </li>
        </ul>
      </template>
      <p v-else class="hint">{{ t('wizard.accountsEmpty') }}</p>
      <input
        v-model="newName"
        class="input"
        type="text"
        :placeholder="t('wizard.accountsName')"
        maxlength="16"
        spellcheck="false"
      />
      <p class="hint muted">{{ t('wizard.accountsSkipHint') }}</p>
    </section>

    <!-- 步骤 3：Java -->
    <section v-else class="body">
      <p v-if="javaLoading" class="hint muted">{{ t('wizard.javaDetecting') }}</p>
      <template v-else-if="javaReport">
        <p v-if="javaReport.selection.install" class="hint">
          {{ t('wizard.javaFound', { reason: javaReport.selection.reason }) }}
        </p>
        <p v-else class="hint warn-line">{{ t('wizard.javaNone') }}</p>
        <p v-if="javaReport.selection.install" class="mono path-line">{{ javaReport.selection.install.executable }}</p>
        <div class="row">
          <button class="btn btn--ghost" type="button" @click="pickJava">{{ t('wizard.javaManual') }}</button>
          <button v-if="manualJava" class="btn btn--ghost" type="button" @click="manualJava = ''">{{ t('wizard.javaAuto') }}</button>
        </div>
        <p v-if="manualJava" class="mono path-line">{{ t('wizard.javaManualSet', { path: manualJava }) }}</p>
        <details v-if="javaCandidateCount() > 0" class="cand">
          <summary>{{ t('wizard.javaCandidates', { count: javaCandidateCount() }) }}</summary>
          <ul>
            <li v-for="j in javaReport.installs" :key="j.executable" class="mono cand-line">{{ j.executable }} · {{ j.raw }}</li>
            <li v-for="f in javaReport.failures" :key="f.executable" class="mono cand-line muted">{{ f.executable }} · {{ f.reason }}</li>
          </ul>
        </details>
      </template>
    </section>

    <p v-if="err" class="err" role="alert">{{ err }}</p>

    <footer class="foot">
      <button class="btn btn--text" type="button" :disabled="busy" @click="skip">{{ t('wizard.skip') }}</button>
      <span class="spacer"></span>
      <button v-if="step > 0" class="btn btn--ghost" type="button" :disabled="busy" @click="back">{{ t('wizard.back') }}</button>
      <!-- 每屏唯一 accent 实心元素（§2） -->
      <button class="btn btn--accent" type="button" :disabled="busy" @click="next">
        {{ step === 2 ? t('wizard.finish') : t('wizard.next') }}
      </button>
    </footer>
  </AppDialog>
</template>

<style scoped>
.head {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.title {
  margin: 0;
  font-size: var(--fs-xl);
  line-height: 1.2;
}
.sub {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--text-secondary);
}
.stepper {
  display: flex;
  gap: var(--space-4);
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: 0;
}
.stepper-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-xs);
  letter-spacing: 0.06em;
  color: var(--text-muted);
}
.stepper-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  font-variant-numeric: tabular-nums;
}
.stepper-item--on {
  color: var(--text-primary);
}
.stepper-item--on .stepper-dot {
  border-color: var(--accent);
  color: var(--accent);
}
.stepper-item--done .stepper-dot {
  border-color: var(--ok);
  color: var(--ok);
}
.body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.opt {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4);
  text-align: left;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out);
}
.opt:hover {
  background: var(--surface-3);
}
.opt--on {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.opt-title {
  font-size: var(--fs-md);
  color: var(--text-primary);
}
.opt-path {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.opt-hint {
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
.row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.hint {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--text-secondary);
}
.muted {
  color: var(--text-muted);
}
.warn-line {
  color: var(--warn);
}
.pending {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--warn);
}
.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.path-line {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  word-break: break-all;
}
.acc-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.acc-item {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
}
.acc-type {
  font-size: var(--fs-xs);
}
.input {
  padding: var(--space-2) var(--space-3);
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: var(--fs-md);
}
.cand {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
}
.cand-line {
  word-break: break-all;
}
.err {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-sm);
  color: var(--danger);
  background: var(--danger-soft);
  border-radius: var(--radius-sm);
}
.foot {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.spacer {
  flex: 1;
}
.btn {
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  font-size: var(--fs-md);
  cursor: pointer;
  border: 1px solid transparent;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}
.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.btn--accent {
  background: var(--accent);
  color: var(--accent-ink);
  font-weight: 600;
}
.btn--accent:not(:disabled):hover {
  background: var(--accent-hover);
}
.btn--accent:not(:disabled):active {
  background: var(--accent-press);
  transform: scale(0.97);
}
.btn--ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--text-secondary);
}
.btn--ghost:hover {
  background: var(--surface-3);
  color: var(--text-primary);
}
.btn--text {
  background: transparent;
  color: var(--text-muted);
  padding-inline: var(--space-2);
}
.btn--text:hover {
  color: var(--text-primary);
}
</style>
