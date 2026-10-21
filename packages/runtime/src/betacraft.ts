/**
 * Betacraft 数据面客户端：版本清单 / 版本 .info / jar / 资产索引 / 库池下载。
 * 事实来源（实测线上数据 2026-10）：
 *   - version_list.txt：反引号分隔行，字段 0=id 1=other-name 2=compile-ms 3=release-ms [4=协议/标记]；
 *   - .info：Java properties（字段集见 info.ts）；
 *   - 全部 URL 经端点层（风险 #1）；fetchImpl 可注入（测试/离线）。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { DownloadItem, DownloadProgressEvent, LibraryInfo, VersionEra, VersionJson, VersionRef } from '@attic/core-spec';

import { resolveEndpoints, type Endpoints } from './endpoints';
import { applyLegacyfixDeawtPatch, reportLegacyfixDeawtPatch } from './legacyfixPatch';
import { ASSET_INDEXES, planAssetObjects, resolveLaunchAssetIndexId } from './legacyAssets';
import { assetIndexFile, assetsDir, binDir, clientJarFile, infoFile } from './storage';

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export interface BetacraftClientOptions {
  endpoints?: Partial<Endpoints>;
  fetchImpl?: FetchImpl;
  onProgress?: (event: DownloadProgressEvent) => void;
}

/** 年代分层：编译日期区间表（清单 release-date 对 rd- 等回填失真，compile-date 才可信）。 */
const ERA_TABLE: { from: number; era: VersionEra }[] = [
  { from: 0, era: 'pre-classic' },
  { from: Date.UTC(2009, 4, 17), era: 'classic' },
  { from: Date.UTC(2009, 11, 23), era: 'indev' },
  { from: Date.UTC(2010, 1, 27), era: 'infdev' },
  { from: Date.UTC(2010, 5, 28), era: 'alpha' },
  { from: Date.UTC(2010, 11, 20), era: 'beta' },
  { from: Date.UTC(2011, 10, 18), era: 'release-1.0-1.5.2' },
];

export function eraForDate(ms: number | undefined): VersionEra | undefined {
  if (ms === undefined || !Number.isFinite(ms)) return undefined;
  let era: VersionEra | undefined;
  for (const row of ERA_TABLE) if (ms >= row.from) era = row.era;
  return era;
}

/** 清单数据缺陷矫正表（用户指定；数据矫正，非客户端推断）。
 *  恶搞/开发版 compile+release 双 0 → eraForDate(0) 误归 Pre-Classic：
 *  - b1.2_02-dev-20110517：id 自带日期 2011-05-17 → 归 Beta，组内排在 b1.2_02 后；
 *  - 2.0-preview：取 2.0-red 编译时刻（1364841286000）前 1s → 归 Release，紧随其前。 */
const DATE_FIXUPS: Record<string, number> = {
  'b1.2_02-dev-20110517': Date.UTC(2011, 4, 17),
  '2.0-preview': 1364841285000,
};

/** 4k-* 单开年代组（Classic 之后展示，用户指定）。 */
const ERA_FIXUPS: { prefix: string; era: VersionEra }[] = [{ prefix: '4k-', era: '4k' }];

export function parseVersionList(text: string): VersionRef[] {
  const refs: VersionRef[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const fields = trimmed.split('`');
    const id = fields[0];
    if (!id) continue;
    const rawCompile = Number(fields[2]);
    const rawRelease = Number(fields[3]);
    let compile = Number.isFinite(rawCompile) && rawCompile > 0 ? rawCompile : undefined;
    let release = Number.isFinite(rawRelease) && rawRelease > 0 ? rawRelease : undefined;
    const fix = DATE_FIXUPS[id];
    if (fix !== undefined && compile === undefined && release === undefined) {
      compile = fix;
      release = fix;
    }
    let era = eraForDate(compile ?? release);
    for (const f of ERA_FIXUPS) {
      if (id.startsWith(f.prefix)) era = f.era;
    }
    refs.push({
      id,
      repository: 'betacraft',
      displayName: fields[1] ? fields[1] : undefined,
      compileDate: compile,
      releaseDate: release,
      era,
      installed: false,
    });
  }
  return refs;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 流式读文件算哈希（sha1 校验 jar 用）。 */
export function hashFile(file: string, algo: 'sha1' | 'sha256'): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algo);
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function basenameFromUrl(url: string): string {
  const noQuery = url.split('?')[0]!.split('#')[0]!;
  const base = noQuery.split('/').pop();
  return base && base.length > 0 ? base : 'download.bin';
}

