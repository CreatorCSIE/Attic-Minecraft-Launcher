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
  GameBacklog,
  GameExit,
  GameSession,
  GameStatus,
  InstanceView,
  IpcResult,
  JavaDetectionReport,
  LaunchConfig,
  ModCategoryView,
  ModInstallRequest,
  RendererBridge,
  SystemInfo,
  VersionJson,
} from '@attic/core-spec';
import { demoInstances, demoJavaReport, demoModCategories, demoSettings, demoSysInfo, demoVersions, isDemo } from '../dev/demo';

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
  // 降级 mock 无本地 jar 可言：探测恒 false（菜单项禁用 = 可见降级语义）。
  probeVersionClass: async () => ok(false),
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
  // backlog 属宿主事件缓存，浏览器 mock 无真值（控制台窗 mock 链路本就不存在）。
  getGameBacklog: async () => err<GameBacklog>(NO_BRIDGE),
  listCustomVersions: async () => ok<CustomVersionView[]>([]),
  getCustomVersionInfo: async () => err<CustomInfoView>(NO_BRIDGE),
  saveCustomVersionInfo: async () => err<CustomVersionView>(NO_BRIDGE),
  importCustomJar: async () => err<CustomVersionView | null>(NO_BRIDGE),
  removeCustomVersion: async () => err<void>(NO_BRIDGE),
  // Mods 仓库属网络 + fs 宿主语义：mock 列表回空（空态分支可排），安装可见失败。
  listMods: async () => ok<ModCategoryView[]>([]),
  installMod: async () => err<void>(NO_BRIDGE),
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
      // 弹窗被拦截时 window.open 返回 null：如实报失败（与宿主无浏览器 reject 同弹窗呈现）
      if (!window.open(url, '_blank', 'noopener')) throw new Error('弹窗被浏览器拦截（popup blocked）');
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
    // 演示假探测：infdev 行（in-20100223）视为含 isom 类，让「≡」菜单的 visualizer 项可演练；
    // 其余版本 false，展示"探测不中即禁用"两态。
    probeVersionClass: async (versionId) => ok(versionId === 'in-20100223'),
    listInstances: async () => ok(demoInstances),
    getSettings: async () => ok<AppSettings>(demoSettings),
    detectJava: async () => ok<JavaDetectionReport>(demoJavaReport),
    // 假宿主快照：让设置页通用/内存/关于栏在浏览器里排出真稿（动作类仍走 mock err）。
    getSystemInfo: async () => ok<SystemInfo>(demoSysInfo),
    // Mods 页演示：假仓库「现拉现发」= 每次深拷贝返回（与真宿主语义一致——直接回原数组引用时，
    // installMod 的原地改写落在 raw 对象上、绕过 Vue reactive 代理，installed 徽标不刷新）。
    listMods: async () => ok<ModCategoryView[]>(structuredClone(demoModCategories)),
    installMod: async (request: ModInstallRequest) => {
      for (const cat of demoModCategories) {
        for (const mod of cat.mods) {
          if (mod.fullName === request.fullName) mod.installed = true;
        }
      }
      return ok<void>(undefined);
    },
    // 自定义页演示：mod 托管项随假仓库派生（installed 即入列，jar 恒未合成）；
    // 删除联动翻回未安装 → Mods 页徽标恢复「下载」，卸载链路可演练。
    listCustomVersions: async () =>
      ok<CustomVersionView[]>(
        demoModCategories
          .flatMap((c) => c.mods)
          .filter((m) => m.installed)
          .map((m) => ({ id: m.fullName, installed: false, configured: true, mod: true })),
      ),
    removeCustomVersion: async (id: string) => {
      let hit = false;
      for (const cat of demoModCategories) {
        for (const mod of cat.mods) {
          if (mod.fullName === id) {
            mod.installed = false;
            hit = true;
          }
        }
      }
      return hit ? ok<void>(undefined) : err<void>(NO_BRIDGE);
    },
    // 已安装 mod 的详情 = 托管只读态演示（props 为假 .info 形状）；其余 id 维持 mock err。
    getCustomVersionInfo: async (id: string) => {
      for (const cat of demoModCategories) {
        for (const mod of cat.mods) {
          if (mod.fullName === id && mod.installed) {
            return ok<CustomInfoView>({
              id,
              configured: true,
              mod: true,
              launchMethods: [],
              props: {
                'base-version': 'b1.7.3',
                url: `http://files.betacraft.uk/repository/${encodeURIComponent(mod.fullName)}.jar`,
                sha1: '0'.repeat(40),
              },
            });
          }
        }
      }
      return err<CustomInfoView>(NO_BRIDGE);
    },
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
