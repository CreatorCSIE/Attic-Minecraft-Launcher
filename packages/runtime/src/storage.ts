/**
 * 存储层：`.attic/` 数据根（三平台路径 + portable + rootDir 可配置），
 * 内部结构与 Betacraft v1 完全一致（plan.md「数据目录布局」，取证 BC.java + Launcher.java L256-261）。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Account } from '@attic/core-spec';

import { parseProperties, serializeProperties } from './properties';

export interface ResolveDataRootOptions {
  /** 覆盖平台（测试注入），缺省 process.platform。 */
  platform?: string;
  /** 覆盖环境变量（测试注入），缺省 process.env。 */
  env?: NodeJS.ProcessEnv;
  /** portable 模式的可执行文件路径，缺省 process.execPath。 */
  execPath?: string;
  /** portable：根 = 可执行文件旁 `.attic`。 */
  portable?: boolean;
  /** rootDir 全局可配置（共存/迁移逃生舱：老用户可直接指回 .betacraft）。 */
  rootDirOverride?: string;
}

function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function resolveDataRoot(options: ResolveDataRootOptions = {}): string {
  const platform = options.platform ?? process.platform;
  if (options.rootDirOverride) return path.resolve(expandHome(options.rootDirOverride));
  const env = options.env ?? process.env;
  const execPath = options.execPath ?? process.execPath;
  // win32 路径语义固定走 path.win32：宿主为 Windows 时与 path 等价（零回归），
  // 在 POSIX 宿主上注入 win32 也能产出正确的反斜杠路径（跨平台可测，不随宿主分隔符漂移）。
  if (options.portable) {
    const p = platform === 'win32' ? path.win32 : path.posix;
    return p.join(p.dirname(execPath), '.attic');
  }
  const home = env['HOME'] ?? env['USERPROFILE'] ?? os.homedir();
  if (platform === 'win32') {
    const appData = env['APPDATA'] ?? path.win32.join(home, 'AppData', 'Roaming');
    return path.win32.join(appData, '.attic');
  }
  // POSIX 分支用 '/' 拼接：目标平台路径语义，不随宿主分隔符漂移。
  if (platform === 'darwin') return `${home}/Library/Application Support/attic`;
  return `${home}/.attic`;
}

// ---------- 布局路径（纯函数，便于测试） ----------

export const launcherDir = (root: string): string => path.join(root, 'launcher');
export const instancesDir = (root: string): string => path.join(launcherDir(root), 'instances');
export const langDir = (root: string): string => path.join(launcherDir(root), 'lang');
export const addonsDir = (root: string): string => path.join(launcherDir(root), 'addons');
export const launchMethodsDir = (root: string): string => path.join(launcherDir(root), 'launch-methods');
export const settingsFile = (root: string): string => path.join(launcherDir(root), 'launcher.settings');
export const accountsFile = (root: string): string => path.join(launcherDir(root), 'accounts.json');
export const versionListCacheFile = (root: string): string => path.join(launcherDir(root), 'version_list.json');
export const binDir = (root: string): string => path.join(root, 'bin');
export const nativesDir = (root: string): string => path.join(binDir(root), 'natives');
export const versionsDir = (root: string): string => path.join(root, 'versions');
export const jsonsDir = (root: string): string => path.join(versionsDir(root), 'jsons');
export const infoFile = (root: string, id: string): string => path.join(jsonsDir(root), `${id}.info`);
export const clientJarFile = (root: string, id: string): string => path.join(versionsDir(root), `${id}.jar`);
export const assetsDir = (root: string): string => path.join(root, 'assets');
export const assetIndexFile = (root: string, id: string): string =>
  path.join(assetsDir(root), 'indexes', `${id}.json`);
export const zuluJavaDir = (root: string): string => path.join(launcherDir(root), 'java');

