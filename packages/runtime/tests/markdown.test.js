// 最小 markdown 渲染器断言（更新弹窗 Release notes 展示面；纯函数零壳依赖）。
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderMarkdown } = require('../dist/index.js');

test('renderMarkdown：标题 #~#### 映射 h1~h4；##### 越界按段落', () => {
  assert.equal(renderMarkdown('# 一'), '<h1>一</h1>');
  assert.equal(renderMarkdown('## 二'), '<h2>二</h2>');
  assert.equal(renderMarkdown('### 三'), '<h3>三</h3>');
  assert.equal(renderMarkdown('#### 四'), '<h4>四</h4>');
  assert.equal(renderMarkdown('##### 五'), '<p>##### 五</p>');
});

test('renderMarkdown：粗/斜/行内 code（粗先于斜，code 段内不解析标记）', () => {
  assert.equal(renderMarkdown('**粗** 与 *斜*'), '<p><strong>粗</strong> 与 <em>斜</em></p>');
  assert.equal(renderMarkdown('`a*b` 原样'), '<p><code>a*b</code> 原样</p>');
});

test('renderMarkdown：无序列表连续聚合成单个 ul', () => {
  assert.equal(renderMarkdown('- 甲\n- **乙**\n\n- 丙'), '<ul><li>甲</li><li><strong>乙</strong></li></ul>\n<ul><li>丙</li></ul>');
});

test('renderMarkdown：链接仅 http/https 成钮；其余协议整段按纯文本', () => {
  assert.equal(
    renderMarkdown('[点我](https://example.com/a)'),
    '<p><a href="https://example.com/a" target="_blank" rel="noopener noreferrer">点我</a></p>',
  );
  assert.equal(renderMarkdown('[坏](javascript:alert(1))'), '<p>[坏](javascript:alert(1))</p>');
  assert.equal(renderMarkdown('[本地](file:///c:/windows)'), '<p>[本地](file:///c:/windows)</p>');
});

test('renderMarkdown：围栏代码块内部原样（标记不解析、语言标注忽略）', () => {
  assert.equal(renderMarkdown('```js\nlet a = 1;\n// **not bold**\n```'), '<pre><code>let a = 1;\n// **not bold**</code></pre>');
  assert.equal(renderMarkdown('```\n未闭合余文'), '<pre><code>未闭合余文</code></pre>');
});

test('renderMarkdown：段落空行分段；段内换行按 br 连接', () => {
  assert.equal(renderMarkdown('行一\n行二\n\n段二'), '<p>行一<br>行二</p>\n<p>段二</p>');
});

test('renderMarkdown：XSS 纪律——先转义后注入，脚本与属性逃逸不存活', () => {
  assert.equal(renderMarkdown('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.equal(renderMarkdown('"><img src=x onerror=alert(1)>'), '<p>&quot;&gt;&lt;img src=x onerror=alert(1)&gt;</p>');
  // 链接 href 里的引号被转义为 &quot;，无法逃逸属性（末个 " 是我们自己闭合属性的引号）
  assert.equal(
    renderMarkdown('[x](https://a.test/?q="onmouseover=)'),
    '<p><a href="https://a.test/?q=&quot;onmouseover=" target="_blank" rel="noopener noreferrer">x</a></p>',
  );
});
