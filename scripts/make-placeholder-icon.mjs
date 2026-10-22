#!/usr/bin/env node
/**
 * 占位应用图标生成器（脚手架：品牌资产未落位前的非最终图标）。
 * 纯 Node（zlib + 手写 CRC32）产出 1024 RGBA PNG：深色底 + 金色「阁楼」屋顶三角。
 * 用法：node scripts/make-placeholder-icon.mjs && pnpm --filter @attic/tauri exec tauri icon apps/tauri/brand/attic-icon.png
 * TODO(branding)：正式图标替换 apps/tauri/brand/attic-icon.png 后重跑 tauri icon。
 */
import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'apps', 'tauri', 'brand', 'attic-icon.png');

const SIZE = 1024;
const BG = [31, 41, 55, 255]; // 深灰蓝（token --bg-deep 近似）
const ROOF = [247, 201, 72, 255]; // 金色
const WALL = [80, 100, 130, 255]; // 屋身

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
const put = (x, y, [r, g, b, a]) => {
  const o = y * (SIZE * 4 + 1) + 1 + x * 4;
  raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
};
for (let y = 0; y < SIZE; y++) raw[y * (SIZE * 4 + 1)] = 0; // filter byte

// 屋身（下部矩形）与屋顶（等腰三角形，尖朝上）——粗几何即可，占位不讲究。
const margin = SIZE * 0.18;
const apexY = SIZE * 0.16;
const eaveY = SIZE * 0.52;
const bodyBottom = SIZE - margin;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let color = BG;
    if (y >= apexY && y < eaveY) {
      // 屋顶：三角形内外缘 8px 描边 + 内填
      const half = ((y - apexY) / (eaveY - apexY)) * (SIZE / 2 - margin / 2);
      const d = Math.abs(x - SIZE / 2);
      if (d <= half && d >= half - 26) color = ROOF;
    } else if (y >= eaveY && y <= bodyBottom && x >= SIZE / 2 - (SIZE / 2 - margin) * 0.62 && x <= SIZE / 2 + (SIZE / 2 - margin) * 0.62) {
      color = WALL;
      // 门洞（阁楼的“入口”）
      if (y > bodyBottom - SIZE * 0.2 && Math.abs(x - SIZE / 2) < SIZE * 0.06) color = BG;
    }
    put(x, y, color);
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, png);
console.log(`[icon] placeholder written -> ${path.relative(ROOT, OUT)}`);
