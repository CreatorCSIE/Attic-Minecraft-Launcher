// legacyfix DeAwtPatch V2 常量池补丁：合成 outer/$4 双条目 class 与 jar 夹具，
// 覆盖 raw→V2、V1→V2 升级、半补丁拒绝、钉版/条目门控、patchUtf8Entry 单元门控与 zip 工具链兼容。
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  applyLegacyfixDeawtPatch,
  patchUtf8Entry,
  readZipEntries,
  writeZipEntries,
  listZipEntryNames,
  extractZipTo,
  ANCHOR,
  PATCHED_V1,
  PATCHED_V2,
  DW_NEEDLE,
  DW_REPL,
  DH_NEEDLE,
  DH_REPL,
} = require('../dist/index.js');

const DEAWT_ENTRY = 'uk/betacraft/legacyfix/patch/impl/lwjgl/DeAwtPatch.class';
const DEAWT4_ENTRY = 'uk/betacraft/legacyfix/patch/impl/lwjgl/DeAwtPatch$4.class';

const S = (b) => b.toString('latin1');
const ANCHOR_S = S(ANCHOR);
const V1_S = S(PATCHED_V1);
const V2_S = S(PATCHED_V2);
const DW_N_S = S(DW_NEEDLE);
const DW_R_S = S(DW_REPL);
const DH_N_S = S(DH_NEEDLE);
const DH_R_S = S(DH_REPL);
const MIN_MARKER = 'lf.minW';
const countStr = (hay, needle) => hay.split(needle).length - 1;
const sha256Hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/**
 * 合成 class：合法 header + 常量池（若干 Utf8、Class、Integer、Long 双槽）+ 尾部原始区段。
 * patchUtf8Entry 只解析常量池，其后字节原样保留。
 */
function buildSyntheticClass(utf8Strings) {
  const parts = [];
  const head = Buffer.alloc(10);
  head.writeUInt32BE(0xcafebabe, 0);
  head.writeUInt16BE(0, 4); // minor
  head.writeUInt16BE(52, 6); // major（JDK8）
  // 槽位：utf8 组 + Class(1) + Integer(1) + Long(2)；cpCount = 槽位 + 1（Long 的 i++ 使循环恰好在耗尽时停）
  head.writeUInt16BE(utf8Strings.length + 4, 8);
  parts.push(head);
  for (const u of utf8Strings) {
    const t = Buffer.alloc(3);
    t.writeUInt8(1, 0);
    t.writeUInt16BE(Buffer.byteLength(u, 'latin1'), 1);
    parts.push(t, Buffer.from(u, 'latin1'));
  }
  const classEnt = Buffer.alloc(3);
  classEnt.writeUInt8(7, 0);
  classEnt.writeUInt16BE(1, 1);
  parts.push(classEnt);
  const intEnt = Buffer.alloc(5);
  intEnt.writeUInt8(3, 0);
  intEnt.writeUInt32BE(42, 1);
  parts.push(intEnt);
  const longEnt = Buffer.alloc(9);
  longEnt.writeUInt8(5, 0);
  longEnt.writeBigUInt64BE(7n, 1);
  parts.push(longEnt);
  parts.push(Buffer.from('METHODS-AND-ATTRIBUTES-RAW-REGION', 'latin1'));
  return Buffer.concat(parts);
}

/** 外层类 setParent 折叠源串：anchorLine 决定 raw / V1 / V2 形态。 */
function outerClass(anchorLine, extraUtf8Anchor = false) {
  const body =
    '{    if ($1 == null) return;    java.awt.Frame frame = (java.awt.Frame) parent;' +
    `    ${anchorLine}` +
    '    org.lwjgl.opengl.Display.setResizable(true);}';
  const utf8s = [body, 'uk/betacraft/legacyfix/patch/impl/lwjgl/DeAwtPatch'];
  if (extraUtf8Anchor) utf8s.push(`pad ${ANCHOR_S} pad`);
  return buildSyntheticClass(utf8s);
}

/** $4 匿名 ExprEditor 注入体（真机为 StringBuilder 多段拼接，dW/dH 两句同 Utf8）：raw / V2 形态。 */
function p4Class(v2 = false) {
  const body = v2
    ? `{    ${DW_R_S}    ${DH_R_S}    if (dW != width || dH != height) { Display.setSize(dW, dH); } }`
    : `{    ${DW_N_S}    ${DH_N_S}    if (dW != width || dH != height) { Display.setSize(dW, dH); } }`;
  return buildSyntheticClass([body, 'uk/betacraft/legacyfix/patch/impl/lwjgl/DeAwtPatch$4']);
}

