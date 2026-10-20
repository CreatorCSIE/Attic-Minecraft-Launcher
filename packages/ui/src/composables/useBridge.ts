/**
 * useBridge —— 封装 window.attic 桥面。
 * 浏览器直开（无 Electron preload）时返回降级 mock：列表类返回空、动作类返回 no-bridge 错误，
 * 保证 UI 不崩且走"空状态"分支（缺桥横幅由 App.vue 依 hasBridge 展示）。
 * dev 演示模式（?demo=1，见 dev/demo.ts 自述承诺）：无真桥且 isDemo() 时以假数据覆写
 * 列表/设置/Java 探测，支撑"无宿主在场直接在浏览器排版出真稿"的工作流；
 * 动作类仍走 mock 的 no-bridge 错误（不伪装可启动）。
 */

import { computed, type ComputedRef } from 'vue';
import type {
  AccountView,
  AppSettings,
  CustomInfoView,
  CustomVersionView,
  GameExit,
  GameSession,
  GameStatus,
  InstanceView,
  IpcResult,
  JavaDetectionReport,
  LaunchConfig,
  RendererBridge,
  SystemInfo,
  VersionJson,
} from '@attic/core-spec';
import { demoInstances, demoJavaReport, demoSettings, demoSysInfo, demoVersions, isDemo } from '../dev/demo';

const NO_BRIDGE = 'no-bridge';

function ok<T>(value: T): IpcResult<T> {
  return { ok: true, value };
}
function err<T>(error: string): IpcResult<T> {
  return { ok: false, error };
}

/** 降级 mock：形状与契约一致，数据为空/安全默认（全部 async 返回 Promise，对齐 RendererBridge）。 */
const mockBridge: RendererBridge = {
  ping: async () => ok<string>('mock'),
  listVersions: async () => ok([]),
  getVersionJson: async () => err<VersionJson>(NO_BRIDGE),
  dryRunLaunch: async () => err<LaunchConfig>(NO_BRIDGE),
  launch: async () => err<GameSession>(NO_BRIDGE),
  kill: async () => err<GameExit>(NO_BRIDGE),
  status: async () =>
    ok<GameStatus>({ running: false, session: null, lastExit: null, lastError: null }),
  detectJava: async () =>
    ok<JavaDetectionReport>({
      requiredMajor: 8,
      platform: 'browser',
      installs: [],
      failures: [],
      selection: { install: null, usedFallback: false, reason: NO_BRIDGE },
      diagnostics: [],
      startedAt: 0,
      finishedAt: 0,
    }),
  listAccounts: async () => ok([]),
  addAccount: async () => err<AccountView>(NO_BRIDGE),
  removeAccount: async () => err<void>(NO_BRIDGE),
  renameAccount: async () => err<AccountView>(NO_BRIDGE),
  getSettings: async () => ok<AppSettings>({}),
  setSettings: async (s) => ok(s),
  listInstances: async () => ok([]),
  saveInstance: async (i) => ok(i),
  // 删除与保存同族（表单可用性：UI 就地更新清单，不依赖假 fs）；打开目录是 fs 动作，浏览器无意义。
  deleteInstance: async () => ok<void>(undefined),
  // 改名同族：UI 本地就地换名，返回值不参与渲染，回个合法形状即可。
  renameInstance: async (_name: string, newName: string) => ok<InstanceView>({ name: newName, version: '' }),
  openInstanceDir: async () => err<void>(NO_BRIDGE),
  windowControl: async () => ok<void>(undefined), // 浏览器无窗可控：no-op
  openConsoleWindow: async () => err<void>(NO_BRIDGE),
  listCustomVersions: async () => ok<CustomVersionView[]>([]),
  getCustomVersionInfo: async () => err<CustomInfoView>(NO_BRIDGE),
  saveCustomVersionInfo: async () => err<CustomVersionView>(NO_BRIDGE),
  importCustomJar: async () => err<CustomVersionView | null>(NO_BRIDGE),
  removeCustomVersion: async () => err<void>(NO_BRIDGE),
  // —— 设置页宿主能力面：fs/对话框/内存属宿主语义，浏览器无真值（err 可见失败）——
  getSystemInfo: async () => err<SystemInfo>(NO_BRIDGE),
  openSpecialDir: async () => err<void>(NO_BRIDGE),
  clearLogs: async () => err<number>(NO_BRIDGE),
  pickJavaExecutable: async () => err<string | null>(NO_BRIDGE),
  pickDirectory: async () => err<string | null>(NO_BRIDGE),
  // 外链是唯一浏览器可忠实实现的"宿主动作"：window.open 即系统默认浏览器行为，照常放行。
  openExternalUrl: async (url: string) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`仅允许 http/https：${parsed.protocol}`);
      window.open(url, '_blank', 'noopener');
      return ok<void>(undefined);
    } catch (error) {
      return err<void>(error instanceof Error ? error.message : String(error));
    }
  },
  on: () => () => {},
};

export interface BridgeHandle {
  bridge: RendererBridge;
  hasBridge: ComputedRef<boolean>;
}

/** 演示覆写：只改"读"侧数据源，写/动作/窗控沿用 mock（假数据不伪装成真宿主行为）。 */
function demoBridge(): RendererBridge {
  return {
    ...mockBridge,
    listVersions: async () => ok(demoVersions),
    listInstances: async () => ok(demoInstances),
    getSettings: async () => ok<AppSettings>(demoSettings),
    detectJava: async () => ok<JavaDetectionReport>(demoJavaReport),
    // 假宿主快照：让设置页通用/内存/关于栏在浏览器里排出真稿（动作类仍走 mock err）。
    getSystemInfo: async () => ok<SystemInfo>(demoSysInfo),
  };
}

export function useBridge(): BridgeHandle {
  const real = typeof window !== 'undefined' ? window.attic : undefined;
  const bridge = real ?? (isDemo() ? demoBridge() : mockBridge);
  return {
    bridge,
    hasBridge: computed(() => real !== undefined),
  };
}
