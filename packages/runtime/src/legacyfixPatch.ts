/**
 * legacyfix jar DeAwtPatch 常量池补丁 —— applet 容器窗口偏右下 + 0x0 坍缩崩溃的修复。
 *
 * 机理（本机 jar Utf8 常量实锤，LWJGL 2.9.0/2.9.3 同构）：
 * - DeAwtPatch.transformDisplay 用 javassist 把 Display.setParent 方法体整段替换为
 *   字符串常量（javac 编译期折叠为单个 CONSTANT_Utf8 条目）；注入体 setDisplayMode 直接
 *   取 child.getWidth/Height——applet 布局未定时为 0 → 窗口坍缩 0x0 → 首帧
 *   EntityRenderer `Mouse.getX()*w/mc.displayWidth` 整数除零崩溃（in-20100223 反混淆实证）；
 *   且只设尺寸不设位置 → 高 DPI 混缩放下 getWindowX/Y 居中公式 initial/current 不同源，窗口偏右下。
 * - DeAwtPatch$4（匿名 ExprEditor，挂在游戏类方法调用后）是上游 7c19418 引入的 resize-sync：
 *   Display 实际尺寸 != 游戏 width/height 字段时回写 setSize——Display 已 0x0 时把 0 传播进
 *   displayWidth，同样触除零。其注入源经 StringBuilder 多段拼接，dW/dH 两句完整落在 Utf8[77]。
 *
 * 补丁 V2（在 V1 setLocation 基础上加保底分辨率钳制，两处注入体）：
 * - 外层类：DisplayMode 实参换 `Math.max(child.getW(), Integer.getInteger("lf.minW",854).intValue())`，
 *   setLocation 交接 frame 坐标保留（V1 语义）；
 * - $4：dW/dH 读取处同样 Math.max 钳保底；
 * - 保底值通道 = 启动器对 applet 容器版本注入 `-Dlf.minW/-Dlf.minH=<实例启动尺寸>`（launch.ts），
 *   缺席兜底 854x480。不走 GameArgs.getValue 反射：旧版 legacyfix.jar 的 GameArgs 无此方法
 *   （javap 实证），反射必退化；-D 通道两代 jar 通吃且注入体无需反射样板。
 *
 * 安全门（教训：绝不静默降级）：
 * - SHA256 钉版：外层类接受 raw∪V1 两态（V1 升级路径），$4 只接受 raw（V1 从未碰它）；
 *   表外版本一律不碰（换 legacyfix 版本需实测锚点语义后在钉版表补行）；
 * - 半补丁态（外层/$4 标记只有一处命中）→ 拒绝，不猜测；
 * - 锚点全文唯一（恰 1 次出现且落在恰 1 个 Utf8 条目）才替换；
 * - 幂等：两类条目均已含 lf.minW 标记 → already，不重复改写；
 * - 任何失败（含异常）→ 原 jar 原样保留，跳过 + 显式诊断（applet 容器维持原行为）；
 * - class 文件常量池按索引引用、无绝对偏移依赖，改单个 Utf8 条目长度合法
 *   （补丁后 javap -v exit=0/常量池全量重解析验证）。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readZipEntries, writeZipEntries } from './zip';

const DEAWT_ENTRY = 'uk/betacraft/legacyfix/patch/impl/lwjgl/DeAwtPatch.class';
const DEAWT4_ENTRY = 'uk/betacraft/legacyfix/patch/impl/lwjgl/DeAwtPatch$4.class';

const latin1 = (s: string): Buffer => Buffer.from(s, 'latin1');

/** 外层类 raw 注入体锚点：setDisplayMode 整句（javassist 源字符串片段，ASCII）。 */
export const ANCHOR = latin1(
  'org.lwjgl.opengl.Display.setDisplayMode(new org.lwjgl.opengl.DisplayMode(child.getWidth(), child.getHeight()));'
);
/** V1 补丁态 = 锚点 + setLocation 交接句（历史已发形态，raw→V1；现为 V1→V2 升级路径的 needle）。 */
export const PATCHED_V1 = latin1(
  'org.lwjgl.opengl.Display.setDisplayMode(new org.lwjgl.opengl.DisplayMode(child.getWidth(), child.getHeight()));org.lwjgl.opengl.Display.setLocation(frame.getX(), frame.getY());'
);
/** V2 目标态：保底钳制 + setLocation（既非锚点亦非 V1 的子串，可作唯一判据）。 */
export const PATCHED_V2 = latin1(
  'org.lwjgl.opengl.Display.setDisplayMode(new org.lwjgl.opengl.DisplayMode(Math.max(child.getWidth(), Integer.getInteger("lf.minW", 854).intValue()), Math.max(child.getHeight(), Integer.getInteger("lf.minH", 480).intValue())));org.lwjgl.opengl.Display.setLocation(frame.getX(), frame.getY());'
);