function buildJar(outer, p4, t, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attic-lfpatch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const jar = path.join(dir, 'legacyfix.jar');
  const entries = [
    { name: 'META-INF/MANIFEST.MF', method: 8, dosTime: 0x4445, dosDate: 0x5678, data: Buffer.from('Manifest-Version: 1.0\r\n\r\n', 'latin1') },
    { name: DEAWT_ENTRY, method: 8, dosTime: 0x1234, dosDate: 0x2345, data: outer },
  ];
  if (!opts.skipP4) {
    entries.push({ name: DEAWT4_ENTRY, method: 8, dosTime: 0x3456, dosDate: 0x4567, data: p4 });
  }
  entries.push({ name: 'uk/betacraft/legacyfix/Agent.class', method: 0, dosTime: 0, dosDate: 0, data: Buffer.from('AGENT-PLACEHOLDER', 'latin1') });
  writeZipEntries(jar, entries);
  return { jar, dir };
}

const outerPinsOf = (outer) => new Set([sha256Hex(outer)]);
const p4PinsOf = (p4) => new Set([sha256Hex(p4)]);

test('jar 原位补丁：raw→patched（双条目 V2），重入 already，其余条目不变，zip 工具链兼容', (t) => {
  const outer = outerClass(ANCHOR_S);
  const p4 = p4Class(false);
  const { jar } = buildJar(outer, p4, t);

  assert.deepEqual(applyLegacyfixDeawtPatch(jar, outerPinsOf(outer), p4PinsOf(p4)), { status: 'patched' });
  const entries = readZipEntries(jar);
  const ro = entries.find((e) => e.name === DEAWT_ENTRY);
  const r4 = entries.find((e) => e.name === DEAWT4_ENTRY);
  const roText = S(ro.data);
  const r4Text = S(r4.data);
  assert.ok(roText.includes(V2_S), '外层应含 V2 串');
  assert.equal(countStr(roText, MIN_MARKER), 1, '外层 lf.minW 标记恰 1 次');
  assert.ok(r4Text.includes(DW_R_S) && r4Text.includes(DH_R_S), '$4 两句应换为保底钳制形态');
  assert.equal(countStr(r4Text, MIN_MARKER), 1, '$4 lf.minW 标记恰 1 次');
  // 其余条目字节不变
  const agent = entries.find((e) => e.name === 'uk/betacraft/legacyfix/Agent.class');
  assert.equal(S(agent.data), 'AGENT-PLACEHOLDER');
  const mf = entries.find((e) => e.name === 'META-INF/MANIFEST.MF');
  assert.equal(S(mf.data), 'Manifest-Version: 1.0\r\n\r\n');

  // 幂等重入：双标记 → already，不改写
  const before = fs.readFileSync(jar);
  assert.deepEqual(applyLegacyfixDeawtPatch(jar, outerPinsOf(outer), p4PinsOf(p4)), { status: 'already' });
  assert.ok(fs.readFileSync(jar).equals(before), 'already 不应触碰 jar');

  // zip 工具链兼容：中央目录清单 + 全量解出
  const names = listZipEntryNames(jar).sort();
  assert.deepEqual(names, ['META-INF/MANIFEST.MF', DEAWT_ENTRY, DEAWT4_ENTRY, 'uk/betacraft/legacyfix/Agent.class'].sort());
  const outDir = path.join(path.dirname(jar), 'extract');
  assert.equal(extractZipTo(jar, outDir), 4);
  assert.ok(fs.readFileSync(path.join(outDir, DEAWT_ENTRY)).equals(ro.data));
  assert.ok(fs.readFileSync(path.join(outDir, DEAWT4_ENTRY)).equals(r4.data));
});

test('V1 升级路径：外层 V1 态 + $4 raw → patched（V2 在、V1 灭）', (t) => {
  const outer = outerClass(V1_S);
  const p4 = p4Class(false);
  const { jar } = buildJar(outer, p4, t);

  assert.deepEqual(applyLegacyfixDeawtPatch(jar, outerPinsOf(outer), p4PinsOf(p4)), { status: 'patched' });
  const ro = readZipEntries(jar).find((e) => e.name === DEAWT_ENTRY);
  const roText = S(ro.data);
  assert.ok(roText.includes(V2_S), '升级后应含 V2 串');
  assert.ok(!roText.includes(V1_S), 'V1 串应被替换掉');
  assert.ok(roText.includes('org.lwjgl.opengl.Display.setLocation(frame.getX(), frame.getY());'), 'V1 的 setLocation 语义应保留');
});

test('半补丁态：外层已带 lf.minW、$4 未带 → skipped，jar 字节不变', (t) => {
  const outer = outerClass(V2_S);
  const p4 = p4Class(false);
  const { jar } = buildJar(outer, p4, t);
  const before = fs.readFileSync(jar);

  const r = applyLegacyfixDeawtPatch(jar, outerPinsOf(outer), p4PinsOf(p4));
  assert.equal(r.status, 'skipped');
  assert.match(r.reason, /半补丁态/);
  assert.ok(fs.readFileSync(jar).equals(before), '半补丁态绝不猜测改写');
});

