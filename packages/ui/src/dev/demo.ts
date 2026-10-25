/**
 * dev-only demo —— 仅 dev 构建 + URL 带 ?demo=1 时生效的演示模式假数据。
 * 无 Electron/Tauri 宿主时在浏览器里让全部 UI 进入"可用态"（缺桥横幅消失、
 * Play 解禁、版本/实例/Java/控制台面板有内容），供视觉迭代。
 * 生产构建 import.meta.env.DEV 恒 false → isDemo() 恒 false，demo 分支不执行、假数据可被摇树。
 * 形状全部对齐 @attic/core-spec 契约（戒律 #2），不自造字段。
 */

import type {
  AppSettings,
  InstanceView,
  JavaDetectionReport,
  JavaInstall,
  ModCategoryView,
  SystemInfo,
  UpdateCheckResult,
  VersionRef,
} from '@attic/core-spec';

/** 演示模式开关：仅 DEV 构建且 URL 搜索参数含 demo=1。 */
export function isDemo(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('demo') === '1';
}

/** 假版本清单：跨年代 5 条（字段对齐 VersionRef，日期为 epoch 毫秒）。 */
export const demoVersions: VersionRef[] = [
  {
    id: 'c0.0.15a_03',
    repository: 'betacraft',
    displayName: 'Early Classic',
    era: 'pre-classic',
    releaseDate: Date.UTC(2009, 4, 27),
    installed: false,
  },
  {
    id: 'c0.30_01',
    repository: 'betacraft',
    displayName: 'Classic',
    era: 'classic',
    releaseDate: Date.UTC(2009, 6, 10),
    installed: true,
  },
  {
    id: 'in-20100223',
    repository: 'betacraft',
    displayName: 'Indev',
    era: 'indev',
    releaseDate: Date.UTC(2010, 1, 23),
    installed: false,
  },
  {
    id: 'b1.7.3',
    repository: 'betacraft',
    displayName: 'The Final Update',
    era: 'beta',
    releaseDate: Date.UTC(2011, 3, 25),
    compileDate: Date.UTC(2011, 3, 26),
    installed: true,
  },
  {
    id: '1.0',
    repository: 'betacraft',
    displayName: 'Official Release 1.0',
    era: 'release-1.0-1.5.2',
    releaseDate: Date.UTC(2011, 10, 18),
    installed: false,
  },
];

/** 假 Java 安装（字段对齐 JavaInstall）。 */
export const demoJavaInstall: JavaInstall = {
  raw: '1.8.0_431',
  major: 8,
  minor: 0,
  patch: 431,
  runtimeRaw: '1.8.0_431-b11',
  vendor: 'Eclipse Temurin',
  executable: 'C:\\Program Files\\Eclipse Adoptium\\jdk-8.0.431.11-hotspot\\bin\\java.exe',
  javaHome: 'C:\\Program Files\\Eclipse Adoptium\\jdk-8.0.431.11-hotspot\\jre',
  architecture: 'x86_64',
  source: 'registry',
  probeDurationMs: 137,
};

/** 假 Java 探测全量报告（字段对齐 JavaDetectionReport）。 */
export const demoJavaReport: JavaDetectionReport = {
  requiredMajor: 8,
  platform: 'win32',
  installs: [demoJavaInstall],
  failures: [],
  selection: {
    install: demoJavaInstall,
    usedFallback: false,
    reason: 'demo: 64-bit Java 8 selected',
  },
  diagnostics: ['dev-only demo: fake detection report, no real probes'],
  startedAt: 0,
  finishedAt: 0,
};

/** 假实例一条（字段对齐 InstanceView）。 */
export const demoInstances: InstanceView[] = [{ name: 'Demo Classic', version: 'c0.30_01' }];

/** 假全局设置（字段对齐 AppSettings；theme 固定 dark 便于视觉迭代，可在设置面板切换）。 */
export const demoSettings: AppSettings = {
  theme: 'dark',
  memoryMode: 'manual',
  maxMemoryMb: 1024,
  language: 'zh-CN',
  jvmArgs: '-XX:+UseSerialGC',
};

/** 假宿主快照（16G 机器场景）：设置页通用/内存滑杆上限/关于版本号在 demo 里有真形状可排。 */
export const demoSysInfo: SystemInfo = {
  // 纯版本号：`-dev`/`-demo` 标注统一由关于页运行面后缀合成（假宿主也演「宿主零感知」语义）
  launcherVersion: '0.0.0',
  platform: 'win32',
  dataRoot: 'C:\\Users\\Player\\AppData\\Roaming\\.attic',
  defaultRoot: 'C:\\Users\\Player\\AppData\\Roaming\\.attic',
  // 首启演练口径：默认根"无既有数据" → 三重门全过 → 欢迎向导在 demo 可弹（跳过/完成后
  // setSettings 假成功，本会话不再弹；刷新页面重置 = demo 无持久化语义，非缺陷）
  defaultRootPopulated: false,
  logsDir: 'C:\\Users\\Player\\AppData\\Roaming\\.attic\\launcher\\logs',
  totalMemMb: 16384,
  freeMemMb: 8192,
  shell: 'electron',
};

