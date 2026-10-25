/**
 * 检查更新数据面（GitHub Releases，零依赖自包含）。
 * 事实来源：`https://api.github.com/repos/{owner}/{repo}/releases/latest`
 * —— /latest 端点天然排除 draft/prerelease，不消费 latest.json（无自托管清单依赖）。
 * semver 比较自研：数字段逐位比较（缺段按 0：1.0 == 1.0.0）；tag 去 v 前缀；
 * 预发布纪律：自身或 latest 含 `-`（预发布/构建后缀）→ 永不提示（归 upToDate，
 * 数字段对预发布比较无意义，误报比漏报烦人）。
 * UA 纪律：GitHub API 无 User-Agent 一律 403 —— 请求头带 `Attic/<version>`（契约门面注入）。
 */

import type { UpdateCheckResult } from '@attic/core-spec';

import type { FetchImpl } from './betacraft';

export interface UpdateCheckDeps {
  /** 发布仓库 "owner/repo"（构造选项 releaseRepo，env ATTIC_RELEASE_REPO 兜底；缺省 = unconfigured）。 */
  releaseRepo?: string;
  /** 当前版本（宿主注入的启动器版本）。 */
  currentVersion: string;
  /** 网络注入面（与 betacraft 同款：测试/离线可换 fake fetch）。 */
  fetchImpl: FetchImpl;
}

/** releases/latest 响应中消费的字段（其余原样忽略）。 */
interface LatestReleaseRaw {
  tag_name?: unknown;
  html_url?: unknown;
  body?: unknown;
  published_at?: unknown;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 版本号拆数字段（v 前缀剥离；非数字段按 0 —— 预发布拦截在调用方，不进本函数语义面）。 */
function numericSegments(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((seg) => {
      const n = Number.parseInt(seg, 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    });
}

/**
 * semver 数字段比较：a<b → -1，相等 → 0，a>b → 1。
 * 长度不齐缺段按 0 补齐（0.0.9 < 0.1.0、1.9.0 < 1.10.0 均按数值位而非字典序）。
 */
export function compareSemver(a: string, b: string): number {
  const sa = numericSegments(a);
  const sb = numericSegments(b);
  const len = Math.max(sa.length, sb.length);
  for (let i = 0; i < len; i++) {
    const x = sa[i] ?? 0;
    const y = sb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * 拉取 GitHub 最新 Release 并与当前版本比较。
 * 全分支数据化返回（不抛）：仓库未配置 = unconfigured；格式非法/网络炸/非 2xx/响应缺 tag_name = error。
 */
export async function checkLatestRelease(deps: UpdateCheckDeps): Promise<UpdateCheckResult> {
  const repo = deps.releaseRepo?.trim() ?? '';
  if (!repo) return { status: 'unconfigured' };
  const parts = repo.split('/');
  if (parts.length !== 2 || parts.some((p) => p === '' || p !== p.trim())) {
    return { status: 'error', message: `发布仓库格式非法：${JSON.stringify(repo)}（期望 "owner/repo"）` };
  }
  const [owner, name] = parts as [string, string];
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/releases/latest`;
  let res: Response;
  try {
    res = await deps.fetchImpl(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        // GitHub API 强制 UA（无则 403）；版本串原样入 UA。
        'User-Agent': `Attic/${deps.currentVersion}`,
      },
    });
  } catch (error) {
    return { status: 'error', message: `检查更新请求失败：${messageOf(error)}` };
  }
  if (!res.ok) {
    const hint = res.status === 404 ? '（仓库不存在或尚无 Release）' : res.status === 403 ? '（限流或 UA 被拒）' : '';
    return { status: 'error', message: `检查更新失败：GitHub API HTTP ${res.status}${hint}` };
  }
  let raw: LatestReleaseRaw;
  try {
    raw = (await res.json()) as LatestReleaseRaw;
  } catch (error) {
    return { status: 'error', message: `检查更新失败：响应不是合法 JSON（${messageOf(error)}）` };
  }
  const tag = typeof raw.tag_name === 'string' ? raw.tag_name.trim() : '';
  if (!tag) return { status: 'error', message: '检查更新失败：Release 响应缺少 tag_name' };
  const current = deps.currentVersion;
  // 预发布纪律（见文件头）：任一侧含 `-` → 永不提示。
  if (current.includes('-') || tag.includes('-')) return { status: 'upToDate', current };
  const version = tag.replace(/^v/i, '');
  if (compareSemver(version, current) <= 0) return { status: 'upToDate', current };
  return {
    status: 'update',
    version,
    url: typeof raw.html_url === 'string' ? raw.html_url : '',
    notes: typeof raw.body === 'string' ? raw.body : '',
    publishedAt: typeof raw.published_at === 'string' ? raw.published_at : '',
  };
}
