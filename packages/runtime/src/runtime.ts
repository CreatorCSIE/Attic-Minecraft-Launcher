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
import { infoToVersionJson } from './info';
import { detectJavaRuntime } from './java/detect';
import { assembleLaunchConfig, type LaunchContext } from './launch';
import { GameProcessManager } from './process';
import { parseProperties } from './properties';
import { DEFAULT_AGENT_MOUNTS } from './quirks';
import {
  binDir,
  defaultOfflineAccount,
  ensureLayout,
  infoFile,
  listInstances,
  loadAccounts,
  loadInstance,
  loadSettings,
  launcherDir,
  nativesDir,
  resolveDataRoot,
  saveInstance,
  saveSettings,
  scanBinPool,
  scanInstalledVersions,
  type InstanceConfig,
  versionListCacheFile,
  zuluJavaDir,
} from './storage';
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

export class AtticRuntime {
  readonly root: string;
  readonly endpoints: Endpoints;
  private readonly platform: NodeJS.Platform;
  private readonly fetchImpl: FetchImpl;
  private readonly client: BetacraftClient;
  private readonly processes: GameProcessManager;
  private readonly listeners = new Map<string, Set<(payload: never) => void>>();
  private lastLaunchError: string | null = null;

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
    return () => set.delete(cb as (payload: never) => void);
  }

  private emitEvent(event: string, payload: unknown): void {
    for (const cb of this.listeners.get(event) ?? []) {
      (cb as (p: unknown) => void)(payload);
    }
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

    const installed = new Set(scanInstalledVersions(this.root));
    const out: VersionRef[] = (refs ?? []).map((ref) => ({ ...ref, installed: installed.has(ref.id) }));
    for (const id of installed) {
      if (!out.some((ref) => ref.id === id)) out.push({ id, repository: 'local', installed: true });
    }
    if (out.length === 0) throw new Error('版本清单获取失败且无本地缓存/安装');
    return out;
  }

  /** 本地 .info 优先（离线可用），缺失才下载并落盘。 */
  async getVersionJson(versionId: string): Promise<VersionJson> {
    const local = readTextIfPresent(infoFile(this.root, versionId));
    if (local !== null) return this.withAgentMounts(infoToVersionJson(versionId, parseProperties(local)));
    const text = await this.client.fetchVersionInfo(versionId);
    this.client.saveVersionInfo(this.root, versionId, text);
    return this.withAgentMounts(infoToVersionJson(versionId, parseProperties(text)));
  }

  /** 每次启动重下 .info（v2 已知坑：元数据陈旧）；网络失败退本地。 */
  private async refreshVersionInfo(versionId: string): Promise<VersionJson> {
    try {
      const text = await this.client.fetchVersionInfo(versionId);
      this.client.saveVersionInfo(this.root, versionId, text);
      return this.withAgentMounts(infoToVersionJson(versionId, parseProperties(text)));
    } catch (error) {
      const local = readTextIfPresent(infoFile(this.root, versionId));
      if (local === null) throw error;
      return this.withAgentMounts(infoToVersionJson(versionId, parseProperties(local)));
    }
  }

  /** 真实 betacraft .info 不含 agentMount——并入 Attic 自带决策表（数据，非代码）。 */
  private withAgentMounts(json: VersionJson): VersionJson {
    if (json.betacraft?.agentMount) return json;
    return { ...json, betacraft: { ...json.betacraft, agentMount: DEFAULT_AGENT_MOUNTS } };
  }

  async dryRunLaunch(request: LaunchRequest): Promise<LaunchConfig> {
    const json = await this.getVersionJson(request.versionId);
    const context = await this.buildContext(request);
    return assembleLaunchConfig(json, context, {
      extraJvmArgs: request.extraJvmArgs,
      gameParams: request.gameParams,
    });
  }

  async launch(request: LaunchRequest): Promise<GameSession> {
    try {
      if (this.processes.running) throw new Error('游戏进程已在运行');
      const json = await this.refreshVersionInfo(request.versionId);
      // BC `.info` 无 libraries → 从 Mojang 重发布 JSON 回填库池（classic 等不在清单：BC jar 自捆绑依赖，静默跳过）。
      if (!json.libraries || json.libraries.length === 0) {
        try {
          json.libraries = await this.client.fetchMojangLibraries(request.versionId, this.platform);
        } catch {
          /* 无重发布数据 */
        }
      }
      await this.client.downloadClientJar(json, this.root);
      await this.client.downloadLibrariesToBin(json, this.root);
      this.extractNatives();
      await this.client.downloadAssetIndex(json, this.root);

      const context = await this.buildContext(request);
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
    });
    return view;
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

  private currentAccounts(): Account[] {
    const accounts = loadAccounts(this.root);
    if (accounts.length > 0) return accounts;
    const settings = loadSettings(this.root);
    return [defaultOfflineAccount(settings['username'] ?? 'Player')];
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
    if (!account) throw new Error('无可用账户');

    const javaPath = request.javaPath ?? settings['javaPath'] ?? (await this.ensureJavaPath(settings));
    const memory = request.maxMemoryMb ?? Number(settings['maxMemoryMb']);
    const maxMemoryMb = Number.isFinite(memory) && memory > 0 ? memory : 1024;

    const instance = this.resolveInstance(request.instanceId ?? DEFAULT_INSTANCE_NAME);

    return {
      javaPath,
      // v1 惯例（Instance.newInstance）：gameDir = 数据根/<实例名>，版本是实例属性、不参与目录派生。
      gameDir: instance.gameDir,
      launchArgs: instance.launchArgs,
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
