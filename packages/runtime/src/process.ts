/**
 * 游戏进程生命周期：spawn、stdout/stderr 流、崩溃分类器 v0、kill/退出清理。
 * 戒律：游戏开独立顶层窗口，永不嵌入宿主（MCANextGen 风险登记 #3/#6 的全部教训）。
 */

import { spawn, type ChildProcess, type ChildProcessByStdio } from 'node:child_process';
import path from 'node:path';
import type { Readable } from 'node:stream';

import { APPLET_LAUNCHER_CLASS } from './launch.js';

import type {
  CrashCategory,
  CrashSummary,
  GameExit,
  GameExitEvent,
  GameOutputEvent,
  GameSession,
  GameStatus,
  LaunchConfig,
} from '@attic/core-spec';

interface CrashRule {
  category: CrashCategory;
  pattern: RegExp;
}

/** 分类规则按序匹配（v0 最小集，headline 取首个匹配行）。 */
const CRASH_RULES: CrashRule[] = [
  { category: 'out-of-memory', pattern: /OutOfMemoryError|GC overhead limit/i },
  { category: 'unsatisfied-link', pattern: /UnsatisfiedLinkError/ },
  { category: 'gl-init', pattern: /GLXBadContext|WGL|couldn.?t set up|Could not create (?:the )?context|Failed to create context/i },
  { category: 'lwjgl-native', pattern: /lwjgl.*(?:native|library)|(?:native|library).*lwjgl/i },
  { category: 'java-missing', pattern: /ENOENT|java(?:\s*executable)? not found|not recognized/i },
];

export function classifyCrash(output: string, code: number | null): CrashSummary | null {
  if (code === 0) return null;
  const lines = output.split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (const rule of CRASH_RULES) {
    const hit = lines.find((line) => rule.pattern.test(line));
    if (hit) return { category: rule.category, headline: hit.trim() };
  }
  return { category: 'unknown', headline: lines.length > 0 ? lines[lines.length - 1]!.trim() : `exit code ${code}` };
}

/** 输出缓冲上限（分类只用尾部，内存有界）。 */
const OUTPUT_TAIL_LIMIT = 1024 * 1024;

export interface GameProcessEvents {
  onOutput: (event: GameOutputEvent) => void;
  onExit: (event: GameExitEvent) => void;
}

/**
 * 窗口看门狗（仅 Applet 容器 + Windows）：classic/pre-classic 的游戏循环不检查
 * isCloseRequested（v1 靠 JVM wrapper 的 windowClosing→exit 兜底，legacyfix AppletFrame 无此监听），
 * 关窗后进程空转不退。deawt 模式下窗口属 LWJGL，关闭后进程 MainWindowHandle 归零——
 * 轮询到归零即 SIGTERM，让"关窗=退出"与常规版本行为一致。
 */
function windowWatchdogScript(pid: number): string {
  return [
    `$seen=$false`,
    `for(;;) {`,
    `  $p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    `  if(-not $p){ 'EXITED'; break }`,
    `  if(-not $seen -and $p.MainWindowHandle -ne 0){ $seen=$true }`,
    `  if($seen -and $p.MainWindowHandle -eq 0){ 'CLOSED'; break }`,
    `  Start-Sleep -Milliseconds 1000`,
    `}`,
  ].join('; ');
}

export class GameProcessManager {
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private watchdog: ChildProcess | null = null;
  private session: GameSession | null = null;
  private lastExit: GameExit | null = null;
  private lastError: string | null = null;
  private outputTail = '';
  private closedResolve: (() => void) | null = null;

  constructor(private readonly events: GameProcessEvents) {}

  get running(): boolean {
    return this.child !== null;
  }

  private appendOutput(chunk: string): void {
    this.outputTail += chunk;
    if (this.outputTail.length > OUTPUT_TAIL_LIMIT) {
      this.outputTail = this.outputTail.slice(-OUTPUT_TAIL_LIMIT);
    }
  }

  /** 启动游戏进程（同一时刻仅允许一个）。 */
  start(config: LaunchConfig, versionId: string): GameSession {
    if (this.child) throw new Error('游戏进程已在运行');

    const args = [...config.jvmArgs, '-cp', config.classpath.join(path.delimiter), config.mainClass, ...config.gameArgs];
    const child = spawn(config.javaPath, args, { cwd: config.gameDir, stdio: ['ignore', 'pipe', 'pipe'] });
    this.outputTail = '';
    this.lastError = null;

    const pid = child.pid ?? -1;
    this.session = { pid, versionId, startedAt: Date.now() };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      this.appendOutput(data);
      this.events.onOutput({ stream: 'stdout', chunk: data, pid });
    });
    child.stderr.on('data', (data: string) => {
      this.appendOutput(data);
      this.events.onOutput({ stream: 'stderr', chunk: data, pid });
    });

    // spawn 失败（如 java 不存在）走 error 事件：把原因喂进输出缓冲供分类器命中 java-missing。
    child.on('error', (error: Error) => {
      this.appendOutput(`${error.message}\n`);
      this.lastError = error.message;
    });

    child.on('close', (code, signal) => {
      console.log(`[attic-runtime] game close pid=${pid} code=${code} signal=${signal}`);
      this.watchdog?.kill();
      this.watchdog = null;
      const crash = classifyCrash(this.outputTail, code);
      const exit: GameExit = { code, signal, crash };
      this.lastExit = exit;
      this.child = null;
      const session = this.session;
      this.session = null;
      this.events.onExit({ ...exit, pid, versionId: session?.versionId ?? versionId });
      this.closedResolve?.();
      this.closedResolve = null;
    });

    this.child = child;

    if (process.platform === 'win32' && config.mainClass === APPLET_LAUNCHER_CLASS) {
      this.startWindowWatchdog(child, pid);
    }
    return this.session;
  }

  /** 看门狗进程输出 CLOSED（用户关窗且进程未自退）→ SIGTERM 游戏，走常规退出事件链。 */
  private startWindowWatchdog(child: ChildProcessByStdio<null, Readable, Readable>, pid: number): void {
    const ps = spawn('powershell', ['-NoProfile', '-Command', windowWatchdogScript(pid)], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    this.watchdog = ps;
    ps.stdout.setEncoding('utf8');
    ps.stdout.on('data', (data: string) => {
      if (!data.includes('CLOSED') || this.child !== child) return;
      this.appendOutput('[attic-runtime] 游戏窗口已关闭，终止进程\n');
      this.events.onOutput({ stream: 'stdout', chunk: '[attic-runtime] 游戏窗口已关闭，终止进程\n', pid });
      child.kill('SIGTERM');
    });
    ps.on('close', () => {
      if (this.watchdog === ps) this.watchdog = null;
    });
  }

  /** SIGTERM 终止并等待退出；无进程时返回上次退出（或空退出）。 */
  async kill(): Promise<GameExit> {
    if (!this.child) {
      return this.lastExit ?? { code: null, signal: null, crash: null };
    }
    const closed = new Promise<void>((resolve) => {
      this.closedResolve = resolve;
    });
    this.child.kill('SIGTERM');
    await closed;
    return this.lastExit ?? { code: null, signal: null, crash: null };
  }

  status(): GameStatus {
    return {
      running: this.child !== null,
      session: this.session,
      lastExit: this.lastExit,
      lastError: this.lastError,
    };
  }
}
