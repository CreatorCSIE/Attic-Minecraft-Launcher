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
import { infoToVersionJson } from './info';
import { detectJavaRuntime } from './java/detect';
import { APPLET_LAUNCHER_CLASS, assembleLaunchConfig, type LaunchContext } from './launch';
import { GameProcessManager } from './process';
import { parseProperties } from './properties';
import { DEFAULT_AGENT_MOUNTS } from './quirks';
import {
  binDir,
  clientJarFile,
  ensureLayout,
  infoFile,
  listInstances,
  loadAccounts,
  loadInstance,
  loadSettings,
  launcherDir,
  nativesDir,
  offlineUuid,
  readPropertiesFile,
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
  zuluJavaDir,
} from './storage';
import { detectLaunchMethod, probeIndevEntry } from './wrapperDetector';
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

    // "已安装"= jar 实存（用户指定）；jar∪info 并集仅用于离线兜底列出本地版本
    const jars = new Set(scanInstalledJars(this.root));
    const infos = new Set(scanInstalledInfos(this.root));
    const isCustom = (id: string): boolean =>
      // v1 语义（offlineVersionList）：裸 jar（有 jar 无 .info）即 custom；.info 显式声明同判
      (jars.has(id) && !infos.has(id)) ||
      (infos.has(id) && readPropertiesFile(infoFile(this.root, id))['custom']?.toLowerCase() === 'true');
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
    const method = detectLaunchMethod(jar);
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

  /** 真实 betacraft .info 不含 agentMount——并入 Attic 自带决策表（数据，非代码）。 */
  private withAgentMounts(json: VersionJson): VersionJson {
    if (json.betacraft?.agentMount) return json;
    return { ...json, betacraft: { ...json.betacraft, agentMount: DEFAULT_AGENT_MOUNTS } };
  }

  async dryRunLaunch(request: LaunchRequest): Promise<LaunchConfig> {
    const json = this.resolveIndevMainClass(await this.getVersionJson(request.versionId));
    const context = await this.buildContext(request);
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