/** $4 注入体 dW/dH 两句（raw needle → V2 replacement）。 */
export const DW_NEEDLE = latin1('int dW = org.lwjgl.opengl.Display.getWidth();');
export const DW_REPL = latin1(
  'int dW = Math.max(org.lwjgl.opengl.Display.getWidth(), Integer.getInteger("lf.minW", 854).intValue());'
);
export const DH_NEEDLE = latin1('int dH = org.lwjgl.opengl.Display.getHeight();');
export const DH_REPL = latin1(
  'int dH = Math.max(org.lwjgl.opengl.Display.getHeight(), Integer.getInteger("lf.minH", 480).intValue());'
);

/** V2 完成标记（外层与 $4 的 replacement 都含它；raw/V1 态无）。 */
const MIN_MARKER = latin1('lf.minW');

/** 已实机验证过锚点语义的外层 DeAwtPatch.class 明文 SHA256（hex 小写，raw∪V1 双态）。 */
export const PINNED_DEAWT_CLASS_SHA256 = new Set([
  'bcf09fe03447d04fdd5c047e5b1954ec2021eb2957c8f12012f7a79496331b0e', // 2026-10 实测 legacyfix.jar（本机，raw）
  // 26.10 Release（2026-10-22 实测构件，raw）：锚点恰 1 次、无补丁串（upstream 未合 setLocation，
  // 窗口补丁仍必要）；哈希与 2026-10-18 nightly 实测同值（0394721 起 DeAwtPatch.java 的漂移形态）。
  'd1003d49a286c48696992427f63ac9d4efa105700c4fbf3b3d0d0156ece3b7ef',
  // V1 态（setLocation 已注入，本机两 jar 实打实测哈希）：V1→V2 升级路径。
  '80c90cbeaaf63794a8ac8474ab164b607179aac6e143bda4cfd52d7dff69d301', // legacyfix.jar V1
  'c53281987c9c011b6523c457ac4cfead84141c00597322965e04131235dbdd28', // legacyfix-26.10.jar V1
]);

/** $4 类明文 SHA256（raw 态；V1 补丁从未触碰该条目，本机现值即 raw）。 */
export const PINNED_DEAWT4_CLASS_SHA256 = new Set([
  'a41e11669fc45ef5224b7d0d11c1b3bf8080823a53f38103eda7df8f4f10caa1', // legacyfix.jar（2026-10-18 实测）
  '56ef00d5c64d510cfee1c2ac4fca9822e26f1791a18ce84c9a3da043a1c1dbb6', // legacyfix-26.10.jar（2026-10-22 实测）
]);

export type LfPatchOutcome =
  | { status: 'patched' }
  | { status: 'already' }
  | { status: 'skipped'; reason: string };

/** 统计 buf 中 needle 出现次数（上限 stopAt，防大 jar 空转）。 */
function countOccurrences(buf: Buffer, needle: Buffer, stopAt: number): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = buf.indexOf(needle, from);
    if (idx < 0) return count;
    count++;
    if (count >= stopAt) return count;
    from = idx + 1;
  }
}

