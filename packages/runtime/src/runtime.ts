/**
 * AtticRuntime：TS 侧启动器核心门面（Electron 主进程唯一消费者）。
 * 方法面 = RendererBridge 九请求（ipc.ts）；事件面 = IPC_EVENTS 三通道。
 * 错误以异常抛出，IpcResult 封装归壳层（apps/electron/main.ts）。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  IPC_EVENTS,
  type Account,
  type AccountView,
  type CustomInfoView,
  type CustomVersionView,
  type OfflineAccount,
  type AppSettings,
  type SystemInfo,
  type AtticEventPayloads,
  type DownloadProgressEvent,
  type GameExit,
  type GameSession,
  type GameStatus,
  type InstanceView,
  type JavaDetectionReport,
  type LaunchConfig,
  type LaunchRequest,
  type ModCategoryView,
  type ModInstallRequest,
  type VersionJson,
  type VersionManifest,
  type VersionRef,
} from '@attic/core-spec';

import { applySettingsToProps, estimateMaxMemoryMb, instanceViewFromConfig, settingsFromProps } from './appSettings';
import { BetacraftClient, type FetchImpl } from './betacraft';
import { endpointsFromOverrides, resolveEndpoints, type Endpoints } from './endpoints';
import { infoToVersionJson, LAUNCH_METHOD_MAIN_CLASS } from './info';
import { detectJavaRuntime } from './java/detect';
import { APPLET_LAUNCHER_CLASS, assembleLaunchConfig, type LaunchContext } from './launch';
import {
  composeModJars,
  downloadInfoAtomic,
  isModVersionJson,
  readModRegistry,
  refreshModInfo,
  removeModRegistry,
  upsertModRegistry,
  type ModRegistryEntry,
} from './mods';
import { GameProcessManager } from './process';
import { parseProperties } from './properties';
import { DEFAULT_AGENT_MOUNTS } from './quirks';
import {
  binDir,
  clientJarFile,
  deleteInstance,
  ensureLayout,
  infoFile,
  jsonsDir,
  listInstances,
  loadAccounts,
  loadInstance,
  loadSettings,
  launcherDir,
  nativesDir,
  offlineUuid,
  readPropertiesFile,
  renameInstance,
  resolveDataRoot,
  saveAccounts,
  saveInstance,
  saveSettings,
  scanBinPool,
  scanInstalledInfos,
  scanInstalledJars,
  scanInstalledVersions,
  type InstanceConfig,
  versionListCacheFile,
  writePropertiesFile,
  zuluJavaDir,
} from './storage';
import { canonicalLaunchMethod, detectLaunchMethod, probeIndevEntry, probePreclassicEntry } from './wrapperDetector';
import { extractZipTo, listZipEntryNames } from './zip';
import { installZuluPackage, queryZuluPackages } from './zulu';

export interface AtticRuntimeOptions {
  /** rootDir 覆盖（共存/迁移逃生舱）。 */
  rootDir?: string;
  portable?: boolean;
  endpoints?: Partial<Endpoints>;
  fetchImpl?: FetchImpl;
  env?: NodeJS.ProcessEnv;
  execPath?: string;
  platform?: NodeJS.Platform;
  /** 启动器版本（宿主注入：electron = app.getVersion()；SYS_INFO 展示用）。 */
  version?: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 诊断日志脱敏（v1 Launcher.java L659/L685 `[censored sessionid]` 同款）：
 * 命令行与游戏输出行里的 accessToken 一律替换后再落盘。
 * 短值（离线 '0'、空）不替换——避免把 '0' 这类通用子串在整行里乱伤。
 */
export function maskSecrets(text: string, accessToken: string | undefined): string {
  if (!accessToken || accessToken.length < 16) return text;
  return text.split(accessToken).join('[censored sessionid]');
}

/** v1 首启语义（Launcher.java L369）：缺省实例名 "default instance"。 */
export const DEFAULT_INSTANCE_NAME = 'default instance';

