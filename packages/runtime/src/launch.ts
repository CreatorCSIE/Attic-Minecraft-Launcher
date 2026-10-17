/**
 * LaunchConfig 拼装器（契约 §2.6 固定组顺序 + 6 条不变量，由 core-spec 夹具固化）。
 * 路径一律正斜杠字符串拼接——夹具是中性 POSIX 风格，拼装不得有平台假设。
 */

import type { AgentMount, LaunchConfig, VersionJson } from '@attic/core-spec';

/** 拼装输入：宿主侧运行上下文（binPool/versionOrder 由运行时注入，见 contract.md §4）。 */
export interface LaunchContext {
  javaPath: string;
  gameDir: string;
  assetsDir: string;
  dataDir: string;
  username: string;
  uuid: string;
  accessToken: string;
  maxMemoryMb: number;
  minMemoryMb?: number;
  /** `<root>/bin/*.jar` 库池绝对路径清单。 */
  binPool: string[];
  /** 年代序（编译日期升序）的版本 id 数组（agentMount 区间判定用；上游清单行序不可当年代序用）。 */
  versionOrder: string[];
  /** LegacyFix 关卡存档模式（`lf.proxy.levelServer`）：'local'/URL；缺省=LegacyFix 一次性对话框。 */
  levelServer?: string;
  /** 实例 JVM 参数（v1 launchArgs，如 `-Xmx1G`），空白分隔注入 jvmArgs。 */
  launchArgs?: string;
  /** 窗口尺寸（Applet 容器 `--width/--height` 游戏参数；v1 缺省 854x480）。 */
  width?: number;
  height?: number;
}

export interface AssembleOptions {
  extraJvmArgs?: string[];
  gameParams?: Record<string, string>;
  onDiagnostic?: (message: string) => void;
}

const NON_PROXY_HOSTS = 'api.betacraft.uk|files.betacraft.uk|checkip.amazonaws.com';

/** Applet 容器主类（legacyfix）：需要把 javaagent 形态的 jar 本体也送上 classpath。 */
export const APPLET_LAUNCHER_CLASS = 'uk.betacraft.legacyfix.applet.AppletLauncher';

function indexOfOr(list: string[], value: string, fallback: number): number {
  const idx = list.indexOf(value);
  return idx === -1 ? fallback : idx;
}

/**
 * 区间过滤（判定 id：清单序含 id 用 id，否则用 baseVersion）。
 * 判定失败（都不在序中）→ 全保留 + 诊断（fail-open：宁多挂不错挂——legacyfix 挂载本身幂等）。
 */
export function filterAgentMounts(
  mounts: AgentMount[],
  id: string,
  versionOrder: string[],
  baseVersion?: string,
  onDiagnostic?: (message: string) => void,
): AgentMount[] {
  if (mounts.length === 0) return [];
  const judgedId = versionOrder.includes(id) ? id : baseVersion;
  const idxCur = judgedId === undefined ? -1 : versionOrder.indexOf(judgedId);
  if (idxCur < 0) {
    onDiagnostic?.(`agentMount 区间判定失败：${id}（base-version：${baseVersion ?? '无'}）不在版本序中，全部挂载保留`);
    return mounts;
  }
  const last = versionOrder.length - 1;
  return mounts.filter((mount) => {
    const from = mount.appliesFrom ? indexOfOr(versionOrder, mount.appliesFrom, 0) : 0;
    const to = mount.appliesTo ? indexOfOr(versionOrder, mount.appliesTo, last) : last;
    return idxCur >= from && idxCur <= to;
  });
}

function placeholderValues(versionJson: VersionJson, context: LaunchContext): Record<string, string> {
  return {
    auth_player_name: context.username,
    auth_session: context.accessToken,
    auth_access_token: context.accessToken,
    auth_uuid: context.uuid,
    game_directory: context.gameDir,
    assets_root: context.assetsDir,
    assets_index_name: versionJson.assetIndex?.id ?? versionJson.assets ?? 'legacy',
    version_name: versionJson.id,
    version_type: versionJson.type ?? 'release',
    user_type: 'legacy',
    user_properties: '{}',
    launcher_name: 'attic-launcher',
    launcher_version: '0.0.0',
    natives_directory: `${context.dataDir}/bin/natives`,
  };
}

/** 展开 `${key}`；未知占位符原样保留（数据缺口可见，不静默吞）。 */
function expandToken(token: string, values: Record<string, string>): string {
  return token.replace(/\$\{([^}]+)\}/g, (whole, key: string) => values[key] ?? whole);
}

