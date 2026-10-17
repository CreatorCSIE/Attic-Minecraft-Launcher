'use strict';

/**
 * 最小 store-method zip 构造器（条目零字节、CRC 置 0——检测只读中央目录条目名）。
 * 类名 → jar 条目路径：'com.mojang.minecraft.MinecraftApplet' → 'com/mojang/minecraft/MinecraftApplet.class'。
 */
function buildZip(names) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const name of names) {
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8); // method = stored
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(names.length, 8);
  eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

/** 类名清单 → jar 字节。 */
function buildJarBuffer(classNames) {
  return buildZip(classNames.map((c) => `${c.replace(/\./g, '/')}.class`));
}

module.exports = { buildZip, buildJarBuffer };