function readTextIfPresent(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readJsonIfPresent<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function toAccountView(account: Account): AccountView {
  if (account.type === 'microsoft') {
    const expires = account.tokenExpiresAt;
    return { id: account.id, name: account.name, type: account.type, tokenValid: expires === undefined || expires > Date.now() };
  }
  return { id: account.id, name: account.name, type: 'offline' };
}

/** 版本 id → 文件名安全（CUSTOM_* 通道入参面：拒绝路径分隔/穿越/Windows 非法字符/控制符）。 */
function assertSafeVersionId(id: string): void {
  if (
    id === '' ||
    id === '.' ||
    id === '..' ||
    /[\\/:*?"<>|\x00-\x1f]/.test(id) ||
    id.length > 128
  ) {
    throw new Error(`非法版本 id：${JSON.stringify(id)}`);
  }
}

export class AtticRuntime {
  readonly root: string;
  readonly endpoints: Endpoints;
  /** 启动器版本（宿主注入，SYS_INFO/关于页消费）。 */
  readonly version: string;
  private readonly platform: NodeJS.Platform;
  private readonly fetchImpl: FetchImpl;
  private readonly client: BetacraftClient;
  private readonly processes: GameProcessManager;
  private readonly listeners = new Map<string, Set<(payload: never) => void>>();
  private lastLaunchError: string | null = null;
  private infoWatcher: fs.FSWatcher | null = null;
  /** .info 监视去抖：id → 挂起定时器（编辑器保存常触发多事件）。 */
  private readonly infoWatchTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: AtticRuntimeOptions = {}) {
    this.root = resolveDataRoot({
      platform: options.platform,
      env: options.env,
      execPath: options.execPath,
      portable: options.portable,
      rootDirOverride: options.rootDir,
    });
    ensureLayout(this.root);
    this.version = options.version ?? '0.0.0';
    this.platform = options.platform ?? process.platform;
    // 端点优先级：构造参数（测试/程序化）> launcher.settings 的 endpoint.* 覆盖 > 默认。
    this.endpoints = options.endpoints
      ? resolveEndpoints(options.endpoints)
      : endpointsFromOverrides(settingsFromProps(loadSettings(this.root)).endpoints);
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.client = new BetacraftClient({
      endpoints: this.endpoints,
      fetchImpl: this.fetchImpl,
      onProgress: (event: DownloadProgressEvent) => this.emitEvent(IPC_EVENTS.DOWNLOAD_PROGRESS, event),
    });
    this.processes = new GameProcessManager({
      onOutput: (event) => this.emitEvent(IPC_EVENTS.GAME_OUTPUT, event),
      onExit: (event) => this.emitEvent(IPC_EVENTS.GAME_EXIT, event),
    });
  }

  // ---------- 事件面 ----------

  on<E extends keyof AtticEventPayloads>(event: E, cb: (payload: AtticEventPayloads[E]) => void): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(cb as (payload: never) => void);
    this.listeners.set(event, set);
    // jsons 监视器懒启停：无订阅者不开句柄（探针实测 Windows 下未 close 的 fs.watch 会钉住
    // node --test 子进程退出，unref 不解除）；宿主 wireEvents 常驻订阅 → 等价全程监视。
    if (event === IPC_EVENTS.CUSTOM_INFO_CHANGED) this.startInfoWatcher();
    return () => {
      set.delete(cb as (payload: never) => void);
      if (event === IPC_EVENTS.CUSTOM_INFO_CHANGED && set.size === 0) this.stopInfoWatcher();
    };
  }

  private emitEvent(event: string, payload: unknown): void {
    for (const cb of this.listeners.get(event) ?? []) {
      (cb as (p: unknown) => void)(payload);
    }
  }

  /**
   * jsons 目录监视（外部编辑 .info 实时更新，用户指定）：只认 `*.info`，编辑器保存常伴随
   * 多事件/temp+rename，按 id 去抖 250ms 合并后发 CUSTOM_INFO_CHANGED。
   * 启动器自身保存的回声由 UI 侧 selfWrite 窗口吸收（配置页保存后已自刷新，不依赖本事件）。
   * 由 on(CUSTOM_INFO_CHANGED) 首个订阅者懒启动（见上）；unref + 订阅清零时 close：
   * 探针实测 Windows 未 close 的 fs.watch 句柄会钉住 node --test 子进程退出。
   */
  private startInfoWatcher(): void {
    if (this.infoWatcher) return;
    try {
      this.infoWatcher = fs.watch(jsonsDir(this.root), (_event, filename) => {
        if (!filename || !filename.endsWith('.info')) return;
        const id = filename.slice(0, -'.info'.length);
        const pending = this.infoWatchTimers.get(id);
        if (pending) clearTimeout(pending);
        this.infoWatchTimers.set(
          id,
          setTimeout(() => {
            this.infoWatchTimers.delete(id);
            this.emitEvent(IPC_EVENTS.CUSTOM_INFO_CHANGED, { id });
          }, 250),
        );
      });
      this.infoWatcher.unref();
    } catch {
      this.infoWatcher = null;
    }
  }

  /** 末订阅者退订：关句柄 + 清去抖定时器（不得留悬垂事件源）。 */
  private stopInfoWatcher(): void {
    try {
      this.infoWatcher?.close();
    } catch {
      /* 已失效句柄：忽略 */
    }
    this.infoWatcher = null;
    for (const timer of this.infoWatchTimers.values()) clearTimeout(timer);
    this.infoWatchTimers.clear();
  }

  // ---------- 请求面（RendererBridge 九通道） ----------

  ping(): string {
    return 'pong';
  }

  /** 网络优先（并落缓存）；失败退本地缓存；再失败退本地扫描。installed 以 versions/ 实存为准。 */
  async listVersions(): Promise<VersionRef[]> {
    let refs: VersionRef[] | null = null;
    try {
      refs = await this.client.fetchVersionList();
      const cache: VersionManifest = { generatedAt: Date.now(), versions: refs };
      fs.mkdirSync(launcherDir(this.root), { recursive: true });
      fs.writeFileSync(versionListCacheFile(this.root), JSON.stringify(cache), 'utf8');
    } catch {
      const cache = readJsonIfPresent<VersionManifest>(versionListCacheFile(this.root));
      if (cache?.versions) refs = cache.versions;
    }

    // "已安装"= jar 实存（用户指定）；jar∪info 并集仅用于离线兜底列出本地版本
    const jars = new Set(scanInstalledJars(this.root));
    const infos = new Set(scanInstalledInfos(this.root));
    // 官方清单 id 集（网络/缓存 refs 同源）：**官方命中 > 本地声明**（inf-20100227-1433 实案——
    // BC 版本地 .info 缺失或残留 custom=true 都不得判 custom；前者"未落元数据"，后者为陈旧误写）。
    const official = new Set((refs ?? []).map((ref) => ref.id));
    const isCustom = (id: string): boolean =>
      // v1 语义（offlineVersionList）：裸 jar（有 jar 无 .info）或 .info 显式声明，且不在官方清单
      !official.has(id) &&
      ((jars.has(id) && !infos.has(id)) ||
        (infos.has(id) && readPropertiesFile(infoFile(this.root, id))['custom']?.toLowerCase() === 'true'));
    const local = scanInstalledVersions(this.root);
    const out: VersionRef[] = (refs ?? []).map((ref) => ({
      ...ref,
      installed: jars.has(ref.id),
      ...(isCustom(ref.id) ? { custom: true } : {}),
    }));
    for (const id of local) {
      if (!out.some((ref) => ref.id === id)) {
        out.push({ id, repository: 'local', installed: jars.has(id), ...(isCustom(id) ? { custom: true } : {}) });
      }
    }
    if (out.length === 0) throw new Error('版本清单获取失败且无本地缓存/安装');
    return out;
  }

  /** 本地 .info 优先（离线可用），缺失才下载并落盘；下载失败退裸 jar custom 路径。 */
  async getVersionJson(versionId: string): Promise<VersionJson> {
    const local = readTextIfPresent(infoFile(this.root, versionId));
    if (local !== null) return this.withAgentMounts(infoToVersionJson(versionId, parseProperties(local)));
    try {
      const text = await this.client.fetchVersionInfo(versionId);
      this.client.saveVersionInfo(this.root, versionId, text);
      return this.withAgentMounts(infoToVersionJson(versionId, parseProperties(text)));
    } catch (error) {
      const custom = this.tryCustomVersionJson(versionId);
      if (custom) return custom;
      throw error;
    }
  }

  /**
   * 本地 client jar class 条目探测（VERSION_PROBE_CLASS）：启动页「≡」菜单项启用判定
   * （visualizer → `net/minecraft/isom/IsomPreviewApplet.class`，infdev-20100617 同 jar 并存类）。
   * jar 未下载/损坏/条目缺失 = false（菜单项禁用，不报错——可见降级）。
   * 条目清单按 jar 路径+mtime 缓存，避免每次开菜单都重读 zip 中央目录。
   */
  private readonly classProbeCache = new Map<string, { mtimeMs: number; entries: string[] }>();

  probeVersionClass(versionId: string, className: string): boolean {
    const jar = clientJarFile(this.root, versionId);
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(jar).mtimeMs;
    } catch {
      return false;
    }
    let cached = this.classProbeCache.get(jar);
    if (!cached || cached.mtimeMs !== mtimeMs) {
      try {
        cached = { mtimeMs, entries: listZipEntryNames(jar) };
      } catch {
        cached = { mtimeMs, entries: [] };
      }
      this.classProbeCache.set(jar, cached);
    }
    return cached.entries.includes(className);
  }

  /**
   * 每次启动重下 .info（v2 已知坑：元数据陈旧）；网络失败退本地。
   * v1 豁免（Launcher.java L412/L432）：custom=true 的 .info 归用户所有，跳过重下/覆盖。
   * Mods 安装器登记的 mod 走独立通道：按 launcher/mods.json 登记的直链刷新（autoupdate/缺失才拉），
   * 绝不回落官方默认 versionJson(id) URL——v1 Launcher.java L410-414「离线误路由官方 URL」的结构性修复。
   */
  private async refreshVersionInfo(versionId: string): Promise<VersionJson> {
    const modEntry = readModRegistry(this.root)[versionId];
    if (modEntry) return this.refreshRegisteredModInfo(versionId, modEntry);
    const localText = readTextIfPresent(infoFile(this.root, versionId));
    if (localText !== null) {
      const props = parseProperties(localText);
      if (props['custom']?.toLowerCase() === 'true') return this.withAgentMounts(infoToVersionJson(versionId, props));
    }
    try {
      const text = await this.client.fetchVersionInfo(versionId);
      this.client.saveVersionInfo(this.root, versionId, text);
      return this.withAgentMounts(infoToVersionJson(versionId, parseProperties(text)));
    } catch (error) {
      if (localText !== null) return this.withAgentMounts(infoToVersionJson(versionId, parseProperties(localText)));
      const custom = this.tryCustomVersionJson(versionId);
      if (custom) return custom;
      throw error;
    }
  }

  /**
   * 已登记 mod 的 .info 刷新（v1 Launcher.java L417-426 语义 + 两处修复）：
   * - autoupdate=false 且本地在位 → 直接用本地，不联网；
   * - 刷新失败但本地在位 → 留旧文件离线启动（原子写保证旧文件未被破坏）；
   * - 刷新失败且本地缺失 → 显式报错（v1「静默假可用」修复：绝不带残缺进 spawn）。
   */
  private async refreshRegisteredModInfo(versionId: string, entry: ModRegistryEntry): Promise<VersionJson> {
    const localText = readTextIfPresent(infoFile(this.root, versionId));
    try {
      await refreshModInfo(this.client, this.root, versionId, entry);
    } catch (error) {
      if (localText !== null) return this.withAgentMounts(infoToVersionJson(versionId, parseProperties(localText)));
      throw new Error(`Mod ${versionId} 的 .info 本地缺失，且从登记地址刷新失败：${messageOf(error)}`);
    }
    const text = readTextIfPresent(infoFile(this.root, versionId)) ?? localText;
    if (text === null) throw new Error(`Mod ${versionId} 的 .info 未正确落位`);
    return this.withAgentMounts(infoToVersionJson(versionId, parseProperties(text)));
  }

  /**
   * 裸 jar custom 路径（v1：bare jar 即 custom，downloadJson 豁免）：类检测合成元数据。
   * 检测失败 = Error 7 语义：显式报错并指引手编 .info（数据缺口可见，不静默兜底）。
   */
  private tryCustomVersionJson(versionId: string): VersionJson | null {
    if (fs.existsSync(infoFile(this.root, versionId))) return null;
    const jar = clientJarFile(this.root, versionId);
    if (!fs.existsSync(jar)) return null;
    // 检测名归一为主类表合法值（rd/mc→preclassic 等，见 canonicalLaunchMethod），
    // 否则合成 JSON 撞表外键 → "无法确定主类"（v1 两套餐名不同源的固有断层）。
    const method = canonicalLaunchMethod(detectLaunchMethod(jar));
    if (method === 'custom') {
      throw new Error(
        `无法识别启动方式（v1 Error 7）：请编辑 ${infoFile(this.root, versionId)} 配置 launch-method`,
      );
    }
    return this.withAgentMounts(infoToVersionJson(versionId, { 'launch-method': method, custom: 'true' }));
  }

  /**
   * indev 混代归位（用户报障：早期 indev jar 无 Minecraft.main → "找不到主类"）：
   * launch-method=indev 覆盖 2.0-preview→1.5.2，按本地 jar 探测——仅 MinecraftApplet 形态
   * 改走 legacyfix AppletLauncher 容器（候选表首项即 net.minecraft.client.MinecraftApplet，
   * jar 已在 classpath，无需 --appletClass）；beta+ 维持 Minecraft 主类直启。
   */
  private resolveIndevMainClass(json: VersionJson): VersionJson {
    if (json.betacraft?.launchMethod !== 'indev') return json;
    if (probeIndevEntry(clientJarFile(this.root, json.id)) === 'applet') {
      return { ...json, mainClass: APPLET_LAUNCHER_CLASS };
    }
    return json;
  }

  /**
   * pre-Classic（launch-method=preclassic，rd 代 jar）的 --appletClass 显式注入：
   * rd 系 jar 仅含 RubyDung 入口，26.8 AppletLauncher 候选表两个 MinecraftApplet 名
   * 皆不存在 → main 返回、进程 code=0 静默秒退（pc-132011 实测定格；level.dat 缺失
   * 只是开局噪音，注入后窗口与游戏循环正常）。探测失败 = 不注入（维持可见失败，
   * probeIndevEntry 同纪律）。
   * 已知不修（用户拍板，视为 Pre-Classic 特色）：rd 窗口内容 LWJGL Display 右下偏移。
   */
  private resolvePreclassicAppletClass(json: VersionJson): string | undefined {
    if (json.betacraft?.launchMethod !== 'preclassic') return undefined;
    return probePreclassicEntry(clientJarFile(this.root, json.id)) ?? undefined;
  }

  /** 真实 betacraft .info 不含 agentMount——并入 Attic 自带决策表（数据，非代码）。 */
  private withAgentMounts(json: VersionJson): VersionJson {
    if (json.betacraft?.agentMount) return json;
    return { ...json, betacraft: { ...json.betacraft, agentMount: DEFAULT_AGENT_MOUNTS } };
  }

  async dryRunLaunch(request: LaunchRequest): Promise<LaunchConfig> {
    const json = this.resolveIndevMainClass(await this.getVersionJson(request.versionId));
    const context = await this.buildContext(request);
    context.appletClass = this.resolvePreclassicAppletClass(json);
    return assembleLaunchConfig(json, context, {
      extraJvmArgs: request.extraJvmArgs,
      gameParams: request.gameParams,
    });
  }

  async launch(request: LaunchRequest): Promise<GameSession> {
    try {
      if (this.processes.running) throw new Error('游戏进程已在运行');
      // v1 语义（InstanceSettings.java L556）：选中版本写回实例属性——同实例切版本 gameDir 不变、存档共享。
      // 时序前移（2026-10-21 修复「点启动后实例列表迟迟不出现」）：建档+回写必须落在 launch 的
      // **首个 await 之前的同步段**——UI 在发起 launch IPC 后立即重拉实例清单，Electron IPC 消息
      // FIFO 保证本同步段先于清单 IPC 执行，新实例点击即得见；旧时序里回写在全部下载/启动之后，
      // 列表要等游戏真起来才动。
      this.persistInstanceVersion(request);
      // 设置页开关的消费点（properties 三态：缺键=缺省开/关按各键注释）
      const settings = loadSettings(this.root);
      // 实例「强制更新」（v1 Launcher.forceUpdate 语义，Attic 实例化）：旁路 jar/库/资产的
      // 「已存在即复用」检查重下。.info 的 custom 豁免不动（v1 同义：用户所有的配置不被覆盖）。
      const forceUpdate = this.resolveInstance(request.instanceId ?? DEFAULT_INSTANCE_NAME).forceUpdate === true;
      let json = await this.refreshVersionInfo(request.versionId);
      // mod 判型（`.info` base-version 键，v1 readyVersion 语义）：libraries/jar/资产口径全部
      // 跟随基座——mod `.info` 只有 url/sha1/base-version，没有可独立启动的元数据。
      const baseId = isModVersionJson(json);
      const metaJson = baseId ? await this.refreshVersionInfo(baseId) : json;
      if (baseId && isModVersionJson(metaJson)) {
        throw new Error(`Mod ${json.id} 的基座 ${baseId} 本身也是 mod（v1 getReleaseByName 递归语义），一期不支持嵌套 mod`);
      }
      // BC `.info` 无 libraries → 从 Mojang 重发布 JSON 回填库池（classic 等不在清单：BC jar 自捆绑依赖，静默跳过）。
      if (!metaJson.libraries || metaJson.libraries.length === 0) {
        try {
          metaJson.libraries = await this.client.fetchMojangLibraries(metaJson.id, this.platform);
        } catch {
          /* 无重发布数据 */
        }
      }
      // 裸 jar custom 合成元数据无下载地址：jar 本体已在位，跳过下载（v1 downloadJson 豁免）。
      // mod 通道的 versions/<id>.jar 是合成产物，不走本下载（基座 jar 由 metaJson 走齐）。
      if (metaJson.jar?.url || metaJson.downloads?.client?.url) {
        await this.client.downloadClientJar(metaJson, this.root, {
          verify: settings['checkIntegrity'] !== 'false',
          repair: settings['fixMissing'] !== 'false',
          force: forceUpdate,
        });
      }
      if (baseId) {
        // v1 readyVersion + assembleWithBaseVersion 一期复刻（用户拍板「每次启动重合成」——
        // 修 v1 hasJar 判定的陈旧合成 jar 失配）：mod jar 补全（sha1 强制）→ 基座在前、mod 同名
        // 覆盖、剥签名 → 原子落 versions/<id>.jar（launch.ts classpath[0] 天然命中，组装面不动）。
        const modJar = await this.client.ensureModJar(json, this.root, {
          verify: settings['checkIntegrity'] !== 'false',
          force: forceUpdate,
        });
        composeModJars(clientJarFile(this.root, baseId), modJar, clientJarFile(this.root, json.id));
        // 字段继承：mod 自带键胜出，缺失回落基座（mainClass/assets/betacraft.launchMethod 等；
        // betacraft 段显式合并——spread 整段覆盖会把基座 launchMethod 弄丢，agentMount 区间判定
        // 与 Applet 容器路径都靠它）。
        json = {
          ...metaJson,
          ...json,
          betacraft: { ...metaJson.betacraft, ...json.betacraft },
        };
      }
      json = this.resolveIndevMainClass(json);
      await this.client.downloadLibrariesToBin(json, this.root, { force: forceUpdate });
      this.extractNatives();
      // 资产补全（v2 语义）：索引 + objects 全体由启动器预置——legacyfix 只自动补 custom 段，
      // objects 缺失即游戏内 CodecJOrbis/OpenAL 声音 NPE（用户实测 c0.0.22a）。
      const assetIndexId = await this.client.downloadAssetIndex(json, this.root, { force: forceUpdate });
      if (assetIndexId) await this.client.downloadAssetObjects(this.root, assetIndexId, { force: forceUpdate });

      const context = await this.buildContext(request);
      context.appletClass = this.resolvePreclassicAppletClass(json);
      const config = assembleLaunchConfig(json, context, {
        extraJvmArgs: request.extraJvmArgs,
        gameParams: request.gameParams,
      });

      // agentMount 落位：javaagent/Applet 容器需要 jar 本体在位；coremod/mod 复制进游戏目录。
      for (const mount of config.agentMount) {
        const source = await this.client.ensureLegacyfix(this.root, mount.path);
        if (mount.form === 'javaagent') continue;
        const targetDir = path.join(context.gameDir, mount.form === 'coremod' ? 'coremods' : 'mods');
        fs.mkdirSync(targetDir, { recursive: true });
        fs.copyFileSync(source, path.join(targetDir, path.basename(mount.path)));
      }

      fs.mkdirSync(context.gameDir, { recursive: true });
      const session = this.processes.start(config, request.versionId);
      // 日志落盘：testLaunch 恒写；普通启动受「诊断日志」开关（diagnosticLog=true 全量落盘）
      if (request.testLaunch || settings['diagnosticLog'] === 'true') {
        this.attachLaunchLog(
          request.versionId,
          config,
          session,
          request.testLaunch ? 'test-launch' : 'launch',
          context.accessToken,
        );
      }
      this.lastLaunchError = null;
      return session;
    } catch (error) {
      this.lastLaunchError = messageOf(error);
      throw error;
    }
  }

  async kill(): Promise<GameExit> {
    return this.processes.kill();
  }

  status(): GameStatus {
    const status = this.processes.status();
    return { ...status, lastError: status.lastError ?? this.lastLaunchError };
  }

  async detectJava(): Promise<JavaDetectionReport> {
    const settings = loadSettings(this.root);
    return detectJavaRuntime({ manualPaths: this.manualJavaPaths(settings) });
  }

  async listAccounts(): Promise<AccountView[]> {
    return this.currentAccounts().map(toAccountView);
  }

  /**
   * 添加离线账户：MC 用户名规则（3-16 位字母/数字/下划线，BlockHelm AccountNameValidator 同款）；
   * 同名幂等返回既有账户（不重复建档）。微软账户无此通道（占位，登录流程未实现）。
   */
  addAccount(name: string): AccountView {
    const trimmed = name.trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(trimmed)) {
      throw new Error(`无效用户名（需 3-16 位字母/数字/下划线）：${name}`);
    }
    const stored = loadAccounts(this.root);
    const existing = stored.find((a) => a.name === trimmed);
    if (existing) return toAccountView(existing);
    const account: OfflineAccount = { id: offlineUuid(trimmed), name: trimmed, type: 'offline' };
    saveAccounts(this.root, [...stored, account]);
    return toAccountView(account);
  }

  /** 移除账户（按 id）；可移除至空，无默认账户回落。 */
  removeAccount(id: string): void {
    saveAccounts(this.root, loadAccounts(this.root).filter((a) => a.id !== id));
  }

  /**
   * 重命名离线账户（BlockHelm RenameAccount 对话框同款语义）：MC 用户名规则校验；
   * 与他名冲突报错、同名幂等；离线 UUID 随用户名重生成（id 即新 UUID，与 addAccount 派生一致）。
   * 微软账户名由档案决定，不支持重命名。
   */
  renameAccount(id: string, name: string): AccountView {
    const trimmed = name.trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(trimmed)) {
      throw new Error(`无效用户名（需 3-16 位字母/数字/下划线）：${name}`);
    }
    const stored = loadAccounts(this.root);
    const account = stored.find((a) => a.id === id);
    if (!account) throw new Error(`账户不存在：${id}`);
    if (account.type !== 'offline') throw new Error('仅离线账户支持重命名');
    if (account.name === trimmed) return toAccountView(account);
    if (stored.some((a) => a.name === trimmed)) throw new Error(`用户名已存在：${trimmed}`);
    const renamed: OfflineAccount = { ...account, name: trimmed, id: offlineUuid(trimmed) };
    saveAccounts(this.root, stored.map((a) => (a.id === id ? renamed : a)));
    return toAccountView(renamed);
  }

  // ---------- 自定义版本配置页（CUSTOM_* 四通道） ----------

  /**
   * 自定义版本列表：custom 项 + Mods 仓库托管项（用户拍板：mod 的删除途径 = 本页，
   * 故 .info 含 base-version 的模组版本也落入，打 mod 标、编辑禁用）——
   * `.info` custom=true = 已配置；裸 jar（有 jar 无 .info 且不在官方清单）= 未配置。
   * Betacraft 官方版本不落入本页：含 .info 无 custom=true/base-version 的，也含 **官方清单 id 的裸 jar**
   * （inf-20100227-1433 实案修复：BC 版本地 .info 缺失 ≠ 用户导入）。官方集取版本清单缓存
   * （仅 fetchVersionList 成功时写入=纯 BC 列表；缓存缺席=还没联网拉过，维持 v1 裸 jar 语义）。
   * 列表不跑 jar 检测（zip 开销留给按需 get）。
   */
  listCustomVersions(): CustomVersionView[] {
    const jars = new Set(scanInstalledJars(this.root));
    const infos = scanInstalledInfos(this.root);
    const official = this.cachedOfficialVersionIds();
    const out: CustomVersionView[] = [];
    for (const id of infos) {
      // 官方清单命中即官方（> 本地 custom=true 残留声明，inf-20100227-1433 实案）
      if (official.has(id)) continue;
      const props = readPropertiesFile(infoFile(this.root, id));
      const isMod = Boolean(props['base-version']?.trim());
      if (!isMod && props['custom']?.toLowerCase() !== 'true') continue;
      const launchMethod = props['launch-method'];
      const mainClass = props['main-class'] ?? (launchMethod ? LAUNCH_METHOD_MAIN_CLASS[launchMethod] : undefined);
      out.push({
        id,
        installed: jars.has(id),
        configured: true,
        ...(isMod ? { mod: true } : {}),
        ...(launchMethod ? { launchMethod } : {}),
        ...(mainClass ? { mainClass } : {}),
      });
    }
    const withInfo = new Set(infos);
    for (const id of jars) {
      if (withInfo.has(id) || official.has(id)) continue;
      out.push({ id, installed: true, configured: false });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  /** 版本清单缓存的 id 集（=Betacraft 官方全集；缓存缺席回空集）。 */
  private cachedOfficialVersionIds(): Set<string> {
    const cache = readJsonIfPresent<VersionManifest>(versionListCacheFile(this.root));
    return new Set((cache?.versions ?? []).map((ref) => ref.id));
  }

  /** CUSTOM get/save 统一门禁：官方清单命中即官方（> 本地 custom=true 残留声明），显式拒绝。 */
  private assertNotOfficialId(id: string): void {
    if (this.cachedOfficialVersionIds().has(id)) {
      throw new Error(`${id} 是 Betacraft 官方版本 id，不落入自定义版本配置（本地残留的 custom=true 声明已失效）`);
    }
  }

  /** 读取单个自定义版本 .info：已配置回原始属性；未配置裸 jar 附 detectLaunchMethod 建议。 */
  getCustomVersionInfo(id: string): CustomInfoView {
    assertSafeVersionId(id);
    this.assertNotOfficialId(id);
    const jar = clientJarFile(this.root, id);
    const info = infoFile(this.root, id);
    const hasJar = fs.existsSync(jar);
    const hasInfo = fs.existsSync(info);
    if (!hasJar && !hasInfo) throw new Error(`自定义版本不存在：${id}`);
    const launchMethods = Object.keys(LAUNCH_METHOD_MAIN_CLASS);
    if (hasInfo) {
      const props = readPropertiesFile(info);
      // mod 的 .info 无 custom=true（base-version 判型）：可查看不可编辑（右栏据此走只读态）
      const isMod = Boolean(props['base-version']?.trim());
      if (!isMod && props['custom']?.toLowerCase() !== 'true') {
        throw new Error(`${id} 不是自定义版本（Betacraft 官方版本不落入本页）`);
      }
      return { id, configured: true, props, launchMethods, ...(isMod ? { mod: true } : {}) };
    }
    // 预填建议：归一后仍不在主类表内的（'custom' 全不中、'1.6' 超 BC 清单范围）不给——
    // 保证 UI 下拉必命中，不会预填一个存不进去的名字。
    const detected = canonicalLaunchMethod(detectLaunchMethod(jar));
    return {
      id,
      configured: false,
      props: {},
      ...(LAUNCH_METHOD_MAIN_CLASS[detected] ? { detectedMethod: detected } : {}),
      launchMethods,
    };
  }

  /**
   * 保存自定义版本 .info：launch-method 必填；其余字段选填（留空落盘为 `key=` 空值段，不删键）；
   * 强制 custom=true（归本启动器所有，豁免远端重写）；
   * launch-method 不在主类数据表内时必须显式给 main-class（未映射=主类空，Error 7 语义显式报错）。
   */
  saveCustomVersionInfo(id: string, props: Record<string, string>): CustomVersionView {
    assertSafeVersionId(id);
    this.assertNotOfficialId(id);
    const jar = clientJarFile(this.root, id);
    const info = infoFile(this.root, id);
    if (!fs.existsSync(jar) && !fs.existsSync(info)) throw new Error(`自定义版本不存在：${id}`);
    // mod 的 .info 由 Mods 仓库托管（autoupdate 会整文件重写，编辑必丢）：显式拒绝，删除不受限
    if (fs.existsSync(info) && readPropertiesFile(info)['base-version']?.trim()) {
      throw new Error(`${id} 是 Mods 仓库托管的模组版本：编辑已禁用（删除可在本页执行）`);
    }
    // base-version = mod 判型托管键：禁经编辑器写入——误填会把普通自定义版本永久打成 Mod 只读态，
    // 且启动期按 mod 合成链处理必缺料（v1 同款键，非用户可配置面）。
    if (props['base-version']?.trim()) {
      throw new Error('base-version 是 Mods 仓库托管键，不能经编辑器写入');
    }
    const launchMethod = props['launch-method']?.trim();
    const mainClass = props['main-class']?.trim();
    if (!launchMethod) throw new Error('launch-method 为必填项');
    if (!(launchMethod in LAUNCH_METHOD_MAIN_CLASS) && !mainClass) {
      throw new Error(`未知 launch-method「${launchMethod}」（主类表无映射，且未显式提供 main-class）`);
    }
    const toWrite: Record<string, string> = {};
    for (const [rawKey, rawValue] of Object.entries(props)) {
      const key = rawKey.trim();
      if (key === '' || key === 'custom') continue; // custom 由启动器强制写
      toWrite[key] = rawValue == null ? '' : String(rawValue); // 选填留空=写 `key=`
    }
    toWrite['custom'] = 'true';
    writePropertiesFile(info, toWrite);
    return {
      id,
      installed: fs.existsSync(jar),
      configured: true,
      launchMethod,
      ...(mainClass || LAUNCH_METHOD_MAIN_CLASS[launchMethod]
        ? { mainClass: mainClass || LAUNCH_METHOD_MAIN_CLASS[launchMethod] }
        : {}),
    };
  }

  /** 导入自定义版本 jar：复制为 versions/<id>.jar（id=文件名去扩展名；同名报错不覆盖）；落裸 jar=未配置态。 */
  importCustomJar(srcPath: string): CustomVersionView {
    if (!fs.existsSync(srcPath)) throw new Error(`文件不存在：${srcPath}`);
    const ext = path.extname(srcPath).toLowerCase();
    if (ext !== '.jar' && ext !== '.zip') throw new Error('仅支持 .jar / .zip 客户端包');
    const id = path.basename(srcPath, path.extname(srcPath));
    assertSafeVersionId(id);
    const target = clientJarFile(this.root, id);
    if (fs.existsSync(target)) throw new Error(`已存在同名版本 jar：${id}`);
    // 官方清单 id 拒绝导入（inf-20100227-1433 事故的源头封堵）：BC 版本走正常下载/启动链路，
    // 导成裸 jar 只会得到无元数据的残缺本地版。
    if (this.cachedOfficialVersionIds().has(id)) {
      throw new Error(`${id} 是 Betacraft 官方版本 id，不能作为自定义版本导入（启动页直接选择该版本即可）`);
    }
    fs.copyFileSync(srcPath, target);
    const info = infoFile(this.root, id);
    const configured =
      fs.existsSync(info) && readPropertiesFile(info)['custom']?.toLowerCase() === 'true';
    return { id, installed: true, configured };
  }

  /**
   * 删除自定义版本：versions/<id>.jar 与 versions/jsons/<id>.info 一并移除（缺哪个跳哪个）；
   * mod 项联动清 launcher/mods.json 登记（防幽灵条目：登记在 = 启动期仍会按登记 URL 复活 .info）。
   * 门禁 = listCustomVersions 成员判定（与列表页同源）：官方版本（.info 无 custom=true/base-version）拒绝，
   * 从入口排除误删 BC 文件；不存在/非 custom 均显式报错。
   */
  removeCustomVersion(id: string): void {
    assertSafeVersionId(id);
    if (!this.listCustomVersions().some((v) => v.id === id)) {
      throw new Error(`${id} 不是自定义版本（不存在，或为 Betacraft 官方版本不可删除）`);
    }
    fs.rmSync(clientJarFile(this.root, id), { force: true });
    fs.rmSync(infoFile(this.root, id), { force: true });
    removeModRegistry(this.root, id);
  }

  // ---------- Mods 页（MODS_* 两通道；Betacraft 单源，一期不引入多源） ----------

  /**
   * 仓库列表 = 每次调用现拉（v1 ModsRepository「进程级追加不清空、永不刷新」的结构性修复——
   * 无进程内缓存）。installed = versions/jsons/<full_name>.info 在位；上游脏 id（路径穿越等）
   * 不触文件系统，按未安装处理。
   */
  async listMods(): Promise<ModCategoryView[]> {
    const categories = await this.client.fetchModCategories();
    return categories.map((cat) => ({
      name: cat.name,
      mods: cat.mods.map((mod) => ({ ...mod, installed: this.modInfoPresent(mod.fullName) })),
    }));
  }

  private modInfoPresent(fullName: string): boolean {
    try {
      assertSafeVersionId(fullName);
    } catch {
      return false;
    }
    return fs.existsSync(infoFile(this.root, fullName));
  }

  /**
   * 安装 = 只下 .info（jar 在启动期补全；用户拍板「只安装不动实例」——v1 Load 顺带写
   * currentInstance.version 的行为不照抄）。门禁三道：id 安全、http(s) 协议白名单、同名拒绝
   * （用户拍板：先 await listVersions 尝试刷新官方清单缓存，官方清单命中即拒，网络失败按现有缓存判）。
   * 落位后写 launcher/mods.json 登记 {infoUrl, autoupdate}——启动期刷新的唯一来源（v1 离线
   * 误路由官方 URL 的修复）；.info watcher 会自动发 CUSTOM_INFO_CHANGED，无需新增事件。
   */
  async installMod(request: ModInstallRequest): Promise<void> {
    const id = request.fullName.trim();
    assertSafeVersionId(id);
    const infoFileUrl = request.infoFileUrl.trim();
    let url: URL;
    try {
      url = new URL(infoFileUrl);
    } catch {
      throw new Error(`.info 下载地址不是合法 URL：${infoFileUrl}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`拒绝非 HTTP(S) 下载地址：${url.protocol}`);
    }
    try {
      await this.listVersions(); // 尽力刷新官方清单缓存（成功即最新）
    } catch {
      /* 网络失败：按现有缓存判定 */
    }
    if (this.cachedOfficialVersionIds().has(id)) {
      throw new Error(`${id} 与 Betacraft 官方版本同名，拒绝安装（.info/jar 会覆盖官方版本文件）`);
    }
    await downloadInfoAtomic(this.client, this.root, id, infoFileUrl);
    upsertModRegistry(this.root, id, {
      infoUrl: infoFileUrl,
      autoupdate: request.autoupdate === true,
      installedAt: Date.now(),
    });
  }

  getSettings(): AppSettings {
    return settingsFromProps(loadSettings(this.root));
  }

  /** 宿主环境快照（设置页通用/内存/关于栏共用；内存取不到按 0 返回，UI 端降级）。 */
  getSystemInfo(): SystemInfo {
    return {
      launcherVersion: this.version,
      platform: this.platform,
      dataRoot: this.root,
      logsDir: path.join(launcherDir(this.root), 'logs'),
      totalMemMb: Math.round(os.totalmem() / 0x100000),
      freeMemMb: Math.round(os.freemem() / 0x100000),
    };
  }

  /** 清理 launcher/logs 下的 *.log（正在被占用的文件跳过），返回删除个数。 */
  clearLogs(): number {
    const dir = path.join(launcherDir(this.root), 'logs');
    let removed = 0;
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return 0; // 目录不存在 = 无日志可清
    }
    for (const file of entries) {
      if (!file.endsWith('.log')) continue;
      try {
        fs.rmSync(path.join(dir, file));
        removed++;
      } catch {
        /* 文件被句柄占用（如诊断日志仍在写）：跳过不阻断 */
      }
    }
    return removed;
  }

  /** 合并落盘（未知键保留），返回保存后的视图。端点改动下次启动应用生效。 */
  setSettings(settings: AppSettings): AppSettings {
    saveSettings(this.root, applySettingsToProps(loadSettings(this.root), settings));
    return this.getSettings();
  }

  listInstances(): InstanceView[] {
    const out: InstanceView[] = [];
    for (const name of listInstances(this.root)) {
      const config = loadInstance(this.root, name);
      if (config) out.push(instanceViewFromConfig(config));
    }
    return out;
  }

  /** v1 Instance Settings 可编辑集全量落盘；gameDir 缺省派生 root/<实例名>，已存在实例保留其落位。 */
  saveInstance(view: InstanceView): InstanceView {
    const existing = loadInstance(this.root, view.name);
    saveInstance(this.root, {
      name: view.name,
      version: view.version,
      gameDir: view.gameDir ?? existing?.gameDir ?? path.join(this.root, view.name),
      launchArgs: view.launchArgs,
      width: view.width,
      height: view.height,
      javaPath: view.javaPath,
      // v1 `addons` 键 = 逗号分隔；[] → 空串 = 显式全关（区别于无键的 legacyfix 缺省）
      addons: view.addons?.join(','),
      // v1 同名键 intelFix（缺键 = v1 缺省 true，视图 undefined 不落键）；forceUpdate = Attic 扩展键
      intelFix: view.intelFix,
      forceUpdate: view.forceUpdate,
    });
    return view;
  }

  /** 删除实例薄档案；withFiles=true 连实例目录一并删（护栏见 storage.deleteInstance）。
   * 档案不存在 = 显式报错（可见失败纪律）。 */
  deleteInstance(name: string, withFiles: boolean): void {
    if (!deleteInstance(this.root, name, withFiles)) throw new Error(`实例不存在：${name}`);
  }

  /** 改实例名（v1 语义：档案迁移，gameDir 原样带走不动目录）。返回改名后的权威视图。 */
  renameInstance(name: string, newName: string): InstanceView {
    return instanceViewFromConfig(renameInstance(this.root, name, newName));
  }

  /** 实例 gameDir（档案缺失按契约缺省 root/<实例名>，供宿主打开目录）。 */
  instanceGameDir(name: string): string {
    return loadInstance(this.root, name)?.gameDir ?? path.join(this.root, name);
  }

  // ---------- 内部编排 ----------

  /** 实例解析（v1 Instance.newInstance 语义）：不存在则按缺省建档（gameDir=root/<实例名>）。 */
  private resolveInstance(name: string): InstanceConfig {
    const loaded = loadInstance(this.root, name);
    if (loaded) return loaded;
    // v1 Instance.newInstance 缺省集：launchArgs/-Xmx1G、854x480（与 loadInstance 补底一致）
    const fresh: InstanceConfig = {
      name,
      version: 'b1.7.3',
      gameDir: path.join(this.root, name),
      launchArgs: '-Xmx1G',
      width: 854,
      height: 480,
    };
    saveInstance(this.root, fresh);
    return fresh;
  }

  /** 选中版本写回实例（幂等：同版本不重写文件）。 */
  private persistInstanceVersion(request: LaunchRequest): void {
    const config = this.resolveInstance(request.instanceId ?? DEFAULT_INSTANCE_NAME);
    if (config.version === request.versionId) return;
    saveInstance(this.root, { ...config, version: request.versionId });
  }

  /**
   * 启动日志（testLaunch ≡ 菜单语义 + diagnosticLog 开关的普通启动共用）：启动器侧头行
   * （时间戳/版本/命令行——token 已脱敏）+ 游戏 stdout/stderr 全量 + 退出行，
   * 逐行落盘 `<root>/launcher/logs/<prefix>-<ISO>.log`。
   * 控制台窗口唤起归 UI 侧（WINDOW_CONSOLE），runtime 不触窗；落盘失败静默（不阻断启动）。
   */
  private attachLaunchLog(
    versionId: string,
    config: LaunchConfig,
    session: GameSession,
    prefix: 'test-launch' | 'launch',
    accessToken?: string,
  ): void {
    const logsDir = path.join(launcherDir(this.root), 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    // Windows 文件名禁冒点：ISO 串统一替换。
    const file = path.join(logsDir, `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
    const write = (line: string): void => {
      try {
        fs.appendFileSync(file, `${line}\n`, 'utf8');
      } catch {
        /* 磁盘异常不影响游戏进程 */
      }
    };
    const at = (): string => new Date().toISOString().slice(11, 23);
    const censor = (line: string): string => maskSecrets(line, accessToken);
    write(`# Attic ${prefix} ${versionId} pid=${session.pid} ${new Date().toISOString()}`);
    write(`# java=${config.javaPath}`);
    write(`# gameDir=${config.gameDir}`);
    write(censor(`# command="${config.javaPath}" ${config.jvmArgs.join(' ')} -cp "${config.classpath.join(path.delimiter)}" ${config.mainClass} ${config.gameArgs.join(' ')}`));
    const offOutput = this.on(IPC_EVENTS.GAME_OUTPUT, (event) => {
      write(censor(`[${at()}] [${event.stream}] ${event.chunk.trimEnd()}`));
    });
    const offExit = this.on(IPC_EVENTS.GAME_EXIT, (event) => {
      write(`[${at()}] === exit code=${event.code} signal=${event.signal} crash=${event.crash?.category ?? 'none'} ===`);
      offOutput();
      offExit();
    });
  }

  private currentAccounts(): Account[] {
    // 无默认账户回落：首启/移除至空后恒为空列表，启动由 UI 侧禁用（需先手动添加账户）。
    return loadAccounts(this.root);
  }

  private manualJavaPaths(settings: Record<string, string>): string[] {
    const paths: string[] = [];
    if (settings['javaPath']) paths.push(settings['javaPath']);
    // Zulu 自动供给落位的 JDK 也进手动候选。
    try {
      for (const entry of fs.readdirSync(zuluJavaDir(this.root))) {
        paths.push(path.join(zuluJavaDir(this.root), entry));
      }
    } catch {
      /* 未装过 Zulu */
    }
    return paths;
  }

  /** agentMount 区间判定序：按编译日期升序（实测 version_list.txt 是乱序手工清单，不可当年代序用）。 */
  private cachedVersionOrder(): string[] {
    const cache = readJsonIfPresent<VersionManifest>(versionListCacheFile(this.root));
    const refs = cache?.versions ?? [];
    const dateOf = (ref: VersionRef): number => ref.compileDate ?? ref.releaseDate ?? Number.POSITIVE_INFINITY;
    return [...refs].sort((a, b) => dateOf(a) - dateOf(b)).map((ref) => ref.id);
  }

  private async buildContext(request: LaunchRequest): Promise<LaunchContext> {
    const settings = loadSettings(this.root);
    const accounts = this.currentAccounts();
    const account = request.accountId ? accounts.find((a) => a.id === request.accountId) : accounts[0];
    if (!account) throw new Error('无可用账户，请先在账户页添加账户');

    const javaPath = request.javaPath ?? settings['javaPath'] ?? (await this.ensureJavaPath(settings));
    // 内存三级优先：请求覆盖 > memoryMode=auto 宿主估算（总内存 40% 夹 [512,2048]）> 定值 > 1024 兜底
    const memory = Number(settings['maxMemoryMb']);
    const maxMemoryMb =
      request.maxMemoryMb ??
      (settings['memoryMode'] === 'auto'
        ? estimateMaxMemoryMb(Math.round(os.totalmem() / 0x100000))
        : Number.isFinite(memory) && memory > 0
          ? memory
          : 1024);

    const instance = this.resolveInstance(request.instanceId ?? DEFAULT_INSTANCE_NAME);

    return {
      javaPath,
      // v1 惯例（Instance.newInstance）：gameDir = 数据根/<实例名>，版本是实例属性、不参与目录派生。
      gameDir: instance.gameDir,
      launchArgs: instance.launchArgs,
      // 全局 JVM 参数（设置页「全局 JVM 参数」）：注入在实例参数之前（后者胜，实例可覆盖）
      globalJvmArgs: settings['jvmArgs'],
      // 档案 addons 逗号串 → 数组透传（undefined 保持 = 老档案零注入；空串 = 显式全关）
      addons: instance.addons?.split(',').map((s) => s.trim()).filter(Boolean),
      // v1 intelFix 缺键 = true（Instance.java newInstance 缺省）；win32 门控在此（launch.ts 保持平台中性）
      intelFix: this.platform === 'win32' && instance.intelFix !== false,
      // 一次性可视化器（「≡」菜单动作项）：true 才带键，false/缺省不落（dryRun/launch 同走此路）
      visualizer: request.visualizer === true ? true : undefined,
      width: instance.width,
      height: instance.height,
      assetsDir: path.join(this.root, 'assets'),
      dataDir: this.root,
      username: account.name,
      uuid: account.id,
      accessToken: account.type === 'microsoft' ? account.accessToken : '0',
      maxMemoryMb,
      binPool: scanBinPool(this.root),
      versionOrder: this.cachedVersionOrder(),
      levelServer: settings['levelServer'],
    };
  }

  /** bin/ 库池里的 `*-natives-<os>.jar` 解到 bin/natives（LWJGL2/JInput 原生库落盘）。 */
  private extractNatives(): void {
    const os = this.platform === 'win32' ? 'windows' : this.platform === 'darwin' ? 'osx' : 'linux';
    const suffix = `-natives-${os}.jar`;
    let files: string[];
    try {
      files = fs.readdirSync(binDir(this.root));
    } catch {
      return;
    }
    for (const file of files) {
      if (!file.endsWith(suffix)) continue;
      extractZipTo(path.join(binDir(this.root), file), nativesDir(this.root));
    }
  }

  /** 探测 → 没有则 Zulu 自动供给（失败抛全因，手动导入兜底，风险 #7）。 */
  private async ensureJavaPath(settings: Record<string, string>): Promise<string> {
    const report = await detectJavaRuntime({ manualPaths: this.manualJavaPaths(settings) });
    if (report.selection.install) return report.selection.install.executable;

    try {
      const pkgs = await queryZuluPackages(8, this.endpoints, this.fetchImpl, process.platform, process.arch);
      const pkg = pkgs[0];
      if (!pkg) throw new Error('Zulu 归档无匹配包');
      const outcome = await installZuluPackage(pkg, zuluJavaDir(this.root), { client: this.client });
      if (!outcome.ok || !outcome.javaPath) throw new Error(outcome.reason ?? 'Zulu 安装失败');
      return outcome.javaPath;
    } catch (error) {
      throw new Error(
        `未找到 Java 8：${report.selection.reason}；自动供给失败：${messageOf(error)}；请在设置中手动导入 Java 路径`,
      );
    }
  }
}
