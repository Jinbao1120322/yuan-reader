// 精简 JSONPath。
//
// 社区书源里越来越多站点直接返回 JSON 接口，规则写成：
//   bookList: "$.data.list[*]"
//   name:     "$.name"
//   bookUrl:  "$.bookUrl"
// 这类规则用 cheerio 去解析 JSON 文本必然一无所获，所以要单独走一条分支。
//
// 只覆盖书源里真正会用到的写法：
//   $.a.b / a.b / $.a[0] / $.a[*] / $[0] / $.a.b[1].c
// 不支持递归 ..、过滤器 [?()]、切片 [a:b]，遇到就退化成「取不到」，不影响其它源。

export type JP = string | number | '*';

function tokenize(path: string): JP[] {
  const tokens: JP[] = [];
  let s = (path || '').trim();
  if (!s) return tokens;
  // 去掉前导 $ 和 .
  s = s.replace(/^\$/, '');
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '.' || c === ' ') {
      i++;
      continue;
    }
    if (c === '[') {
      const end = s.indexOf(']', i);
      if (end === -1) break;
      const inner = s.slice(i + 1, end).trim();
      if (inner === '*' || inner === '') tokens.push('*');
      else if (/^-?\d+$/.test(inner)) tokens.push(parseInt(inner, 10));
      else if (/^['"].*['"]$/.test(inner)) tokens.push(inner.slice(1, -1));
      else tokens.push('*');
      i = end + 1;
      continue;
    }
    let j = i;
    while (j < s.length && s[j] !== '.' && s[j] !== '[') j++;
    const key = s.slice(i, j).trim();
    if (key) tokens.push(key);
    i = j;
  }
  return tokens;
}

// 按路径取值，返回扁平的结果数组（路径里带 * 时会展开成多个）
export function pickJson(data: any, path: string): any[] {
  const tokens = tokenize(path);
  if (!tokens.length) return data === undefined ? [] : [data];

  let cur: any[] = [data];
  for (const t of tokens) {
    const next: any[] = [];
    for (const node of cur) {
      if (node == null) continue;
      if (t === '*') {
        if (Array.isArray(node)) next.push(...node);
        else if (typeof node === 'object') next.push(...Object.values(node));
      } else if (typeof t === 'number') {
        if (Array.isArray(node)) {
          const v = t < 0 ? node[node.length + t] : node[t];
          if (v !== undefined) next.push(v);
        }
      } else if (Array.isArray(node)) {
        // 路径里省略了 [*] 时，允许直接在数组元素上取属性
        for (const e of node) {
          if (e && typeof e === 'object' && (e as any)[t] !== undefined) {
            next.push((e as any)[t]);
          }
        }
      } else if (typeof node === 'object' && (node as any)[t] !== undefined) {
        next.push((node as any)[t]);
      }
    }
    cur = next;
    if (!cur.length) return [];
  }
  return cur;
}

// 单个值转字符串（对象/数组忽略）
export function toText(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.replace(/\s+/g, ' ').trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

// 规则串里的 ## 净化：pattern##replacement
export function cleanText(src: string, rule: string): string {
  const idx = rule.indexOf('##');
  if (idx === -1) return src;
  let tail = rule.slice(idx + 2);
  let repl = '';
  const r2 = tail.indexOf('##');
  if (r2 !== -1) {
    repl = tail.slice(r2 + 2);
    tail = tail.slice(0, r2);
  }
  try {
    return src.replace(new RegExp(tail, 'g'), repl);
  } catch {
    return src;
  }
}

// 从 JSON 节点里按规则取第一个文本值
export function jsonField(node: any, rule: string | undefined): string {
  if (!rule) return '';
  const idx = rule.indexOf('##');
  const path = idx === -1 ? rule : rule.slice(0, idx);
  const vals = pickJson(node, path);
  if (!vals.length) return '';
  const txt = toText(vals[0]);
  return idx === -1 ? txt : cleanText(txt, rule);
}

// 从 JSON 节点里按规则取列表（每个元素作为子规则的上下文）
export function jsonList(node: any, rule: string | undefined): any[] {
  if (!rule) return [];
  const idx = rule.indexOf('##');
  const path = idx === -1 ? rule : rule.slice(0, idx);
  return pickJson(node, path).filter((v) => v != null);
}
