/**
 * Java 版本号解析（移植自 MCANextGen java-discovery/version.ts，逻辑不动）。
 * 1.x 系列必须折叠成裸特性号，否则 Java 8 会被报成 major 1。
 */

import type { JavaArchitecture, JavaVersion } from '@attic/core-spec';

export function parseJavaVersion(raw: string): JavaVersion | null {
  const cleaned = raw.trim().replace(/^"|"$/g, '');
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[_.-](\d+))?/.exec(cleaned);
  if (!match) return null;

  const first = Number(match[1]);
  const second = Number(match[2] ?? '0');
  const third = Number(match[3] ?? '0');
  const fourth = match[4];

  const major = first === 1 && second > 0 ? second : first;
  const minor = first === 1 && second > 0 ? third : second;
  const patch = fourth === undefined ? (first === 1 ? 0 : third) : Number(fourth);

  return { raw: cleaned, major, minor, patch };
}

/** 从 `java -version` banner 首行提取引号内版本号。 */
export function parseVersionBanner(banner: string): JavaVersion | null {
  const line = banner.split(/\r?\n/).find((entry) => entry.trim().length > 0) ?? '';
  const match = /version\s+"([^"]+)"/.exec(line);
  const quoted = match?.[1];
  if (!quoted) return null;

  const version = parseJavaVersion(quoted);
  if (!version) return null;

  const runtime = /build\s+([^\s)]+)/.exec(banner);
  const vendor = /(Java\(TM\)|OpenJDK)/.exec(line)?.[1];

  return { ...version, runtimeRaw: runtime?.[1], vendor: vendor ?? undefined };
}

/** JVM `os.arch` 属性 → 契约架构枚举。 */
export function normaliseArchitecture(osArch: string): JavaArchitecture {
  const arch = osArch.trim().toLowerCase();
  if (arch === 'amd64' || arch === 'x86_64' || arch === 'x64' || arch === 'em64t') return 'x86_64';
  if (/^(i[3-6]86|x86)$/.test(arch)) return 'x86';
  if (arch === 'aarch64' || arch === 'arm64') return 'arm64';
  if (/^arm/.test(arch)) return 'arm';
  return 'unknown';
}
