/**
 * useConsole —— 订阅 game:output / game:exit。
 * 模块级持久订阅：切视图仍在收集输出（控制台不因卸载丢日志）。
 * 输出环形缓冲封顶，避免长跑内存膨胀。
 * 下载进度事件由 useDownloads 聚合层独立消费（主页启动面板），控制台不再展示逐文件明细。
 */

import { ref, type Ref } from 'vue';
import { IPC_EVENTS, type GameExitEvent } from '@attic/core-spec';
import { useBridge } from './useBridge';

export interface ConsoleLine {
  seq: number;
  stream: 'stdout' | 'stderr';
  text: string;
  ts: number;
  /** 宿主盖戳的会话内单调序号（electron backlog 去重/排序用；无桥宿主缺省）。 */
  hseq?: number;
}

const MAX_LINES = 2000;

const lines = ref<ConsoleLine[]>([]);
const lastExit: Ref<GameExitEvent | null> = ref(null);

let seq = 0;
let subscribed = false;
/** 已入账的宿主序号（实时 + backlog 共用）：backlog 补拉与实时事件重叠时去重。 */
const seenHostSeq = new Set<number>();
let backlogPulled = false;

const { bridge } = useBridge();

/**
 * 独立控制台窗的会话绑定（主进程 ?window=console&pid=<会话pid>）：
 * 每次启动新建控制台窗，窗内只收本会话输出，旧窗保留各自历史。
 * 无 pid 参数（主窗/旧链路）= 不过滤。
 */
const boundPid =
  typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('pid') : null;

function matchesSession(pid: number): boolean {
  return boundPid === null || String(pid) === boundPid;
}

function subscribe(): void {
  if (subscribed) return;
  subscribed = true;

  bridge.on(IPC_EVENTS.GAME_OUTPUT, (e) => {
    if (!matchesSession(e.pid)) return;
    // 宿主盖戳事件：与 backlog 补拉重叠的序号跳过（backlog 先到则实时重复丢弃，反之亦然）。
    if (e.seq !== undefined) {
      if (seenHostSeq.has(e.seq)) return;
      seenHostSeq.add(e.seq);
    }
    lines.value.push({ seq: seq++, stream: e.stream, text: e.chunk, ts: Date.now(), hseq: e.seq });
    if (lines.value.length > MAX_LINES) {
      lines.value.splice(0, lines.value.length - MAX_LINES);
    }
  });

  bridge.on(IPC_EVENTS.GAME_EXIT, (e) => {
    if (!matchesSession(e.pid)) return;
    lastExit.value = e;
  });
}

/**
 * backlog 补拉（丢首批日志的竞态修复，宿主 GAME_BACKLOG 通道）：
 * 独立控制台窗挂载订阅时，spawn 瞬间的早期输出（LegacyFix premain 等）已广播完毕——
 * 订阅后按 pid 补拉一次，按宿主序号去重、有序插回，顺带恢复已错过的退出事件。
 * 宿主未实现（错误返回）= 静默降级为纯实时流（旧行为）。
 */
async function pullBacklog(): Promise<void> {
  if (boundPid === null) return;
  const pid = Number(boundPid);
  if (!Number.isInteger(pid)) return;
  const res = await bridge.getGameBacklog(pid);
  if (!res.ok) return;
  const missing = res.value.lines
    .filter((l) => l.seq === undefined || !seenHostSeq.has(l.seq))
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  if (missing.length > 0) {
    const entries: ConsoleLine[] = missing.map((l) => {
      if (l.seq !== undefined) seenHostSeq.add(l.seq);
      return { seq: seq++, stream: l.stream, text: l.chunk, ts: Date.now(), hseq: l.seq };
    });
    // 补拉行都早于订阅后的实时行：插到首个比它新的宿主行之前（无宿主序号则直接垫底）。
    const firstLive = lines.value.findIndex((l) => l.hseq === undefined || (entries[0]?.hseq ?? Infinity) < l.hseq);
    const at = firstLive === -1 ? lines.value.length : firstLive;
    lines.value.splice(at, 0, ...entries);
    if (lines.value.length > MAX_LINES) {
      lines.value.splice(0, lines.value.length - MAX_LINES);
    }
  }
  if (res.value.exit && lastExit.value === null) {
    lastExit.value = res.value.exit;
  }
}

function clear(): void {
  lines.value = [];
  lastExit.value = null;
}

export interface ConsoleStore {
  lines: typeof lines;
  lastExit: Ref<GameExitEvent | null>;
  clear: () => void;
}

export function useConsole(): ConsoleStore {
  subscribe();
  if (!backlogPulled) {
    backlogPulled = true;
    void pullBacklog();
  }
  return { lines, lastExit, clear };
}
