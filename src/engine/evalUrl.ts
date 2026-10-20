// 解析 searchUrl 中的 {{...}} 占位符
// 支持：{{key}} / {{page}} / 简单算术 {{page-1}} / {{(page-1)*20}}
// 以及 @js: 之外的常见写法。复杂 java.* 调用直接原样保留（多数源用不到）。

function evalMath(expr: string, page: number): number | null {
  // 仅允许 数字、page、运算符 + - * / ( ) 与空白
  const cleaned = expr.replace(/\s+/g, '');
  if (!/^[0-9page+\-*/().]+$/.test(cleaned)) return null;
  if (/page/.test(cleaned) && !/^[\s\S]*page[\s\S]*$/.test(cleaned)) return null;
  // 用 page 替换变量，逐个字符安全求值（不支持函数调用）
  const replaced = cleaned.replace(/page/g, String(page));
  // 校验只剩合法字符
  if (!/^[\d+\-*/().]+$/.test(replaced)) return null;
  try {
    // 使用 Function 在 RN/Hermes 下不可用，故用安全的逆波兰求值
    return rpnEval(replaced);
  } catch {
    return null;
  }
}

function rpnEval(s: string): number {
  const tokens = s.match(/(\d+\.?\d*|[+\-*/()])/g);
  if (!tokens) throw new Error('bad expr');
  const out: (number | string)[] = [];
  const ops: string[] = [];
  const prec: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };
  for (const t of tokens) {
    if (/^\d+\.?\d*$/.test(t)) out.push(parseFloat(t));
    else if (t === '(') ops.push(t);
    else if (t === ')') {
      while (ops.length && ops[ops.length - 1] !== '(')
        out.push(ops.pop() as string);
      if (ops.pop() !== '(') throw new Error('bad paren');
    } else {
      while (
        ops.length &&
        ops[ops.length - 1] !== '(' &&
        (prec[ops[ops.length - 1]] ?? 0) >= (prec[t] ?? 0)
      )
        out.push(ops.pop() as string);
      ops.push(t);
    }
  }
  while (ops.length) out.push(ops.pop() as string);
  const st: number[] = [];
  for (const t of out) {
    if (typeof t === 'number') st.push(t);
    else {
      const b = st.pop()!;
      const a = st.pop()!;
      if (t === '+') st.push(a + b);
      else if (t === '-') st.push(a - b);
      else if (t === '*') st.push(a * b);
      else if (t === '/') st.push(a / b);
    }
  }
  if (st.length !== 1) throw new Error('bad expr');
  return st[0];
}

export function buildSearchUrl(
  searchUrl: string,
  key: string,
  page: number
): string {
  return searchUrl.replace(/\{\{([\s\S]*?)\}\}/g, (_, expr: string) => {
    const e = expr.trim();
    if (e === 'key') return encodeURIComponent(key);
    // 形如 {{java.base64Encode(key)}} 这类调用：退化为普通 key（保证可用）
    if (/key/.test(e) && !/page/.test(e)) return encodeURIComponent(key);
    if (e === 'page') return String(page);
    const num = evalMath(e, page);
    if (num !== null) return String(num);
    return encodeURIComponent(key);
  });
}

// 相对地址 → 绝对地址。
//
// 不用 new URL(url, base)：React Native 自带的 URL 是精简实现，
// 第二参数（base）并不可靠，`new URL('/book/1', 'https://a.com')` 会直接抛错，
// 于是书源里所有相对链接（绝大多数都是相对路径）都会解析失败。
// 这里手写一套，行为与浏览器的 URL 解析对齐。
export function resolveUrl(url: string, base: string): string {
  const u = (url || '').trim();
  if (!u) return (base || '').trim();

  // 已是绝对地址（http:, https:, data:, ftp: …）
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u)) return u;

  const b = (base || '').trim();
  if (!b) return u;

  // 协议相对：//cdn.xx.com/a.jpg
  if (u.startsWith('//')) {
    const m = b.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:)/);
    return (m ? m[1] : 'https:') + u;
  }

  const mBase = b.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]+)([^?#]*)/);
  if (!mBase) return u;
  const origin = mBase[1];
  const basePath = mBase[2] || '/';

  if (u.startsWith('#')) return b.split('#')[0] + u;
  if (u.startsWith('?')) return origin + basePath + u;
  if (u.startsWith('/')) return origin + u;

  // 普通相对路径：以 base 所在目录为基准，处理 ./ 和 ../
  const dir = basePath.replace(/[^/]*$/, '');
  const cut = u.search(/[?#]/);
  const pathPart = cut === -1 ? u : u.slice(0, cut);
  const suffix = cut === -1 ? '' : u.slice(cut);
  const segs = (dir + pathPart).split('/');
  const out: string[] = [];
  for (const s of segs) {
    if (s === '.' || s === '') continue;
    if (s === '..') {
      if (out.length > 1) out.pop();
      continue;
    }
    out.push(s);
  }
  return origin + '/' + out.join('/') + suffix;
}
