/**
 * 最小 markdown 渲染器（Release notes 展示专用，零依赖纯函数——与壳无关，UI 经 vite alias 直消费）。
 * 支持子集：`#`~`####` 标题、`**粗**`、`*斜*`、`- ` 无序列表、`[text](url)` 链接（仅 http/https，
 * 其余协议按纯文本丢弃语法）、行内 `` `code` ``、围栏 ``` 代码块、段落与空行。
 * XSS 纪律（硬）：**先全文 HTML 转义、再注入子集标记**——素材虽是自家 changelog 模板，
 * 仍不豁免转义（GitHub Release body 可被编辑，信任边界不成立）。转义后 `&` 在 URL 中呈 `&amp;`，
 * 恰为 href 属性的合法形态；协议白名单在转义前语义不变（`https://` 不含转义字符）。
 * 输出 HTML 仅供 v-html 注入固定容器；链接 target=_blank 在壳内由 UI 侧点击委托改走 openExternal。
 */

/** 全文转义（& 最先，防二次转义）。 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 行内标记单遍替换：alternation 左优先——code span 最先吞掉反引号段，
 * 粗（双星）先于斜（单星），链接最后。未命中的片段原样保留（已是转义态）。
 */
function inlineHtml(s: string): string {
  return s.replace(
    // href 段容忍一层圆括号对（javascript:alert(1) 之类不留半截语法）
    /(`[^`]+`)|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]*)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)\)/g,
    (whole, code, bold, italic, linkText, linkHref) => {
      if (code !== undefined) return `<code>${code.slice(1, -1)}</code>`;
      if (bold !== undefined) return `<strong>${bold}</strong>`;
      if (italic !== undefined) return `<em>${italic}</em>`;
      if (linkHref !== undefined && /^https?:\/\//i.test(linkHref)) {
        return `<a href="${linkHref}" target="_blank" rel="noopener noreferrer">${linkText ?? ''}</a>`;
      }
      return whole; // 非 http(s)：整段按纯文本（转义态原样）
    },
  );
}

/** markdown 子集 → HTML 串（块级：围栏代码块 / 标题 / 无序列表 / 段落）。 */
export function renderMarkdown(md: string): string {
  const out: string[] = [];
  let para: string[] = [];
  let list: string[] = [];
  let fence: string[] | null = null;
  const flushPara = (): void => {
    if (para.length) out.push(`<p>${para.map(inlineHtml).join('<br>')}</p>`);
    para = [];
  };
  const flushList = (): void => {
    if (list.length) out.push(`<ul>${list.map((i) => `<li>${inlineHtml(i)}</li>`).join('')}</ul>`);
    list = [];
  };
  for (const line of escapeHtml(md).split(/\r?\n/)) {
    const t = line.trim();
    if (fence) {
      // 围栏内原样进 <pre>（转义已完成，标记不解析）
      if (/^```/.test(t)) {
        out.push(`<pre><code>${fence.join('\n')}</code></pre>`);
        fence = null;
      } else fence.push(line);
      continue;
    }
    if (/^```/.test(t)) {
      flushPara();
      flushList();
      fence = [];
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(t);
    if (h) {
      flushPara();
      flushList();
      const n = (h[1] ?? '#').length;
      out.push(`<h${n}>${inlineHtml(h[2] ?? '')}</h${n}>`);
      continue;
    }
    if (/^- /.test(t)) {
      flushPara();
      list.push(t.slice(2));
      continue;
    }
    if (!t) {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(t);
  }
  if (fence) out.push(`<pre><code>${fence.join('\n')}</code></pre>`); // 未闭合围栏：余文按代码
  flushPara();
  flushList();
  return out.join('\n');
}
