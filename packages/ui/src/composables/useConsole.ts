/**
 * useConsole —— 订阅 game:output / game:exit / download:progress。
 * 模块级持久订阅：切视图仍在收集输出（控制台不因卸载丢日志）。
 * 输出环形缓冲封顶，避免长跑内存膨胀。
 */

import { ref, type Ref } from 'vue';
import { IPC_EVENTS, type DownloadProgressEvent, type GameExitEvent } from '@attic/core-spec';
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
const downloads = ref<Record<string, DownloadProgressEvent>>({});

let seq = 0;
let subscribed = false;

const { bridge } = useBridge();

function downloadKey(e: DownloadProgressEvent): string {
  return `${e.item}:${e.id}`;
}

function subscribe(): void {
  if (subscribed) return;
  subscribed = true;

  bridge.on(IPC_EVENTS.GAME_OUTPUT, (e) => {
    lines.value.push({ seq: seq++, stream: e.stream, text: e.chunk, ts: Date.now() });
    if (lines.value.length > MAX_LINES) {
      lines.value.splice(0, lines.value.length - MAX_LINES);
    }
  });

  bridge.on(IPC_EVENTS.GAME_EXIT, (e) => {
    lastExit.value = e;
  });

  bridge.on(IPC_EVENTS.DOWNLOAD_PROGRESS, (e) => {
    downloads.value[downloadKey(e)] = { ...e };
  });
}

function clear(): void {
  lines.value = [];
  lastExit.value = null;
  downloads.value = {};
}

export interface ConsoleStore {
  lines: typeof lines;
  lastExit: Ref<GameExitEvent | null>;
  downloads: typeof downloads;
  clear: () => void;
}

export function useConsole(): ConsoleStore {
  subscribe();
  return { lines, lastExit, downloads, clear };
}
