/**
 * useCustomVersions —— 自定义版本配置页共享状态（左列表 + 右 info 编辑器）。
 * 数据面走契约（CustomVersionView/CustomInfoView）；模块级单例：切视图不重复拉取（对齐 useAccounts 范式）。
 */

import { computed, ref, type ComputedRef } from 'vue';
import { IPC_EVENTS, type CustomInfoView, type CustomVersionView } from '@attic/core-spec';
import { useBridge } from './useBridge';
import { useInstances } from './useInstances';
import { useMods } from './useMods';
import { useVersions } from './useVersions';

const versions = ref<CustomVersionView[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const selectedId = ref<string | null>(null);
const detail = ref<CustomInfoView | null>(null);
const detailLoading = ref(false);
const saving = ref(false);
const saveError = ref<string | null>(null);
/** 外部冲突信号：选中项的 .info 被外部改动、而表单存在未保存编辑（面板消费：提示 + 手动重载）。 */
const externalChanged = ref(false);

let started = false;

const { bridge } = useBridge();

// —— 外部编辑 .info → 启动器侧实时更新（宿主 jsons 目录监视 → CUSTOM_INFO_CHANGED 事件） ——
// 模块级持久订阅（对齐 useGame 退出事件范式）：切视图/面板卸载重建不丢订阅。

/** 本方写入（保存/删除）时间戳：吸收监视器回声——保存自触发的事件不得覆盖用户随后的新编辑。 */
const selfWrites = new Map<string, number>();
const ECHO_WINDOW_MS = 2000;
let dirtyProbe: (() => boolean) | null = null;

/** 面板注册脏态探针（表单是否存在未保存编辑）；面板卸载时置 null。 */
function setDirtyProbe(fn: (() => boolean) | null): void {
  dirtyProbe = fn;
}

async function onInfoChanged(id: string): Promise<void> {
  const t0 = selfWrites.get(id);
  if (t0 !== undefined && Date.now() - t0 < ECHO_WINDOW_MS) return; // 本方写入回声
  await load(); // 徽标/存在性即时更新（外部新建或删除 .info 同样到达这里）
  if (selectedId.value !== id) return;
  if (!versions.value.some((v) => v.id === id)) {
    // 版本被外部整体移除（jar+info 同失）：详情与选中态失效
    selectedId.value = null;
    detail.value = null;
    return;
  }
  if (dirtyProbe && dirtyProbe()) {
    externalChanged.value = true; // 有未保存编辑：保住表单，面板出提示供用户决定是否重载
  } else {
    await select(id); // 无未保存编辑：表单实时刷新到磁盘最新内容
  }
}

const selected: ComputedRef<CustomVersionView | null> = computed(
  () => versions.value.find((v) => v.id === selectedId.value) ?? null,
);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  const res = await bridge.listCustomVersions();
  if (res.ok) versions.value = res.value;
  else error.value = res.error;
  loading.value = false;
}

/** 选中版本 → 拉取其 .info 详情（未配置裸 jar 时宿主附检测建议）。 */
async function select(id: string): Promise<void> {
  selectedId.value = id;
  saveError.value = null;
  externalChanged.value = false; // 重新载入 = 冲突提示复位（基线=磁盘最新）
  detail.value = null;
  detailLoading.value = true;
  const res = await bridge.getCustomVersionInfo(id);
  detailLoading.value = false;
  if (res.ok) detail.value = res.value;
  else saveError.value = res.error;
}

/** 保存 info；成功后刷新列表（徽标复位）并重载详情。返回是否成功。 */
async function save(id: string, props: Record<string, string>): Promise<boolean> {
  saving.value = true;
  saveError.value = null;
  selfWrites.set(id, Date.now()); // 标记本方写入：吸收随后到来的监视器回声
  // 浅拷贝脱去 Vue reactive Proxy：结构化克隆无法序列化 Proxy（"could not be cloned" 根因）；值全为字符串，浅拷贝足够。
  const res = await bridge.saveCustomVersionInfo(id, { ...props });
  saving.value = false;
  if (!res.ok) {
    saveError.value = res.error;
    return false;
  }
  await load();
  await select(id);
  // 保存可能翻转裸 jar 的 custom 态 → 联动刷新启动页版本列表（useVersions 单例不自动重拉）。
  await useVersions().load();
  return true;
}

/** 导入 jar（宿主弹文件对话框）；取消=无操作，成功=刷新列表并选中新项。 */
async function importJar(): Promise<void> {
  saveError.value = null;
  const res = await bridge.importCustomJar();
  if (!res.ok) {
    saveError.value = res.error;
    return;
  }
  if (res.value === null) return; // 用户取消
  await load();
  await select(res.value.id);
  // 新裸 jar 须立刻进入启动页版本列表（Other 组）→ 联动刷新。
  await useVersions().load();
}

/** 删除自定义版本（jar+.info 一并移除，UI 侧已经确认弹窗把关）。成功刷新相关页列表。 */
async function remove(id: string): Promise<boolean> {
  saveError.value = null;
  // mod 判定须在重拉列表前取（删除后该项已不在列表）
  const wasMod = versions.value.some((v) => v.id === id && v.mod === true);
  selfWrites.set(id, Date.now()); // 删除同样触发监视器回声
  const res = await bridge.removeCustomVersion(id);
  if (!res.ok) {
    saveError.value = res.error;
    return false;
  }
  if (selectedId.value === id) {
    selectedId.value = null;
    detail.value = null;
  }
  await load();
  // 启动页版本列表同步失去该项 → 联动刷新。
  await useVersions().load();
  // 宿主删除时已把指向该版本的实例档案 version 清空（悬空指针联动清理）→ 实例清单/dock 须重拉才可见。
  await useInstances().load();
  // mod 卸载 = Mods 页 installed 真相源（.info 实存）已在宿主侧翻转 → 联动重拉徽标。
  if (wasMod) await useMods().load();
  return true;
}

function ensureLoaded(): void {
  if (started) return;
  started = true;
  // 持久订阅外部改动事件（mock 桥的 on() 为空操作，浏览器形态自然降级为手动刷新）。
  bridge.on(IPC_EVENTS.CUSTOM_INFO_CHANGED, (payload) => void onInfoChanged(payload.id));
  void load();
}

export function useCustomVersions() {
  ensureLoaded();
  return {
    versions,
    selected,
    selectedId,
    detail,
    loading,
    detailLoading,
    error,
    saving,
    saveError,
    externalChanged,
    load,
    select,
    save,
    remove,
    importJar,
    setDirtyProbe,
  };
}