/**
 * 假检查更新回包（demo 演练 update 态：关于页红点徽标 + 弹窗「打开发布页」链路可排）；
 * 换 upToDate/unconfigured/error 态直接改本字面量（demo 无网络语义，恒回固定包）。
 */
export const demoUpdateCheck: UpdateCheckResult = {
  status: 'update',
  version: '0.1.0',
  url: 'https://github.com/CreatorCSIE/Attic-Minecraft-Launcher/releases/latest',
  notes: '演示假发布说明：\n- 检查更新全链可演练（弹窗/红点/打开发布页）\n- 本包为 demo 固定回包，无网络语义',
  publishedAt: '2026-10-20T12:00:00Z',
};

/** 便携演练开关：?demo=1 之上再带 portable=1 → sysinfo 进便携态（门之三 flavor 感知演练面）。 */
export function isDemoPortable(): boolean {
  if (!isDemo()) return false;
  return new URLSearchParams(window.location.search).get('portable') === '1';
}

/**
 * 假便携快照（演练场景 = 2026-10-25 用户实机 bug 形态）：默认根有安装/dev 历史
 * （defaultRootPopulated=true）∧ 便携根空（rootPopulated=false）→ 门之三按 rootPopulated
 * 判 → 向导应弹且缺省选中「exe 旁本地目录」。对照旧 bug：复用 defaultRootPopulated 则永不弹。
 */
export const demoSysInfoPortable: SystemInfo = {
  ...demoSysInfo,
  dataRoot: 'D:\\Games\\amcl-electron-windows-x64-0.0.0\\.attic',
  logsDir: 'D:\\Games\\amcl-electron-windows-x64-0.0.0\\.attic\\launcher\\logs',
  defaultRootPopulated: true,
  portable: { active: true, fallback: false, rootPopulated: false },
};

/** 假 Mods 仓库（形状对齐 ModCategoryView；getmods.jsp 生态的示意排布：分类→条目、installed 两态）。 */
export const demoModCategories: ModCategoryView[] = [
  {
    name: 'APIs & Core',
    mods: [
      {
        fullName: 'WorldAPI',
        version: 'WorldAPI Beta 5',
        infoFileUrl: 'http://files.betacraft.uk/repository/WorldAPI.info',
        website: 'http://betacraft.uk/forum/index.php?threads/worldapi.42/',
        autoupdate: true,
        installed: true,
      },
      {
        fullName: 'ModLoaderBE',
        version: 'ModLoaderBE 1.2',
        infoFileUrl: 'http://files.betacraft.uk/repository/ModLoaderBE.info',
        autoupdate: false,
        installed: false,
      },
    ],
  },
  {
    name: 'Gameplay',
    mods: [
      {
        fullName: 'Damage Indicators',
        version: 'DI 1.0 for b1.7.3',
        infoFileUrl: 'http://files.betacraft.uk/repository/DamageIndicators.info',
        website: 'http://betacraft.uk/forum/index.php?threads/damage-indicators.88/',
        autoupdate: false,
        installed: false,
      },
      {
        fullName: 'More Skins',
        version: 'MoreSkins b1.7',
        infoFileUrl: 'http://files.betacraft.uk/repository/MoreSkins.info',
        autoupdate: true,
        installed: false,
      },
    ],
  },
  {
    name: 'Misc',
    mods: [
      {
        fullName: 'Furniture Extra',
        version: 'Furniture Extra 1.1',
        infoFileUrl: 'http://files.betacraft.uk/repository/FurnitureExtra.info',
        website: 'http://betacraft.uk/forum/index.php?threads/furniture-mod.103/',
        autoupdate: false,
        installed: false,
      },
    ],
  },
];

/** 假控制台输出行（useConsole 的 demo 分支灌入，模拟远古版本启动日志）。 */
export const demoConsoleLines: ReadonlyArray<{ stream: 'stdout' | 'stderr'; text: string }> = [
  { stream: 'stdout', text: '[INFO] Setting user: DemoPlayer' },
  { stream: 'stdout', text: '[INFO] (Session ID is demo)' },
  { stream: 'stdout', text: '[INFO] Start up client' },
  { stream: 'stderr', text: '[WARNING] Failed to setup keyboard: demo environment' },
  { stream: 'stdout', text: '[INFO] Generated: 128 - 256 - 128' },
];
