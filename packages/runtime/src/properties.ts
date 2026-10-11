/**
 * Java properties 格式解析/序列化（v1 格式兼容：launcher.settings 与 instances/*.txt 共用）。
 * 规则照抄 java.util.Properties 语义：# 与 ! 注释、= 与 : 分隔、行尾奇数个反斜杠续行、
 * \n \t \r \f \\ \: \= \uXXXX 转义；序列化侧非 ASCII 一律 \uXXXX（老 Java 按 ISO-8859-1 读）。
 * 纯字符串处理，不涉路径。
 */

/** 行尾奇数个反斜杠 = 续行。 */
function endsWithOddBackslashes(line: string): boolean {
  let count = 0;
  for (let i = line.length - 1; i >= 0 && line[i] === '\\'; i--) count++;
  return count % 2 === 1;
}

function unescape(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = text[++i];
    if (next === undefined) break;
    switch (next) {
      case 'n':
        out += '\n';
        break;
      case 't':
        out += '\t';
        break;
      case 'r':
        out += '\r';
        break;
      case 'f':
        out += '\f';
        break;
      case 'u': {
        const hex = text.slice(i + 1, i + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else {
          out += 'u';
        }
        break;
      }
      default:
        out += next; // \\ \: \= 等：反斜杠本身被丢弃
    }
  }
  return out;
}

export function parseProperties(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  const rawLines = text.split(/\r?\n/);
  let i = 0;
  while (i < rawLines.length) {
    let line = (rawLines[i++] ?? '').replace(/^[ \f\t\v]+/, '');
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue;
    while (endsWithOddBackslashes(line) && i < rawLines.length) {
      line = line.slice(0, -1) + (rawLines[i++] ?? '').replace(/^[ \f\t\v]+/, '');
    }
    // 找第一个未escaped的分隔符（= 或 :）
    let sep = -1;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j]!;
      if (ch === '\\') {
        j++;
        continue;
      }
      if (ch === '=' || ch === ':') {
        sep = j;
        break;
      }
    }
    let key: string;
    let value: string;
    if (sep === -1) {
      key = line;
      value = '';
    } else {
      key = line.slice(0, sep);
      value = line.slice(sep + 1).replace(/^[ \f\t\v]+/, '');
    }
    const unescapedKey = unescape(key.trim());
    if (unescapedKey !== '') result[unescapedKey] = unescape(value);
  }
  return result;
}

function escapeText(text: string, forValue: boolean): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const code = text.charCodeAt(i);
    if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\f') out += '\\f';
    else if (!forValue && (ch === '=' || ch === ':')) out += `\\${ch}`;
    else if (code < 0x20 || code > 0x7e) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return out;
}

export function serializeProperties(entries: Record<string, string>, header?: string): string {
  const lines: string[] = [];
  if (header) lines.push(`# ${header}`);
  for (const [key, value] of Object.entries(entries)) {
    const escapedKey = escapeText(key, false);
    let escapedValue = escapeText(value, true);
    if (escapedValue.startsWith(' ')) escapedValue = `\\u0020${escapedValue.slice(1)}`;
    lines.push(`${escapedKey}=${escapedValue}`);
  }
  return `${lines.join('\n')}\n`;
}
