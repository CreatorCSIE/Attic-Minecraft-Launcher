/**
 * Attic 自带的 legacyfix 挂载决策表（戒律 #1：quirk 矩阵是数据）。
 * 真实 betacraft `.info` 不含 agentMount——本表在 runtime 装配时并入 VersionJson.betacraft，
 * 区间判定仍走 launch.filterAgentMounts（versionOrder 来自版本清单缓存）。
 * 形态判定事实：legacyfix README——Vanilla/ModLoader/Forge ≤1.3 → javaagent；
 * Forge 1.4 → coremod；Forge ≥1.5 / Fabric 系 → mod。jar 本体统一落 `<root>/legacyfix/legacyfix.jar`
 * （数据供给面从 GitHub Release 下载，path 相对数据根）。
 */

import type { AgentMount } from '@attic/core-spec';

/**
 * 边界 id 均取 betacraft 清单实存值（2026-10 实测）：`c0.0.13a`/`1.4`/`1.7.10` 不在清单，
 * 分别以 `c0.0.13a`（缺省 → 区间头=fail-open，pre-classic 的 Applet 容器本就需要挂载）、
 * `1.4-pre`、`1.5.2`（v0 范围上限）表达。
 */
export const DEFAULT_AGENT_MOUNTS: AgentMount[] = [
  {
    form: 'javaagent',
    path: 'legacyfix/legacyfix.jar',
    appliesFrom: 'c0.0.13a',
    appliesTo: '1.3.2',
    quirk: 'legacyfix',
  },
  {
    form: 'coremod',
    path: 'legacyfix/legacyfix.jar',
    appliesFrom: '1.4-pre',
    appliesTo: '1.4.7',
    quirk: 'legacyfix',
  },
  {
    form: 'mod',
    path: 'legacyfix/legacyfix.jar',
    appliesFrom: '1.5',
    appliesTo: '1.5.2',
    quirk: 'legacyfix',
  },
];
