/**
 * 最小 zip 解压器（仅 stored / deflate 两种方法，够 used jar 原生库条目）。
 * 零第三方依赖；用于把 bin/ 库池里的 `*-natives-<os>.jar` 解到 bin/natives
 * （显式 -Dorg.lwjgl.librarypath 会短路 LWJGL2 的 classpath 自解压，必须落盘）。
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/** 中央目录条目名清单（不解压、不校验 CRC——够类存在性检测用）。文件无效时抛错。 */
export function listZipEntryNames(zipFile: string): string[] {
  const buf = fs.readFileSync(zipFile);
  let eocd = -1;
  const minPos = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`不是有效 zip：${zipFile}`);
  const entryCount = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let n = 0; n < entryCount; n++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error(`zip 中央目录损坏：${zipFile}`);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    names.push(buf.toString('utf8', offset + 46, offset + 46 + nameLen));
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/** 从 zip 文件解出全部文件条目到 destDir；已存在的目标文件跳过。返回解出条目数。 */
export function extractZipTo(zipFile: string, destDir: string): number {
  const buf = fs.readFileSync(zipFile);
  // EOCD（End of Central Directory, PK\x05\x06）从尾部向前找。
  let eocd = -1;
  const minPos = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`不是有效 zip：${zipFile}`);
  const entryCount = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);

  let extracted = 0;
  for (let n = 0; n < entryCount; n++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error(`zip 中央目录损坏：${zipFile}`);
    const method = buf.readUInt16LE(offset + 10);
    const compSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);
    offset += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue; // 目录条目
    if (name.includes('..') || path.isAbsolute(name)) continue; // 路径穿越防御
    const target = path.join(destDir, name);
    if (fs.existsSync(target)) continue;

    // 本地文件头：数据起点 = localOffset + 30 + 本地 nameLen + 本地 extraLen。
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`zip 本地头损坏：${zipFile}`);
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(comp);
    else if (method === 8) data = zlib.inflateRawSync(comp);
    else continue; // 罕见压缩方法：跳过（原生库 jar 只用 stored/deflate）

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    extracted++;
  }
  return extracted;
}
