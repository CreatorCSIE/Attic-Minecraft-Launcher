'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseProperties, serializeProperties } = require('../dist/index.js');

test('基础解析：= 与 : 分隔、注释、空行', () => {
  const props = parseProperties(
    [
      '# 注释行',
      '! 另一种注释',
      '',
      'name=Attic',
      'version:b1.7.3',
      'width = 854',
      'novalue',
    ].join('\n'),
  );
  assert.deepEqual(props, { name: 'Attic', version: 'b1.7.3', width: '854', novalue: '' });
});

test('转义：\\n \\t \\\\ \\: \\= \\uXXXX', () => {
  const props = parseProperties(
    ['a=1\\n2', 'b=x\\ty', 'c=C:\\\\Users\\\\steve', 'd\\:e=f\\=g', 'h=\\u6d4b\\u8bd5'].join('\n'),
  );
  assert.equal(props['a'], '1\n2');
  assert.equal(props['b'], 'x\ty');
  assert.equal(props['c'], 'C:\\Users\\steve');
  assert.equal(props['d:e'], 'f=g');
  assert.equal(props['h'], '测试');
});

test('续行：行尾奇数个反斜杠', () => {
  const props = parseProperties('proxy-args=-Dhttp.proxyHost=betacraft.uk \\\n-Dhttp.proxyPort=11705');
  assert.equal(props['proxy-args'], '-Dhttp.proxyHost=betacraft.uk -Dhttp.proxyPort=11705');
});

test('序列化↔解析回环：Windows 路径 / 中文 / 特殊字符', () => {
  const source = {
    gameDir: 'C:\\Users\\steve\\.attic\\b1.7.3',
    name: '测试实例',
    'launchArgs': '-Xmx1G -Dfoo=a=b:c',
  };
  const round = parseProperties(serializeProperties(source));
  assert.deepEqual(round, source);
});

test('序列化：非 ASCII 转 \\uXXXX（老 Java ISO-8859-1 兼容）', () => {
  const out = serializeProperties({ k: '中文' });
  assert.match(out, /^k=\\u4e2d\\u6587$/m);
});