/**
 * 改写 class 字节：定位含 needle 的单个 CONSTANT_Utf8 条目，替换首个命中后重建（长度前缀同步）。
 * 返回 null = 不可安全补丁（magic 坏/再入（replacement 已在）/needle 缺失或多条目命中/未知常量池 tag/超 65535）。
 */
export function patchUtf8Entry(classBytes: Buffer, needle: Buffer, replacement: Buffer): Buffer | null {
  if (classBytes.length < 10 || classBytes.readUInt32BE(0) !== 0xcafebabe) return null;
  // 再入护栏：replacement 已存在即拒绝（防双重插入/重复替换）。
  if (classBytes.indexOf(replacement) >= 0) return null;
  if (countOccurrences(classBytes, needle, 2) !== 1) return null;

  const cpCount = classBytes.readUInt16BE(8);
  let p = 10;
  let target = -1; // 命中 Utf8 条目首字节（tag 处）
  let hits = 0;
  for (let i = 1; i < cpCount; i++) {
    const tag = classBytes[p];
    if (tag === 1) {
      const len = classBytes.readUInt16BE(p + 1);
      const content = classBytes.subarray(p + 3, p + 3 + len);
      if (content.indexOf(needle) >= 0) {
        hits++;
        target = p;
      }
      p += 3 + len;
    } else if (tag === 3 || tag === 4 || tag === 9 || tag === 10 || tag === 11 || tag === 12) {
      p += 5;
    } else if (tag === 5 || tag === 6) {
      p += 9;
      i++; // long/double 占两个常量池槽位
    } else if (tag === 7 || tag === 8 || tag === 16 || tag === 19 || tag === 20) {
      p += 3;
    } else if (tag === 15) {
      p += 4;
    } else if (tag === 17 || tag === 18) {
      p += 5;
    } else {
      return null; // 未知 tag：结构不可信，放弃
    }
    if (p > classBytes.length) return null;
  }
  if (hits !== 1 || target < 0) return null;

  const len = classBytes.readUInt16BE(target + 1);
  const content = Buffer.from(classBytes.subarray(target + 3, target + 3 + len));
  const idx = content.indexOf(needle);
  const replaced = Buffer.concat([
    content.subarray(0, idx),
    replacement,
    content.subarray(idx + needle.length),
  ]);
  if (replaced.length > 0xffff) return null;

  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(replaced.length, 0);
  return Buffer.concat([
    classBytes.subarray(0, target + 1),
    lenBuf,
    replaced,
    classBytes.subarray(target + 3 + len),
  ]);
}

/**
 * 对 jar 原位应用 DeAwtPatch V2 补丁（保底分辨率 + 窗口位置；幂等；供 legacyfix jar 下载落位后调用）。
 * 永不抛错：任何失败 = 原 jar 保留 + skipped 诊断。pins 仅测试注入用，缺省走内置钉版表。
 */
