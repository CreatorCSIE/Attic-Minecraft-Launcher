/**
 * 远古 Java 供给通道（风险 #7）：Azul Zulu 元数据 API 查 JDK 6/7/8 归档包，
 * 下载 zip + sha256 校验 + 解压（win 用 powershell Expand-Archive，posix 用 unzip）。
 * 失败返回原因——手动导入兜底永远存在（探测失败面板给全候选与原因）。
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import type { DownloadProgressEvent } from '@attic/core-spec';

import { BetacraftClient, type FetchImpl } from './betacraft';
import type { Endpoints } from './endpoints';

const execFileAsync = promisify(execFile);

export interface ZuluPackage {
  name: string;
  url: string;
  sha256?: string;
}

export interface ZuluInstallOutcome {
  ok: boolean;
  javaPath?: string;
  reason?: string;
}

export function zuluOs(platform: string): 'win' | 'linux' | 'macos' {
  if (platform === 'win32') return 'win';
  if (platform === 'darwin') return 'macos';
  return 'linux';
}

export function zuluArch(arch: string): 'x64' | 'aarch64' {
  return arch === 'arm64' ? 'aarch64' : 'x64';
}

/** 查询指定 JDK 大版本的最新 GA 包（按 os/arch 过滤，zip 归档）。 */
export async function queryZuluPackages(
  javaVersion: number,
  endpoints: Endpoints,
  fetchImpl: FetchImpl,
  platform: string,
  arch: string,
): Promise<ZuluPackage[]> {
  const params = new URLSearchParams({
    java_version: String(javaVersion),
    os: zuluOs(platform),
    arch: zuluArch(arch),
    archive_type: 'zip',
    java_package_type: 'jdk',
    latest: 'true',
    release_status: 'ga',
  });
  const res = await fetchImpl(`${endpoints.zuluMetadata}?${params.toString()}`);
  if (!res.ok) throw new Error(`Zulu 元数据 API HTTP ${res.status}`);
  const data = (await res.json()) as { name?: string; url?: string; sha256?: string }[];
  return data
    .filter((entry): entry is { name: string; url: string; sha256?: string } => Boolean(entry.name && entry.url))
    .map(({ name, url, sha256 }) => ({ name, url, ...(sha256 ? { sha256 } : {}) }));
}

/** 解压 zip：win 走 powershell Expand-Archive，其余走 unzip。 */
async function extractZip(zipPath: string, destDir: string, platform: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  if (platform === 'win32') {
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
      ],
      { windowsHide: true, timeout: 300_000 },
    );
  } else {
    await execFileAsync('unzip', ['-o', '-q', zipPath, '-d', destDir], { timeout: 300_000 });
  }
}

function findJavaExecutable(dir: string, platform: string): string | null {
  const binary = platform === 'win32' ? 'java.exe' : 'java';
  const direct = path.join(dir, 'bin', binary);
  if (fs.existsSync(direct)) return direct;
  try {
    for (const entry of fs.readdirSync(dir)) {
      const found = path.join(dir, entry, 'bin', binary);
      if (fs.existsSync(found)) return found;
    }
  } catch {
    /* 目录不可读 = 未找到 */
  }
  return null;
}

/** 下载 + 校验 + 解压一个 Zulu 包，返回 java 可执行路径；失败带原因。 */
export async function installZuluPackage(
  pkg: ZuluPackage,
  destRoot: string,
  deps: {
    client: BetacraftClient;
    platform?: string;
    onProgress?: (event: DownloadProgressEvent) => void;
  },
): Promise<ZuluInstallOutcome> {
  const platform = deps.platform ?? process.platform;
  try {
    const zipPath = path.join(destRoot, pkg.name);
    fs.mkdirSync(destRoot, { recursive: true });
    await deps.client.download(
      pkg.url,
      zipPath,
      'java-runtime',
      pkg.name,
      pkg.sha256 ? { algo: 'sha256', value: pkg.sha256 } : undefined,
    );
    const extractDir = path.join(destRoot, pkg.name.replace(/\.zip$/i, ''));
    await extractZip(zipPath, extractDir, platform);
    const javaPath = findJavaExecutable(extractDir, platform);
    if (!javaPath) return { ok: false, reason: `解压后未找到 bin/java：${extractDir}` };
    return { ok: true, javaPath };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
