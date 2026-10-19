/**
 * AtticRuntime：TS 侧启动器核心门面（Electron 主进程唯一消费者）。
 * 方法面 = RendererBridge 九请求（ipc.ts）；事件面 = IPC_EVENTS 三通道。
 * 错误以异常抛出，IpcResult 封装归壳层（apps/electron/main.ts）。
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  IPC_EVENTS,
  type Account,
  type AccountView,
  type CustomInfoView,
  type CustomVersionView,
  type OfflineAccount,
  type AppSettings,
  type AtticEventPayloads,
  type DownloadProgressEvent,
  type GameExit,
  type GameSession,
  type GameStatus,
  type InstanceView,
  type JavaDetectionReport,
  type LaunchConfig,
  type LaunchRequest,
  type VersionJson,
  type VersionManifest,
  type VersionRef,
} from '@attic/core-spec';

import { applySettingsToProps, instanceViewFromConfig, settingsFromProps } from './appSettings';
import { BetacraftClient, type FetchImpl } from './betacraft';
import { endpointsFromOverrides, resolveEndpoints, type Endpoints } from './endpoints';
import { infoToVersionJson, LAUNCH_METHOD_MAIN_CLASS } from './info';
import { detectJavaRuntime } from './java/detect';
import { APPLET_LAUNCHER_CLASS, assembleLaunchConfig, type LaunchContext } from './launch';
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
import { extractZipTo } from './zip';
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
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
   * 每次启动重下 .info（v2 已知坑：元数据陈旧）；网络失败退本地。
   * v1 豁免（Launcher.java L412/L432）：custom=true 的 .info 归用户所有，跳过重下/覆盖。
   */
  private async refreshVersionInfo(versionId: string): Promise<VersionJson> {
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
      let json = await this.refreshVersionInfo(request.versionId);
      // BC `.info` 无 libraries → 从 Mojang 重发布 JSON 回填库池（classic 等不在清单：BC jar 自捆绑依赖，静默跳过）。
      if (!json.libraries || json.libraries.length === 0) {
        try {
          json.libraries = await this.client.fetchMojangLibraries(request.versionId, this.platform);
        } catch {
          /* 无重发布数据 */
        }
      }
      // 裸 jar custom 合成元数据无下载地址：jar 本体已在位，跳过下载（v1 downloadJson 豁免）
      if (json.jar?.url || json.downloads?.client?.url) await this.client.downloadClientJar(json, this.root);
      json = this.resolveIndevMainClass(json);
      await this.client.downloadLibrariesToBin(json, this.root);
      this.extractNatives();
      // 资产补全（v2 语义）：索引 + objects 全体由启动器预置——legacyfix 只自动补 custom 段，
      // objects 缺失即游戏内 CodecJOrbis/OpenAL 声音 NPE（用户实测 c0.0.22a）。
      const assetIndexId = await this.client.downloadAssetIndex(json, this.root);
      if (assetIndexId) await this.client.downloadAssetObjects(this.root, assetIndexId);

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
      if (request.testLaunch) this.attachTestLaunchLog(request.versionId, config, session);
      // v1 语义（InstanceSettings.java L556）：选中版本写回实例属性——同实例切版本 gameDir 不变、存档共享。
      this.persistInstanceVersion(request);
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
   * 自定义版本列表：仅 custom 项（与 listVersions 的 isCustom 判定同源）——
   * `.info` custom=true = 已配置；裸 jar（有 jar 无 .info 且不在官方清单）= 未配置。
   * Betacraft 官方版本不落入本页：含 .info 无 custom=true 的，也含 **官方清单 id 的裸 jar**
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
      if (props['custom']?.toLowerCase() !== 'true') continue;
      const launchMethod = props['launch-method'];
      const mainClass = props['main-class'] ?? (launchMethod ? LAUNCH_METHOD_MAIN_CLASS[launchMethod] : undefined);
      out.push({
        id,
        installed: jars.has(id),
        configured: true,
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
      if (props['custom']?.toLowerCase() !== 'true') {
        throw new Error(`${id} 不是自定义版本（Betacraft 官方版本不落入本页）`);
      }
      return { id, configured: true, props, launchMethods };
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
   * 删除自定义版本：versions/<id>.jar 与 versions/jsons/<id>.info 一并移除（缺哪个跳哪个）。
   * 门禁 = listCustomVersions 成员判定（与列表页同源）：官方版本（.info 无 custom=true）拒绝，
   * 从入口排除误删 BC 文件；不存在/非 custom 均显式报错。
   */
  removeCustomVersion(id: string): void {
    assertSafeVersionId(id);
    if (!this.listCustomVersions().some((v) => v.id === id)) {
      throw new Error(`${id} 不是自定义版本（不存在，或为 Betacraft 官方版本不可删除）`);
    }
    fs.rmSync(clientJarFile(this.root, id), { force: true });
    fs.rmSync(infoFile(this.root, id), { force: true });
  }

  getSettings(): AppSettings {
    return settingsFromProps(loadSettings(this.root));
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
   * 测试启动日志（≡ 菜单语义）：启动器侧头行（时间戳/版本/完整命令行）+ 游戏 stdout/stderr 全量
   * + 退出行，逐行落盘 `<root>/launcher/logs/test-launch-<ISO>.log`。
   * 控制台窗口唤起归 UI 侧（WINDOW_CONSOLE），runtime 不触窗；落盘失败静默（不阻断启动）。
   */
  private attachTestLaunchLog(versionId: string, config: LaunchConfig, session: GameSession): void {
    const logsDir = path.join(launcherDir(this.root), 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    // Windows 文件名禁冒点：ISO 串统一替换。
    const file = path.join(logsDir, `test-launch-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
    const write = (line: string): void => {
      try {
        fs.appendFileSync(file, `${line}\n`, 'utf8');
      } catch {
        /* 磁盘异常不影响游戏进程 */
      }
    };
    const at = (): string => new Date().toISOString().slice(11, 23);
    write(`# Attic test launch ${versionId} pid=${session.pid} ${new Date().toISOString()}`);
    write(`# java=${config.javaPath}`);
    write(`# gameDir=${config.gameDir}`);
    write(`# command="${config.javaPath}" ${config.jvmArgs.join(' ')} -cp "${config.classpath.join(path.delimiter)}" ${config.mainClass} ${config.gameArgs.join(' ')}`);
    const offOutput = this.on(IPC_EVENTS.GAME_OUTPUT, (event) => {
      write(`[${at()}] [${event.stream}] ${event.chunk.trimEnd()}`);
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
    const memory = request.maxMemoryMb ?? Number(settings['maxMemoryMb']);
    const maxMemoryMb = Number.isFinite(memory) && memory > 0 ? memory : 1024;

    const instance = this.resolveInstance(request.instanceId ?? DEFAULT_INSTANCE_NAME);

    return {
      javaPath,
      // v1 惯例（Instance.newInstance）：gameDir = 数据根/<实例名>，版本是实例属性、不参与目录派生。
      gameDir: instance.gameDir,
      launchArgs: instance.launchArgs,
      // 档案 addons 逗号串 → 数组透传（undefined 保持 = 老档案零注入；空串 = 显式全关）
      addons: instance.addons?.split(',').map((s) => s.trim()).filter(Boolean),
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