export function assembleLaunchConfig(
  versionJson: VersionJson,
  context: LaunchContext,
  opts: AssembleOptions = {},
): LaunchConfig {
  const dataDir = context.dataDir;
  // 主类缺失 = 数据缺口（launch-method 不在表且无显式 main-class），显式报错不静默兜底。
  const mainClass = versionJson.mainClass;
  if (!mainClass) {
    throw new Error(
      `无法确定主类：.info 无 main-class，launch-method "${versionJson.betacraft?.launchMethod ?? '(无)'}" 不在数据表中`,
    );
  }
  // Applet 容器（pre-classic/classic）：legacyfix 实测铁律（c0.0.12a 窗口事故）——
  // classpath 上有 launchwrapper 时 agent 走 LaunchWrapperInjector 提前 return，全部补丁
  // （含 proxy/game-dir/classic-resize/deawt）被跳过且帧永不显示；容器不用 tweaker，剔除即恢复全量挂载。
  // deawt 保持开启（实测窗口正常）：游戏走 LWJGL 窗口，关窗后进程 MainWindowHandle 归零，
  // 壳侧窗口看门狗据此判定"用户关窗"并 kill（classic 循环不检查 isCloseRequested，进程不自退）。
  const isAppletContainer = mainClass === APPLET_LAUNCHER_CLASS;
  const mounts = filterAgentMounts(
    versionJson.betacraft?.agentMount ?? [],
    versionJson.id,
    context.versionOrder,
    versionJson.betacraft?.baseVersion,
    opts.onDiagnostic,
  );

  // ---------- jvmArgs 固定组（顺序即契约） ----------
  const jvmArgs: string[] = [`-Xmx${context.maxMemoryMb}m`];
  if (context.minMemoryMb !== undefined) jvmArgs.push(`-Xms${context.minMemoryMb}m`);
  // v1 语义：实例 launchArgs（如 "-Xmx1G"）紧随固定 -Xmx 注入——JVM 对重复 -Xmx 取后者，实例覆盖全局。
  for (const token of (context.launchArgs ?? '').trim().split(/\s+/)) {
    if (token) jvmArgs.push(token);
  }
  jvmArgs.push('-Djava.util.Arrays.useLegacyMergeSort=true');
  jvmArgs.push(`-Dhttp.nonProxyHosts=${NON_PROXY_HOSTS}`);
  const natives = `${dataDir}/bin/natives`;
  jvmArgs.push(`-Dorg.lwjgl.librarypath=${natives}`);
  jvmArgs.push(`-Dnet.java.games.input.librarypath=${natives}`);
  for (const arg of versionJson.betacraft?.proxyArgs ?? []) jvmArgs.push(arg);
  // 属性优先于 gameDir/legacyfix/level-server.txt（LevelProxyConfig 源码实锤）：
  // 设置里有值即直通覆盖，用户无需删 txt 重触发一次性对话框；缺省不传，保留 LegacyFix 原行为。
  if (context.levelServer) jvmArgs.push(`-Dlf.proxy.levelServer=${context.levelServer}`);
  for (const mount of mounts) {
    if (mount.form === 'javaagent') jvmArgs.push(`-javaagent:${dataDir}/${mount.path}=${context.gameDir}`);
  }
  if (opts.extraJvmArgs) jvmArgs.push(...opts.extraJvmArgs);

  // ---------- classpath：版本 jar（平铺）+ bin 整池 ----------
  const binPool = isAppletContainer
    ? context.binPool.filter((jar) => !/launchwrapper[^/\\]*\.jar$/i.test(jar))
    : context.binPool;
  const classpath = [`${dataDir}/versions/${versionJson.id}.jar`, ...binPool];
  // Applet 容器（<a1.0.6）：legacyfix jar 必须同时在 classpath 上才有 AppletLauncher 类。
  if (isAppletContainer) {
    for (const mount of mounts) {
      if (mount.form === 'javaagent') classpath.push(`${dataDir}/${mount.path}`);
    }
  }

  // ---------- gameArgs ----------
  const values = placeholderValues(versionJson, context);
  let gameArgs: string[];
  const template = versionJson.minecraftArguments?.trim();
  if (template) {
    gameArgs = template.split(/\s+/).map((token) => expandToken(token, values));
  } else {
    // v1 classic/beta 位置参：username sessionid
    gameArgs = [context.username, context.accessToken];
  }
  if (opts.gameParams) {
    for (const [key, value] of Object.entries(opts.gameParams)) {
      gameArgs.push(`--${key}`, value);
    }
  }
  // Applet 容器窗口尺寸（AppletFrame.java L24-25 读 --width/--height，缺省兜底 640x480）：
  // 实例值以 v1 缺省 854x480 显式传入；非 Applet 版本窗口由 LWJGL/DeAwt 自管，不注入（避免污染主类参数解析）。
  if (isAppletContainer && context.width && context.height) {
    gameArgs.push('--width', String(context.width), '--height', String(context.height));
  }

  const config: LaunchConfig = {
    javaPath: context.javaPath,
    gameDir: context.gameDir,
    assetsDir: context.assetsDir,
    mainClass,
    classpath,
    jvmArgs,
    gameArgs,
    agentMount: mounts,
    maxMemoryMb: context.maxMemoryMb,
  };
  if (context.minMemoryMb !== undefined) config.minMemoryMb = context.minMemoryMb;
  return config;
}
