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
}

const MAX_LINES = 2000;

const lines = ref<ConsoleLine[]>([]);
const lastExit: Ref<GameExitEvent | null> = ref(null);

let seq = 0;
let subscribed = false;

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
    lines.value.push({ seq: seq++, stream: e.stream, text: e.chunk, ts: Date.now() });
    if (lines.value.length > MAX_LINES) {
      lines.value.splice(0, lines.value.length - MAX_LINES);
    }
  });

  bridge.on(IPC_EVENTS.GAME_EXIT, (e) => {
    if (!matchesSession(e.pid)) return;
    lastExit.value = e;
  });
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
  return { lines, lastExit, clear };
}