export class BetacraftClient {
  readonly endpoints: Endpoints;
  private readonly fetchImpl: FetchImpl;
  private readonly onProgress: ((event: DownloadProgressEvent) => void) | undefined;

  constructor(options: BetacraftClientOptions = {}) {
    this.endpoints = resolveEndpoints(options.endpoints);
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.onProgress = options.onProgress;
  }

  private emit(event: DownloadProgressEvent): void {
    this.onProgress?.(event);
  }

  private async get(url: string): Promise<Response> {
    const res = await this.fetchImpl(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res;
  }

  /** 通用下载：进度事件 + 可选 sha1/sha256 校验；失败发 failed 并抛错。 */
  async download(
    url: string,
    destFile: string,
    item: DownloadItem,
    id: string,
    hash?: { algo: 'sha1' | 'sha256'; value: string },
  ): Promise<void> {
    this.emit({ item, id, phase: 'queued', bytesDone: 0 });
    let bytesDone = 0;
    let bytesTotal: number | undefined;
    try {
      const res = await this.get(url);
      const totalHeader = res.headers.get('content-length');
      bytesTotal = totalHeader ? Number(totalHeader) : undefined;
      fs.mkdirSync(path.dirname(destFile), { recursive: true });
      const hasher = hash ? crypto.createHash(hash.algo) : null;
      const handle = await fs.promises.open(destFile, 'w');
      try {
        const reader = res.body?.getReader();
        if (reader) {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              await handle.writeFile(value);
              bytesDone += value.byteLength;
              hasher?.update(value);
              this.emit({ item, id, phase: 'transferring', bytesDone, bytesTotal });
            }
          }
        } else {
          const buf = new Uint8Array(await res.arrayBuffer());
          await handle.writeFile(buf);
          bytesDone = buf.byteLength;
          hasher?.update(buf);
        }
      } finally {
        await handle.close();
      }
      if (hasher && hash) {
        this.emit({ item, id, phase: 'verifying', bytesDone, bytesTotal });
        const actual = hasher.digest('hex');
        if (actual !== hash.value.toLowerCase()) {
          fs.rmSync(destFile, { force: true });
          throw new Error(`${hash.algo} 校验失败：期望 ${hash.value}，实际 ${actual}`);
        }
      }
      this.emit({ item, id, phase: 'done', bytesDone, bytesTotal: bytesTotal ?? bytesDone });
    } catch (error) {
      this.emit({ item, id, phase: 'failed', bytesDone, bytesTotal, error: messageOf(error) });
      throw error;
    }
  }

  async fetchVersionList(): Promise<VersionRef[]> {
    const res = await this.get(this.endpoints.versionList);
    return parseVersionList(await res.text());
  }

  /** 版本 .info 原文（每次启动重下策略由 runtime 编排，这里只管取）。 */
  async fetchVersionInfo(id: string): Promise<string> {
    const res = await this.get(this.endpoints.versionJson(id));
    return res.text();
  }

  /** 落 versions/jsons/<id>.info。 */
  saveVersionInfo(root: string, id: string, text: string): void {
    const dest = infoFile(root, id);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text, 'utf8');
  }

  /**
   * 客户端 jar → versions/<id>.jar（设置页双开关真实接线，BlockHelm「启动前检查/补全」语义）：
   * - `verify=false`（checkIntegrity 关）：本地存在即复用，跳过 sha1 复核；
   * - `repair=false`（fixMissing 关）：缺失或复核不符时显式报错，不擅自重下载/覆盖。
   * - `force=true`（实例 forceUpdate，v1 Launcher.forceUpdate 语义）：旁路全部「已存在即复用」
   *   检查直接重下（覆盖本地文件）。
   * 缺省（都不传）= 恒复核 + 自动补全 = 历史行为，测试与其他调用点零改动。
   */
  async downloadClientJar(
    json: VersionJson,
    root: string,
    opts: { verify?: boolean; repair?: boolean; force?: boolean } = {},
  ): Promise<void> {
    const url = json.jar?.url ?? json.downloads?.client?.url;
    if (!url) throw new Error(`版本 ${json.id} 无 jar 下载地址`);
    const sha1 = json.jar?.sha1 ?? json.downloads?.client?.sha1;
    const dest = clientJarFile(root, json.id);
    if (!opts.force && fs.existsSync(dest)) {
      if (!sha1 || opts.verify === false) return;
      if ((await hashFile(dest, 'sha1')) === sha1.toLowerCase()) return;
      // 复核不符 = 本地损坏；补全关闭时把决定权交回用户（可见失败，不静默覆盖）
      if (opts.repair === false) {
        throw new Error(`版本 ${json.id} 的 jar 校验不符（本地文件损坏），自动补全已禁用——请手动删除该 jar 或开启补全开关`);
      }
    } else if (!opts.force && opts.repair === false) {
      throw new Error(`版本 ${json.id} 的 jar 缺失，自动补全已禁用——请开启补全开关或手动放入 versions/${json.id}.jar`);
    }
    await this.download(url, dest, 'client-jar', json.id, sha1 ? { algo: 'sha1', value: sha1 } : undefined);
  }

  /**
   * 资产索引 → assets/indexes/<id>.json，返回落位的索引 ID（无资产/无数据 → null）。
   * ID 四级来源（resolveLaunchAssetIndexId 统一入口，与启动注入 -Dlf.assetIndex 同源）：
   * Mojang 形状 assetIndex > .info assets 字段 > BC v2 权威表 > legacyfix version_data 表。
   * BC `.info` 全线无 assets 字段；Indev 年代标题探测与 ID 表不同源（0130 标题 "Minecraft 0.31"
   * → c0.31 → 20100124，ID 表 → 20100212），必须由 BC v2 权威表钉死，否则 objects 错配、部分声音缺失。
   */
  async downloadAssetIndex(json: VersionJson, root: string, opts: { force?: boolean } = {}): Promise<string | null> {
    const ai = json.assetIndex;
    const id = resolveLaunchAssetIndexId(json);
    if (!id) return null;
    const entry = ASSET_INDEXES[id];
    const url = ai?.url ?? entry?.url;
    if (!url) return null;
    const sha1 = ai?.sha1 ?? entry?.sha1;
    const dest = assetIndexFile(root, id);
    if (!opts.force && fs.existsSync(dest)) {
      if (!sha1) return id;
      if ((await hashFile(dest, 'sha1')) === sha1.toLowerCase()) return id;
    }
    await this.download(url, dest, 'asset-index', id, sha1 ? { algo: 'sha1', value: sha1 } : undefined);
    return id;
  }

  /**
   * 资产对象补全 → assets/objects/<2位前缀>/<hash>（v2 bc_game_download_assets 语义：
   * 存在且 size 相符即跳过；hash 即 sha1，下载时校验）。
   * legacyfix 只自动补索引 `custom` 段，`objects` 全体是启动器责任——缺失即游戏内声音 NPE（用户实测）。
   */
  async downloadAssetObjects(root: string, indexId: string, opts: { force?: boolean } = {}): Promise<void> {
    const indexFile = assetIndexFile(root, indexId);
    if (!fs.existsSync(indexFile)) return;
    const plan = planAssetObjects(JSON.parse(fs.readFileSync(indexFile, 'utf8')) as unknown);
    for (const obj of plan) {
      const dest = path.join(assetsDir(root), 'objects', obj.hash.slice(0, 2), obj.hash);
      if (!opts.force && fs.existsSync(dest) && fs.statSync(dest).size === obj.size) continue;
      await this.download(obj.url, dest, 'asset', `${indexId}:${obj.key}`, { algo: 'sha1', value: obj.hash });
    }
  }

  /** json.libraries → bin/<basename>（整目录上 classpath，缺失才下；force=true 覆盖已存在文件）。 */
  async downloadLibrariesToBin(json: VersionJson, root: string, opts: { force?: boolean } = {}): Promise<void> {
    for (const lib of json.libraries ?? []) {
      const url = lib.url ?? lib.client?.url;
      if (!url) continue;
      const dest = path.join(binDir(root), basenameFromUrl(url));
      if (!opts.force && fs.existsSync(dest)) continue;
      await this.download(url, dest, 'library', lib.name, lib.client?.sha1 ? { algo: 'sha1', value: lib.client.sha1 } : undefined);
    }
  }

  /**
   * Mojang 重发布库集 → LibraryInfo[]（BC `.info` 无 libraries 时的库池回填通道）。
   * 形状转换在此完成，契约不动（LibraryInfo 只走 url/client）。
   * rules 语义：无 rules → 收录；有 rules → 仅当存在匹配当前 os.name 的 allow。
   * natives classifier（如 lwjgl-platform/jinput-platform 的 -natives-windows.jar）
   * 也进 bin/ 池——LWJGL2/JInput 会自行从 classpath 解出原生库。
   */
  async fetchMojangLibraries(id: string, platform: NodeJS.Platform): Promise<LibraryInfo[]> {
    const manifest = (await (await this.get(this.endpoints.mojangManifest)).json()) as {
      versions?: { id: string; url: string }[];
    };
    const entry = manifest.versions?.find((v) => v.id === id);
    if (!entry) throw new Error(`Mojang 清单无 ${id}`);
    const doc = (await (await this.get(entry.url)).json()) as {
      libraries?: {
        name: string;
        url?: string;
        downloads?: {
          artifact?: { url: string; sha1?: string };
          classifiers?: Record<string, { url: string; sha1?: string }>;
        };
        natives?: Record<string, string>;
        rules?: { action: 'allow' | 'disallow'; os?: { name?: string } }[];
      }[];
    };
    const osName = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'osx' : 'linux';
    const out: LibraryInfo[] = [];
    const seen = new Set<string>();
    const push = (name: string, url: string, sha1?: string): void => {
      if (seen.has(url)) return;
      seen.add(url);
      out.push({ name, url, client: sha1 ? { url, sha1 } : { url } });
    };
    for (const lib of doc.libraries ?? []) {
      if (lib.rules) {
        const allowed = lib.rules.some((r) => r.action === 'allow' && (!r.os || r.os.name === osName));
        if (!allowed) continue;
      }
      const artifactUrl = lib.downloads?.artifact?.url ?? lib.url;
      if (artifactUrl) push(lib.name, artifactUrl, lib.downloads?.artifact?.sha1);
      const natKey = lib.natives?.[osName];
      const nat = natKey ? lib.downloads?.classifiers?.[natKey] : undefined;
      if (nat?.url) push(lib.name, nat.url, nat.sha1);
    }
    return out;
  }

  /** legacyfix Release 最新构件下载 → <root>/<relPath>（relPath 来自 agentMount.path）。 */
  async ensureLegacyfix(root: string, relPath: string): Promise<string> {
    const dest = path.join(root, relPath);
    if (fs.existsSync(dest)) {
      // DeAwtPatch 窗口位置补丁幂等维持（钉版不匹配/锚点异常自动跳过，不阻断启动）。
      reportLegacyfixDeawtPatch(dest, applyLegacyfixDeawtPatch(dest));
      return dest;
    }
    const res = await this.get(this.endpoints.legacyfixRelease);
    const release = (await res.json()) as { assets?: { name?: string; browser_download_url?: string }[] };
    const wanted = path.basename(relPath).toLowerCase();
    const asset =
      release.assets?.find((a) => a.name?.toLowerCase() === wanted) ??
      release.assets?.find((a) => a.name?.toLowerCase().startsWith('legacyfix') && a.name.toLowerCase().endsWith('.jar'));
    if (!asset?.browser_download_url) throw new Error('legacyfix Release 中未找到可用 jar 构件');
    await this.download(asset.browser_download_url, dest, 'legacyfix', asset.name ?? relPath);
    reportLegacyfixDeawtPatch(dest, applyLegacyfixDeawtPatch(dest));
    return dest;
  }
}
