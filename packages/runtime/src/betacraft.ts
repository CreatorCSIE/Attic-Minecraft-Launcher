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
import { assetIndexFile, binDir, clientJarFile, infoFile } from './storage';

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

export function parseVersionList(text: string): VersionRef[] {
  const refs: VersionRef[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const fields = trimmed.split('`');
    const id = fields[0];
    if (!id) continue;
    const compileDate = Number(fields[2]);
    const releaseDate = Number(fields[3]);
    refs.push({
      id,
      repository: 'betacraft',
      displayName: fields[1] ? fields[1] : undefined,
      compileDate: Number.isFinite(compileDate) ? compileDate : undefined,
      releaseDate: Number.isFinite(releaseDate) ? releaseDate : undefined,
      era: eraForDate(Number.isFinite(compileDate) ? compileDate : Number.isFinite(releaseDate) ? releaseDate : undefined),
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

  /** 客户端 jar → versions/<id>.jar；本地已存在且 sha1 相符则跳过。 */
  async downloadClientJar(json: VersionJson, root: string): Promise<void> {
    const url = json.jar?.url ?? json.downloads?.client?.url;
    if (!url) throw new Error(`版本 ${json.id} 无 jar 下载地址`);
    const sha1 = json.jar?.sha1 ?? json.downloads?.client?.sha1;
    const dest = clientJarFile(root, json.id);
    if (fs.existsSync(dest)) {
      if (!sha1) return;
      if ((await hashFile(dest, 'sha1')) === sha1.toLowerCase()) return;
    }
    await this.download(url, dest, 'client-jar', json.id, sha1 ? { algo: 'sha1', value: sha1 } : undefined);
  }

  /** 资产索引 → assets/indexes/<id>.json；无 assetIndex 的远古版本静默跳过。 */
  async downloadAssetIndex(json: VersionJson, root: string): Promise<void> {
    const ai = json.assetIndex;
    const id = ai?.id ?? json.assets;
    if (!ai?.url || !id) return;
    const dest = assetIndexFile(root, id);
    if (fs.existsSync(dest)) {
      if (!ai.sha1) return;
      if ((await hashFile(dest, 'sha1')) === ai.sha1.toLowerCase()) return;
    }
    await this.download(ai.url, dest, 'asset-index', id, ai.sha1 ? { algo: 'sha1', value: ai.sha1 } : undefined);
  }

  /** json.libraries → bin/<basename>（整目录上 classpath，缺失才下）。 */
  async downloadLibrariesToBin(json: VersionJson, root: string): Promise<void> {
    for (const lib of json.libraries ?? []) {
      const url = lib.url ?? lib.client?.url;
      if (!url) continue;
      const dest = path.join(binDir(root), basenameFromUrl(url));
      if (fs.existsSync(dest)) continue;
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
    if (fs.existsSync(dest)) return dest;
    const res = await this.get(this.endpoints.legacyfixRelease);
    const release = (await res.json()) as { assets?: { name?: string; browser_download_url?: string }[] };
    const wanted = path.basename(relPath).toLowerCase();
    const asset =
      release.assets?.find((a) => a.name?.toLowerCase() === wanted) ??
      release.assets?.find((a) => a.name?.toLowerCase().startsWith('legacyfix') && a.name.toLowerCase().endsWith('.jar'));
    if (!asset?.browser_download_url) throw new Error('legacyfix Release 中未找到可用 jar 构件');
    await this.download(asset.browser_download_url, dest, 'legacyfix', asset.name ?? relPath);
    return dest;
  }
}
