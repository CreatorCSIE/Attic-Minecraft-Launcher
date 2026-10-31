/**
 * 微软登录（正版认证链）runtime 层（plan.md §7「微软登录」实装安全约束全量落地）。
 * 线格式事实源 = reference/betacraft-launcher v1 源码逐字段对齐：
 *   MicrosoftAuth.java / DeviceCodeRequest.java / CheckTokenRequest.java /
 *   XBLAuthRequest.java / XSTSAuthRequest.java / MinecraftAuthRequest.java /
 *   MinecraftProfileRequest.java / JoinServerRequest.java / Wrapper.java L233-260。
 * 硬纪律：
 *   ① 端点白名单闸——五域之外零发送（msFetch 单点，戒律级）；
 *   ② 脱敏闸——MsAuthError.message 恒为分类码，响应体/URL 查询串永不进消息；
 *   ③ token 落盘 = Windows DPAPI（用户作用域）加密（dpapi:v1:<b64>），内存态解密。
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { promises as dnsPromises } from 'node:dns';

import type { MsDeviceCode, MsLoginErrorCode } from '@attic/core-spec';

import type { FetchImpl } from './betacraft';

/**
 * 缺省 CLIENT_ID（Azure 应用注册 15bc4a50，2026-10-31 落定；个人账户租户 + 公共客户端流已开，
 * devicecode 端点实测 200，无 secret——plan.md §7 安全约束③：public client 公开常量，
 * 随安装包分发不构成泄漏面。注：前值 c24c74e6 因单一租户注册 + 公共流未开被弃）。
 * 生效值 = settings.microsoftClientId || DEFAULT_MS_CLIENT_ID（覆盖键供换绑/排障）。
 */
export const DEFAULT_MS_CLIENT_ID = '15bc4a50-ecdd-4573-ad32-aa5114ed76ef';

/** 端点白名单（plan.md §7 安全约束②所列五域；msFetch 硬闸，域外直接 internal）。 */
export const MS_HOST_WHITELIST: ReadonlySet<string> = new Set([
  'login.microsoftonline.com',
  'user.auth.xboxlive.com',
  'xsts.auth.xboxlive.com',
  'api.minecraftservices.com',
  'sessionserver.mojang.com',
]);

const MS_URL = {
  deviceCode: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode',
  token: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
  xbl: 'https://user.auth.xboxlive.com/user/authenticate',
  xsts: 'https://xsts.auth.xboxlive.com/xsts/authorize',
  mcsLogin: 'https://api.minecraftservices.com/authentication/login_with_xbox',
  mcProfile: 'https://api.minecraftservices.com/minecraft/profile',
  join: 'https://sessionserver.mojang.com/session/minecraft/join',
} as const;

/** XSTS XErr 分类码（v1 MicrosoftAuth.java L67-72 实锤：2148916233=无 Xbox 档案 / 2148916238=未成年家长控制）。 */
const XERR_NO_XBOX_PROFILE = 2148916233;
const XERR_MINOR_PARENTAL = 2148916238;

/** 对外错误 = 分类码（脱敏硬闸：消息永不含 token 原文/响应体/URL 查询串）。 */
export class MsAuthError extends Error {
  readonly code: MsLoginErrorCode;
  constructor(code: MsLoginErrorCode) {
    super(code);
    this.name = 'MsAuthError';
    this.code = code;
  }
}

/** 流中止哨兵（cancel 路径专用；不是错误分类，由调用侧落 canceled）。 */
export class MsAbortError extends Error {
  constructor() {
    super('aborted');
    this.name = 'MsAbortError';
  }
}

export type SleepFn = (ms: number, signal?: AbortSignal) => Promise<void>;
export type LookupFn = (host: string) => Promise<string>;

/** DPAPI 执行体注入面（测试可换 spawn；缺省真 powershell.exe）。 */
export interface DpapiDeps {
  spawnImpl?: typeof spawn;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
}

/** 认证链依赖（fetch 面 + CLIENT_ID + 可注入的轮询退避/IP 解析/DPAPI 执行体）。 */
export interface MsAuthDeps {
  fetchImpl: FetchImpl;
  clientId: string;
  signal?: AbortSignal;
  sleep?: SleepFn;
  lookup?: LookupFn;
  dpapi?: DpapiDeps;
}