test('门控：外层未钉版 / $4 未钉版 / 缺 $4 条目 / jar 不存在 → skipped 且原 jar 不动', (t) => {
  const outer = outerClass(ANCHOR_S);
  const p4 = p4Class(false);
  const { jar, dir } = buildJar(outer, p4, t);
  const before = fs.readFileSync(jar);

  const missOuter = applyLegacyfixDeawtPatch(jar, new Set(['f'.repeat(64)]), p4PinsOf(p4));
  assert.equal(missOuter.status, 'skipped');
  assert.match(missOuter.reason, /DeAwtPatch\.class 未钉版/);
  assert.ok(fs.readFileSync(jar).equals(before), '未钉版绝不改写 jar');

  const missP4 = applyLegacyfixDeawtPatch(jar, outerPinsOf(outer), new Set(['e'.repeat(64)]));
  assert.equal(missP4.status, 'skipped');
  assert.match(missP4.reason, /DeAwtPatch\$4\.class 未钉版/);
  assert.ok(fs.readFileSync(jar).equals(before));

  const { jar: noP4 } = buildJar(outer, p4, t, { skipP4: true });
  const r2 = applyLegacyfixDeawtPatch(noP4, outerPinsOf(outer), p4PinsOf(p4));
  assert.equal(r2.status, 'skipped');
  assert.match(r2.reason, /无 DeAwtPatch\$4\.class/);

  const r3 = applyLegacyfixDeawtPatch(path.join(dir, 'missing.jar'), new Set(), new Set());
  assert.equal(r3.status, 'skipped');
});

test('patchUtf8Entry 单元：needle 命中单条目替换成功，长度前缀同步、尾部原样', () => {
  const classBytes = outerClass(ANCHOR_S);
  const patched = patchUtf8Entry(classBytes, ANCHOR, PATCHED_V2);
  assert.ok(patched, '应成功补丁');
  const text = S(patched);
  assert.ok(text.includes(V2_S) && !text.includes(ANCHOR_S), 'V2 换入、锚点换出');
  assert.equal(patched.length, classBytes.length + (PATCHED_V2.length - ANCHOR.length), '长度差=串差');
  assert.equal(
    S(patched.subarray(patched.length - 30)),
    S(classBytes.subarray(classBytes.length - 30)),
    '尾部原始区段逐字节不变'
  );
  // 常量池重解析：条目数不变、magic 不变
  assert.equal(patched.readUInt32BE(0), 0xcafebabe);
  assert.equal(patched.readUInt16BE(8), classBytes.readUInt16BE(8));
});

test('patchUtf8Entry 门控：needle 缺失 / 双条目命中 / 坏 magic / 未知 tag / 再入 → null', () => {
  const base = outerClass(ANCHOR_S);
  // needle 缺失
  const noAnchor = outerClass('org.lwjgl.opengl.Display.setFullScreen(true);');
  assert.equal(patchUtf8Entry(noAnchor, ANCHOR, PATCHED_V2), null);
  // 双 Utf8 条目各含锚点 → hits!=1 拒绝
  assert.equal(patchUtf8Entry(outerClass(ANCHOR_S, true), ANCHOR, PATCHED_V2), null);
  // 坏 magic
  const badMagic = Buffer.from(base);
  badMagic.writeUInt32BE(0xdeadbeef, 0);
  assert.equal(patchUtf8Entry(badMagic, ANCHOR, PATCHED_V2), null);
  // 未知 tag（utf8 组后第一个 Class 条目 tag 7 → 99）
  const badTag = Buffer.from(base);
  let p = 10;
  for (;;) {
    if (badTag[p] === 1) p += 3 + badTag.readUInt16BE(p + 1);
    else break;
  }
  badTag[p] = 99;
  assert.equal(patchUtf8Entry(badTag, ANCHOR, PATCHED_V2), null);
  // 再入：replacement 已在 → null（防双重插入）
  const patched = patchUtf8Entry(base, ANCHOR, PATCHED_V2);
  assert.equal(patchUtf8Entry(patched, ANCHOR, PATCHED_V2), null);
  // $4 两趟：第一趟后 DH_NEEDLE 仍全文唯一，第二趟成功
  const p4 = p4Class(false);
  const pass1 = patchUtf8Entry(p4, DW_NEEDLE, DW_REPL);
  assert.ok(pass1);
  const pass2 = patchUtf8Entry(pass1, DH_NEEDLE, DH_REPL);
  assert.ok(pass2);
  assert.equal(patchUtf8Entry(pass2, DW_NEEDLE, DW_REPL), null, '第三趟再入护栏拒绝');
});