/** 建目录骨架（addons 仅占位，v0 不消费机制）。幂等。 */
export function ensureLayout(root: string): void {
  for (const dir of [
    instancesDir(root),
    langDir(root),
    addonsDir(root),
    launchMethodsDir(root),
    nativesDir(root),
    jsonsDir(root),
    assetsDir(root),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ---------- properties 文件 ----------

export function readPropertiesFile(file: string): Record<string, string> {
  try {
    return parseProperties(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export function writePropertiesFile(file: string, entries: Record<string, string>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serializeProperties(entries), 'utf8');
}

export const loadSettings = (root: string): Record<string, string> => readPropertiesFile(settingsFile(root));

export const saveSettings = (root: string, settings: Record<string, string>): void =>
  writePropertiesFile(settingsFile(root), settings);

// ---------- 实例配置（键照抄 v1 Instance.java） ----------

export interface InstanceConfig {
  name: string;
  version: string;
  gameDir: string;
  launchArgs?: string;
  width?: number;
  height?: number;
  proxy?: boolean;
  keepopen?: boolean;
  RPC?: boolean;
  intelFix?: boolean;
  console?: boolean;
  javaPath?: string;
  isJavaPathNew?: boolean;
  addons?: string;
}

const INSTANCE_FILE = (root: string, name: string): string => path.join(instancesDir(root), `${name}.txt`);

export function listInstances(root: string): string[] {
  try {
    return fs
      .readdirSync(instancesDir(root))
      .filter((f) => f.endsWith('.txt'))
      .map((f) => f.slice(0, -4))
      .sort();
  } catch {
    return [];
  }
}

function toBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return value.toLowerCase() === 'true';
}

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function loadInstance(root: string, name: string): InstanceConfig | null {
  const props = readPropertiesFile(INSTANCE_FILE(root, name));
  if (Object.keys(props).length === 0) return null;
  // v1 语义（Instance.loadInstance 以 newInstance 缺省为底、属性覆盖）：
  // 缺 launchArgs/width/height 的老档案也拿到 v1 缺省（854x480，而非 legacyfix 兜底的 640x480）。
  const config: InstanceConfig = {
    name: props['name'] ?? name,
    version: props['version'] ?? 'b1.7.3',
    gameDir: props['gameDir'] ?? path.join(root, props['name'] ?? name),
    launchArgs: props['launchArgs'] ?? '-Xmx1G',
    width: 854,
    height: 480,
  };
  const width = toNumber(props['width']);
  if (width !== undefined) config.width = width;
  const height = toNumber(props['height']);
  if (height !== undefined) config.height = height;
  for (const key of ['javaPath', 'addons'] as const) {
    if (props[key] !== undefined) config[key] = props[key];
  }
  for (const key of ['proxy', 'keepopen', 'RPC', 'intelFix', 'console', 'isJavaPathNew'] as const) {
    const b = toBool(props[key]);
    if (b !== undefined) config[key] = b;
  }
  return config;
}

export function saveInstance(root: string, config: InstanceConfig): void {
  const props: Record<string, string> = {
    name: config.name,
    version: config.version,
    gameDir: config.gameDir,
  };
  for (const key of ['launchArgs', 'javaPath', 'addons'] as const) {
    const v = config[key];
    if (v !== undefined) props[key] = v;
  }
  if (config.width !== undefined) props['width'] = String(config.width);
  if (config.height !== undefined) props['height'] = String(config.height);
  for (const key of ['proxy', 'keepopen', 'RPC', 'intelFix', 'console', 'isJavaPathNew'] as const) {
    const b = config[key];
    if (b !== undefined) props[key] = String(b);
  }
  writePropertiesFile(INSTANCE_FILE(root, config.name), props);
}

// ---------- 本地扫描 ----------

/** bin/ 库池：*.jar 排序后的绝对路径清单（v1 Wrapper.loadJars 的整目录 classpath 语义）。 */
export function scanBinPool(root: string): string[] {
  try {
    return fs
      .readdirSync(binDir(root))
      .filter((f) => f.endsWith('.jar'))
      .sort()
      .map((f) => path.join(binDir(root), f));
  } catch {
    return [];
  }
}

/** 已安装（有客户端 jar）版本：versions/*.jar。"已安装"徽标的唯一真相源——
 * 仅有 .info 元数据而无 jar 不算安装（用户指定）。 */
export function scanInstalledJars(root: string): string[] {
  const ids = new Set<string>();
  try {
    for (const f of fs.readdirSync(versionsDir(root))) {
      if (f.endsWith('.jar')) ids.add(f.slice(0, -4));
    }
  } catch {
    /* 目录缺失 = 无安装 */
  }
  return [...ids].sort();
}

/** 本地已有元数据的版本：versions/jsons/*.info（裸 jar = 有 jar 无 info = custom，v1 语义）。 */
export function scanInstalledInfos(root: string): string[] {
  const ids = new Set<string>();
  try {
    for (const f of fs.readdirSync(jsonsDir(root))) {
      if (f.endsWith('.info')) ids.add(f.slice(0, -5));
    }
  } catch {
    /* 目录缺失 = 无元数据 */
  }
  return [...ids].sort();
}

/** 本地已有元数据/jar 的版本：versions/*.jar 与 versions/jsons/*.info 并集去重
 * （离线兜底列表用；"已安装"标记请用 scanInstalledJars）。 */
export function scanInstalledVersions(root: string): string[] {
  const ids = new Set<string>();
  try {
    for (const f of fs.readdirSync(versionsDir(root))) {
      if (f.endsWith('.jar')) ids.add(f.slice(0, -4));
    }
  } catch {
    /* 目录缺失 = 无安装 */
  }
  try {
    for (const f of fs.readdirSync(jsonsDir(root))) {
      if (f.endsWith('.info')) ids.add(f.slice(0, -5));
    }
  } catch {
    /* 同上 */
  }
  return [...ids].sort();
}

// ---------- 账户 ----------

export function loadAccounts(root: string): Account[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(accountsFile(root), 'utf8'));
    return Array.isArray(parsed) ? (parsed as Account[]) : [];
  } catch {
    return [];
  }
}

export function saveAccounts(root: string, accounts: Account[]): void {
  fs.mkdirSync(launcherDir(root), { recursive: true });
  fs.writeFileSync(accountsFile(root), JSON.stringify(accounts, null, 2), 'utf8');
}

/** MC 离线 UUID 算法：md5("OfflinePlayer:" + name)，version 3 / variant 2。 */
export function offlineUuid(name: string): string {
  const digest = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  digest[6] = (digest[6]! & 0x0f) | 0x30;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = Buffer.from(digest).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