// ---------- 端点白名单硬闸 + 统一请求 helper ----------

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || (error as NodeJS.ErrnoException).code === 'ABORT_ERR')
  );
}

/** 白名单闸谓词（绊线测试出口）：url 的 host 命中五域 = true；解析失败 = false。 */
export function isMsEndpointAllowed(url: string): boolean {
  try {
    return MS_HOST_WHITELIST.has(new URL(url).host.toLowerCase());
  } catch {
    return false;
  }
}

/** 唯一出门口：host 不在五域白名单 = 直接 internal（纪律不是建议）；传输失败 = network。 */
async function msFetch(deps: MsAuthDeps, url: string, init: RequestInit = {}): Promise<Response> {
  if (!isMsEndpointAllowed(url)) throw new MsAuthError('internal');
  try {
    return await deps.fetchImpl(url, { ...init, signal: deps.signal });
  } catch (error) {
    if (isAbortError(error) || deps.signal?.aborted) throw new MsAbortError();
    throw new MsAuthError('network');
  }
}

/** 响应体 JSON（解析失败 = null；body 永不进错误消息——脱敏闸）。 */
async function jsonOrNull(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await res.json();
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function str(body: Record<string, unknown> | null, key: string): string | undefined {
  const v = body?.[key];
  return typeof v === 'string' ? v : undefined;
}

function num(body: Record<string, unknown> | null, key: string): number | undefined {
  const v = body?.[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

const FORM_HEADERS: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
const JSON_HEADERS: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };

/** v1 URLEncoder.encode 同构（XBL RpsTicket 用）：字母数字与 .-*_ 保留、空格→+、其余 %XX 大写。 */
export function javaUrlEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, '+')
    .replace(/[!'()~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// ---------- ① 设备码 ----------

export interface MsDeviceCodeIssue {
  /** 轮询用机密（不落事件面、不进错误消息）。 */
  deviceCode: string;
  /** 弹窗展示面（契约 MsDeviceCode）。 */
  view: MsDeviceCode;
}

/** POST devicecode（form: client_id + scope=XboxLive.signin offline_access，v1 DeviceCodeRequest.java 逐字对齐）。 */
export async function requestDeviceCode(deps: MsAuthDeps): Promise<MsDeviceCodeIssue> {
  const res = await msFetch(deps, MS_URL.deviceCode, {
    method: 'POST',
    headers: FORM_HEADERS,
    body: `client_id=${deps.clientId}&scope=XboxLive.signin offline_access`,
  });
  const body = await jsonOrNull(res);
  const deviceCode = str(body, 'device_code');
  const userCode = str(body, 'user_code');
  const verificationUri = str(body, 'verification_uri');
  if (!res.ok || !deviceCode || !userCode || !verificationUri) throw new MsAuthError('internal');
  return {
    deviceCode,
    view: {
      userCode,
      verificationUri,
      verificationUriComplete: str(body, 'verification_uri_complete'),
      expiresIn: num(body, 'expires_in') ?? 900,
      interval: num(body, 'interval') ?? 5,
    },
  };
}

// ---------- ② 轮询 token / 刷新链共用 token endpoint ----------

export interface MsTokenPair {
  /** MS 访问令牌（进 XBL 用，非 MCS token）。 */
  accessToken: string;
  refreshToken?: string;
  /** 秒。 */
  expiresIn: number;
}

function parseTokenPair(body: Record<string, unknown> | null): MsTokenPair | null {
  const accessToken = str(body, 'access_token');
  if (!accessToken) return null;
  return {
    accessToken,
    refreshToken: str(body, 'refresh_token'),
    expiresIn: num(body, 'expires_in') ?? 3600,
  };
}

async function postTokenForm(deps: MsAuthDeps, form: string): Promise<Record<string, unknown> | null> {
  const res = await msFetch(deps, MS_URL.token, { method: 'POST', headers: FORM_HEADERS, body: form });
  return jsonOrNull(res);
}

/**
 * 设备码轮询（v1 CheckTokenRequest.java 载荷逐字对齐：grant_type=urn:ietf:params:oauth:grant-type:device_code）。
 * authorization_pending 继续；slow_down interval+5s；expired_token/declined → 分类码。
 */
export async function pollDeviceToken(
  deps: MsAuthDeps,
  deviceCode: string,
  intervalSec: number,
): Promise<MsTokenPair> {
  const sleep = deps.sleep ?? defaultSleep;
  let interval = Math.max(1, intervalSec);
  for (;;) {
    if (deps.signal?.aborted) throw new MsAbortError();
    const body = await postTokenForm(
      deps,
      `client_id=${deps.clientId}&grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code=${deviceCode}`,
    );
    const pair = parseTokenPair(body);
    if (pair) return pair;
    const error = str(body, 'error');
    if (error === 'authorization_pending') {
      await sleep(interval * 1000, deps.signal);
      continue;
    }
    if (error === 'slow_down') {
      interval += 5;
      await sleep(interval * 1000, deps.signal);
      continue;
    }
    if (error === 'expired_token') throw new MsAuthError('expired_token');
    if (error === 'authorization_declined' || error === 'invalid_user') throw new MsAuthError('access_denied');
    throw new MsAuthError('internal');
  }
}

/** 刷新链入口：token endpoint grant_type=refresh_token（v1 CheckTokenRequest devcode=null 分支）。 */
export async function refreshMsToken(deps: MsAuthDeps, refreshToken: string): Promise<MsTokenPair> {
  const body = await postTokenForm(deps, `client_id=${deps.clientId}&grant_type=refresh_token&refresh_token=${refreshToken}`);
  const pair = parseTokenPair(body);
  if (!pair) throw new MsAuthError('internal');
  return pair;
}

// ---------- ③ XBL / ④ XSTS / ⑤ MCS / ⑥ profile ----------

export interface MsXblResult {
  token: string;
  /** DisplayClaims.xui[0].uhs。 */
  uhs: string;
}

/** XBL（v1 XBLAuthRequest.java + XBLProperties.java 载荷逐字对齐：RpsTicket=`d=`+URLEncoder(msToken)）。 */
export async function xblAuthenticate(deps: MsAuthDeps, msAccessToken: string): Promise<MsXblResult> {
  const res = await msFetch(deps, MS_URL.xbl, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${javaUrlEncode(msAccessToken)}`,
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    }),
  });
  const body = await jsonOrNull(res);
  const token = str(body, 'Token');
  const claims = body?.['DisplayClaims'];
  const xui = claims !== null && typeof claims === 'object' ? (claims as Record<string, unknown>)['xui'] : undefined;
  const uhs = Array.isArray(xui) && xui.length > 0 ? str(xui[0] as Record<string, unknown>, 'uhs') : undefined;
  if (!res.ok || !token || !uhs) throw new MsAuthError('internal');
  return { token, uhs };
}

/**
 * XSTS（v1 XSTSAuthRequest.java + XSTSProperties.java 载荷逐字对齐：Properties={SandboxId,UserTokens:[xblToken]}、
 * RelyingParty=rp://api.minecraftservices.com/——注意与任务书「DependsOn/AuthMethod」描述不一致，以 v1 源码为准）。
 * XErr 分类：2148916233→no_xbox_profile、2148916238→minor_parental。
 */
export async function xstsAuthenticate(deps: MsAuthDeps, xblToken: string): Promise<MsXblResult> {
  const res = await msFetch(deps, MS_URL.xsts, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    }),
  });
  const body = await jsonOrNull(res);
  const xerr = num(body, 'XErr');
  if (xerr === XERR_NO_XBOX_PROFILE) throw new MsAuthError('no_xbox_profile');
  if (xerr === XERR_MINOR_PARENTAL) throw new MsAuthError('minor_parental');
  const token = str(body, 'Token');
  const claims = body?.['DisplayClaims'];
  const xui = claims !== null && typeof claims === 'object' ? (claims as Record<string, unknown>)['xui'] : undefined;
  const uhs = Array.isArray(xui) && xui.length > 0 ? str(xui[0] as Record<string, unknown>, 'uhs') : undefined;
  if (!res.ok || !token || !uhs) throw new MsAuthError('internal');
  return { token, uhs };
}

/** MCS（v1 MinecraftAuthRequest.java：identityToken=`XBL3.0 x={uhs};{xstsToken}`）。 */
export async function mcsLogin(deps: MsAuthDeps, uhs: string, xstsToken: string): Promise<MsTokenPair> {
  const res = await msFetch(deps, MS_URL.mcsLogin, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ identityToken: `XBL3.0 x=${uhs};${xstsToken}` }),
  });
  const body = await jsonOrNull(res);
  const accessToken = str(body, 'access_token');
  if (!res.ok || !accessToken) throw new MsAuthError('internal');
  return { accessToken, expiresIn: num(body, 'expires_in') ?? 86400 };
}

export interface MsProfileResult {
  /** MCS profile id（32 位 hex，v1 local_uuid 同源）。 */
  id: string;
  name: string;
}

/** profile（GET Bearer；404/无档案 → no_minecraft）。 */
export async function mcProfile(deps: MsAuthDeps, mcAccessToken: string): Promise<MsProfileResult> {
  const res = await msFetch(deps, MS_URL.mcProfile, {
    method: 'GET',
    headers: { Authorization: `Bearer ${mcAccessToken}` },
  });
  if (res.status === 404) throw new MsAuthError('no_minecraft');
  const body = await jsonOrNull(res);
  const id = str(body, 'id');
  const name = str(body, 'name');
  if (!res.ok || !id || !name) throw new MsAuthError('no_minecraft');
  return { id, name };
}

/** 链尾 ③-⑥（设备码成功与刷新链共用重放段）。 */
export interface MsChainResult extends MsProfileResult {
  /** MCS 访问令牌（join sessionid / 游戏 auth 用）。 */
  mcAccessToken: string;
  mcExpiresIn: number;
  refreshToken?: string;
}

export async function runAuthTail(deps: MsAuthDeps, ms: MsTokenPair): Promise<MsChainResult> {
  const xbl = await xblAuthenticate(deps, ms.accessToken);
  const xsts = await xstsAuthenticate(deps, xbl.token);
  const mcs = await mcsLogin(deps, xbl.uhs, xsts.token);
  const profile = await mcProfile(deps, mcs.accessToken);
  return { ...profile, mcAccessToken: mcs.accessToken, mcExpiresIn: mcs.expiresIn, refreshToken: ms.refreshToken };
}

// ---------- joinServer（spawn 前预注册，Wrapper.java L233-260 + JoinServerRequest.java 对齐） ----------

/** serverId = sha1(IP 字符串) hex（v1 JoinServerRequest.sha1：小写 hex、逐字节 %02x）。 */
export function sha1ServerId(ip: string): string {
  return crypto.createHash('sha1').update(ip, 'utf8').digest('hex');
}

async function defaultLookup(host: string): Promise<string> {
  const result = await dnsPromises.lookup(host, { family: 4 });
  return result.address;
}

async function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new MsAbortError();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new MsAbortError());
      },
      { once: true },
    );
  });
}

export interface JoinServerInput {
  /** v1 sessionid 形状：微软账户 = getAuthToken() 直返的 MCS access_token（Wrapper.java L103 javadoc 的
   * token:accessToken:profileid 为老 YGGDRASIL 遗留格式，v1 微软账户实发裸 token——取证为准）。 */
  sessionid: string;
  /** selectedProfile = v1 uuid（credentials.local_uuid = MCS profile id）。 */
  profileId: string;
  /** `ip[:port]`（LaunchContext.server 原样；端口剥离后解析）。 */
  serverHost: string;
}

/**
 * 预注册 join：POST sessionserver /session/minecraft/join，载荷字段名照 v1 JoinServerRequest
 * （accessToken/selectedProfile/serverId，无 Authorization 头）。
 * serverId 派生 = dns.lookup(服务器主机名)→IPv4 字符串→sha1 hex（任务书/plan.md 口径）。
 * ⚠ 与 v1 源码存在一处取证分歧：v1 对公网服务器哈希的是**本机外网 IP**（getExternalIP→checkip），
 * localhost→"127.0.0.1"；本实现按任务书哈希服务器解析 IP（checkip 域不在五域白名单纪律内）。
 * 失败抛 MsAuthError（调用侧不拦启动，只推警告行）。
 */
export async function joinServer(deps: MsAuthDeps, input: JoinServerInput): Promise<void> {
  const match = /^([^:/\s]+)(?::\d{1,5})?$/.exec(input.serverHost.trim());
  if (!match?.[1]) throw new MsAuthError('internal');
  const host = match[1];
  const lookup = deps.lookup ?? defaultLookup;
  let ip: string;
  try {
    ip = await lookup(host);
  } catch {
    throw new MsAuthError('network');
  }
  const res = await msFetch(deps, MS_URL.join, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: input.sessionid, selectedProfile: input.profileId, serverId: sha1ServerId(ip) }),
  });
  if (!res.ok) throw new MsAuthError('network');
}

// ---------- DPAPI（Windows 用户作用域，PowerShell ProtectedData 执行体） ----------

/** 磁盘密文前缀（accounts.json 内 token 字段形态：`dpapi:v1:<base64>`）。 */
export const DPAPI_PREFIX = 'dpapi:v1:';

/** 固定 Entropy 字节串（同机同用户、熵一致才能解）。 */
const DPAPI_ENTROPY_TEXT = 'Attic-Minecraft-Launcher DPAPI v1';

function dpapiScript(kind: 'protect' | 'unprotect'): string {
  // stdin 进数据、stdout 出 base64——token 永不进命令行参数（进程列表泄漏面）。
  const op =
    kind === 'protect'
      ? "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($in), $e, [Security.Cryptography.DataProtectionScope]::CurrentUser))"
      : "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($in.Trim()), $e, [Security.Cryptography.DataProtectionScope]::CurrentUser))";
  return (
    "$ErrorActionPreference='Stop';" +
    'Add-Type -AssemblyName System.Security;' +
    '$in=[Console]::In.ReadToEnd();' +
    'if ($in.EndsWith("`r") -or $in.EndsWith("`n")) { $in = $in.TrimEnd("`r","`n") };' +
    `$e=[Text.Encoding]::UTF8.GetBytes('${DPAPI_ENTROPY_TEXT}');` +
    `${op}`
  );
}

/** 真跑一次 powershell.exe：stdin 喂数据、stdout 收 base64；非零退出 = internal（stderr 不回显内容）。 */
function runDpapi(kind: 'protect' | 'unprotect', stdinData: string, deps: DpapiDeps): Promise<string> {
  const spawnImpl = deps.spawnImpl ?? spawn;
  const timeoutMs = deps.timeoutMs ?? 30_000;
  return new Promise<string>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', dpapiScript(kind)], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch {
      reject(new MsAuthError('internal'));
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* 已退出 */
      }
      reject(new MsAuthError('internal'));
    }, timeoutMs);
    let out = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.on('error', () => {
      clearTimeout(timer);
      reject(new MsAuthError('internal'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const b64 = out.replace(/\s+/g, '');
      if (code === 0 && b64.length > 0) resolve(b64);
      else reject(new MsAuthError('internal'));
    });
    child.stdin?.on('error', () => {
      /* powershell 提前退出时写管道 EPIPE：由 close 分支统一失败 */
    });
    child.stdin?.end(stdinData);
  });
}

/**
 * token → 磁盘形态：Windows = `dpapi:v1:<b64>`（DPAPI 用户作用域）；
 * 非 Windows 平台无 DPAPI = 明文透传（跨平台开发态逃生舱，Windows 生产面恒密文）。
 */
export async function encodeTokenSecret(plain: string, deps: DpapiDeps = {}): Promise<string> {
  const platform = deps.platform ?? process.platform;
  if (platform !== 'win32') return plain;
  const b64 = await runDpapi('protect', plain, deps);
  return `${DPAPI_PREFIX}${b64}`;
}

/**
 * 磁盘形态 → 内存明文：`dpapi:v1:` 前缀走 Unprotect；无前缀 = 旧明文原样装载
 * （下次落盘自动升级为密文）。
 */
export async function decodeTokenSecret(value: string, deps: DpapiDeps = {}): Promise<string> {
  if (!value.startsWith(DPAPI_PREFIX)) return value;
  const platform = deps.platform ?? process.platform;
  if (platform !== 'win32') throw new MsAuthError('internal');
  const b64 = await runDpapi('unprotect', value.slice(DPAPI_PREFIX.length), deps);
  return Buffer.from(b64, 'base64').toString('utf8');
}