export function applyLegacyfixDeawtPatch(
  jarPath: string,
  outerPins: Set<string> = PINNED_DEAWT_CLASS_SHA256,
  p4Pins: Set<string> = PINNED_DEAWT4_CLASS_SHA256
): LfPatchOutcome {
  try {
    if (!fs.existsSync(jarPath)) return { status: 'skipped', reason: 'jar 不存在' };
    const entries = readZipEntries(jarPath);
    const outer = entries.find((e) => e.name === DEAWT_ENTRY);
    if (!outer) return { status: 'skipped', reason: '无 DeAwtPatch.class 条目（非标准 legacyfix jar）' };
    const p4 = entries.find((e) => e.name === DEAWT4_ENTRY);
    if (!p4) return { status: 'skipped', reason: '无 DeAwtPatch$4.class 条目（非标准 legacyfix jar）' };

    const outerMarked = outer.data.indexOf(MIN_MARKER) >= 0;
    const p4Marked = p4.data.indexOf(MIN_MARKER) >= 0;
    if (outerMarked && p4Marked) return { status: 'already' };
    if (outerMarked !== p4Marked) {
      return { status: 'skipped', reason: '半补丁态（外层/$4 保底标记不一致），不触碰原 jar' };
    }

    const sha = (buf: Buffer): string => crypto.createHash('sha256').update(buf).digest('hex');
    const outerSha = sha(outer.data);
    if (!outerPins.has(outerSha)) {
      return { status: 'skipped', reason: `DeAwtPatch.class 未钉版（sha256=${outerSha}），窗口补丁未应用` };
    }
    const p4Sha = sha(p4.data);
    if (!p4Pins.has(p4Sha)) {
      return { status: 'skipped', reason: `DeAwtPatch$4.class 未钉版（sha256=${p4Sha}），窗口补丁未应用` };
    }

    // 外层：V1 态走 PATCHED_V1 needle（升级），raw 态走 ANCHOR needle（一步到位 V2）。
    const newOuter =
      outer.data.indexOf(PATCHED_V1) >= 0
        ? patchUtf8Entry(outer.data, PATCHED_V1, PATCHED_V2)
        : patchUtf8Entry(outer.data, ANCHOR, PATCHED_V2);
    if (!newOuter) return { status: 'skipped', reason: `外层锚点非唯一/常量池不可解析（sha256=${outerSha}）` };

    // $4：两句在同一 Utf8 条目，分两趟各换各的（每趟重解析常量池，needle 仍全文唯一）。
    let newP4 = patchUtf8Entry(p4.data, DW_NEEDLE, DW_REPL);
    if (newP4) newP4 = patchUtf8Entry(newP4, DH_NEEDLE, DH_REPL);
    if (!newP4) return { status: 'skipped', reason: `$4 锚点非唯一/常量池不可解析（sha256=${p4Sha}）` };

    outer.data = newOuter;
    p4.data = newP4;

    // 原子回写：temp 文件 + rename；随后重读自检（V2 串与 $4 两句俱在，标记恰 1 次）。
    const tmp = `${jarPath}.deawt-patch.tmp`;
    writeZipEntries(tmp, entries);
    fs.renameSync(tmp, jarPath);
    const reread = readZipEntries(jarPath);
    const ro = reread.find((e) => e.name === DEAWT_ENTRY);
    const r4 = reread.find((e) => e.name === DEAWT4_ENTRY);
    if (
      !ro ||
      !r4 ||
      ro.data.indexOf(PATCHED_V2) < 0 ||
      countOccurrences(ro.data, MIN_MARKER, 2) !== 1 ||
      r4.data.indexOf(DW_REPL) < 0 ||
      r4.data.indexOf(DH_REPL) < 0
    ) {
      return { status: 'skipped', reason: '回写自检失败（原形态不可确认）' };
    }
    return { status: 'patched' };
  } catch (error) {
    try {
      fs.rmSync(`${jarPath}.deawt-patch.tmp`, { force: true });
    } catch {
      /* temp 不存在 */
    }
    return { status: 'skipped', reason: `补丁异常，原 jar 保留：${error instanceof Error ? error.message : String(error)}` };
  }
}

/** 诊断输出统一走 [attic-runtime] 前缀（process.ts 同款通道，不静默）。 */
export function reportLegacyfixDeawtPatch(jarPath: string, outcome: LfPatchOutcome): void {
  if (outcome.status === 'patched') {
    console.log(`[attic-runtime] legacyfix deawt-patch applied: ${path.basename(jarPath)}（保底分辨率 + 窗口偏右下修复）`);
  } else if (outcome.status === 'skipped') {
    console.log(`[attic-runtime] legacyfix deawt-patch skipped: ${outcome.reason}`);
  }
}
