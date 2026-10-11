/**
 * useGame —— 启动状态机（launch/kill/status/dryRun）。
 * 错误以数据返回（IpcResult），UI 不抛异常；launch 后刷新 status。
 */

import { ref } from 'vue';
import type { GameStatus, LaunchConfig, LaunchRequest } from '@attic/core-spec';
import { useBridge } from './useBridge';

const status = ref<GameStatus>({ running: false, session: null, lastExit: null, lastError: null });
const busy = ref(false);
const lastError = ref<string | null>(null);
const dryRun = ref<LaunchConfig | null>(null);

const { bridge } = useBridge();

async function refresh(): Promise<void> {
  const res = await bridge.status();
  if (res.ok) status.value = res.value;
  else if (res.error !== 'no-bridge') lastError.value = res.error;
}

async function launch(req: LaunchRequest): Promise<boolean> {
  busy.value = true;
  lastError.value = null;
  const res = await bridge.launch(req);
  if (!res.ok) lastError.value = res.error;
  await refresh();
  busy.value = false;
  return res.ok;
}

async function kill(): Promise<boolean> {
  busy.value = true;
  const res = await bridge.kill();
  if (!res.ok) lastError.value = res.error;
  await refresh();
  busy.value = false;
  return res.ok;
}

async function doDryRun(req: LaunchRequest): Promise<boolean> {
  const res = await bridge.dryRunLaunch(req);
  if (res.ok) dryRun.value = res.value;
  else lastError.value = res.error;
  return res.ok;
}

export function useGame() {
  void refresh();
  return { status, busy, lastError, dryRun, refresh, launch, kill, doDryRun };
}
