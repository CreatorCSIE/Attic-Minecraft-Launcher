/**
 * Java 候选验证（移植自 MCANextGen java-discovery/probe.ts，逻辑不动）。
 * 唯一可信的判定是真实执行 `-XshowSettings:properties -version`：
 * 一个叫 jre1.8 的目录说明不了里面二进制是什么。
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import type { JavaArchitecture, JavaDiscoverySource, JavaInstall, JavaVersion } from '@attic/core-spec';

import { normaliseArchitecture, parseJavaVersion, parseVersionBanner } from './version';

const execFileAsync = promisify(execFile);

export interface ProbeSuccess {
  ok: true;
  install: JavaInstall;
}

export interface ProbeFailure {
  ok: false;
  reason: string;
}

export type ProbeResult = ProbeSuccess | ProbeFailure;

const PROPERTIES = ['java.version', 'java.runtime.version', 'java.home', 'java.vendor', 'os.arch'] as const;

function readProperties(output: string): Record<string, string> {
  const properties: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*([a-zA-Z0-9._-]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    if (!key) continue;
    if ((PROPERTIES as readonly string[]).includes(key)) {
      properties[key] = (match[2] ?? '').trim();
    }
  }
  return properties;
}

async function run(executable: string, args: string[], timeoutMs: number): Promise<string> {
  const { stdout, stderr } = await execFileAsync(executable, args, {
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    encoding: 'utf8',
  });
  // `-version` 与 `-XshowSettings` 都打到 stderr。
  return `${stderr}\n${stdout}`;
}

function versionFrom(
  versionRaw: string,
  runtimeRaw: string | undefined,
  vendor: string | undefined,
): JavaVersion | null {
  const version = parseJavaVersion(versionRaw);
  if (!version) return null;
  return { ...version, runtimeRaw, vendor };
}

export async function probeJavaExecutable(
  executable: string,
  source: JavaDiscoverySource,
  timeoutMs = 6_000,
): Promise<ProbeResult> {
  const startedAt = Date.now();

  if (!existsSync(executable)) {
    return { ok: false, reason: `${path.basename(executable)} does not exist` };
  }

  let output: string;
  try {
    output = await run(executable, ['-XshowSettings:properties', '-version'], timeoutMs);
  } catch (error) {
    const reason = describeSpawnError(error, timeoutMs);
    // 老 JVM / 厂商魔改 JVM 偶尔拒绝 -XshowSettings。
    if (reason !== 'probe-timeout') {
      try {
        output = await run(executable, ['-version'], timeoutMs);
      } catch {
        return { ok: false, reason };
      }
    } else {
      return { ok: false, reason };
    }
  }

  const properties = readProperties(output);
  const version =
    versionFrom(properties['java.version'] ?? '', properties['java.runtime.version'], properties['java.vendor']) ??
    parseVersionBanner(output);

  if (!version) {
    return { ok: false, reason: 'unparseable java -version output' };
  }

  const architecture: JavaArchitecture = properties['os.arch']
    ? normaliseArchitecture(properties['os.arch'])
    : architectureFromBanner(output);

  return {
    ok: true,
    install: {
      ...version,
      executable,
      javaHome: properties['java.home'] ?? defaultJavaHome(executable),
      architecture,
      source,
      probeDurationMs: Date.now() - startedAt,
    },
  };
}

/** banner 里的 `Java HotSpot(TM) 64-Bit Server VM` 是可用的兜底信号。 */
function architectureFromBanner(output: string): JavaArchitecture {
  if (/64-Bit/i.test(output)) return 'x86_64';
  if (/(32-Bit|Client VM)/i.test(output)) return 'x86';
  return 'unknown';
}

function defaultJavaHome(executable: string): string {
  return path.dirname(path.dirname(executable));
}

function describeSpawnError(error: unknown, timeoutMs: number): string {
  const err = error as { killed?: boolean; code?: string | number; signal?: string | null };
  if (err.killed === true) return `probe-timeout after ${timeoutMs}ms`;
  if (typeof err.code === 'string') return err.code;
  if (typeof err.code === 'number') return `java exited with code ${err.code}`;
  return 'java did not report a version';
}
