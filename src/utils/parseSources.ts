import { BookSource } from '../engine/types';

// 社区里流传的书源文件格式五花八门，标准 JSON 只是其中一种。
// 这个模块只干一件事：把各种畸形文本里的书源对象捞出来。
//
// 已知会遇到的形态：
//   1. 标准 JSON 数组 / 单个对象                    → 直接 parse
//   2. 整体被二次转义："[{\"bookSourceName\":...}]"  → 先剥一层
//   3. 转义块（外面没有引号）：[{\"bookSourceName\"  → 反转义再 parse
//   4. NDJSON / JSONL：每行一个对象
//   5. 前后夹着说明文字、注释、`json` 代码块围栏
//   6. 套了一层壳：{"bookSources": [...]} / {"data": [...]}
//   7. 数组里的元素本身是 JSON 字符串
//
// 全部失败时抛出带「原文开头 100 字」的错误，方便用户直接把内容发过来定位。

const FAIL = Symbol('json-fail');

function tryParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return FAIL;
  }
}

function isSourceLike(o: any): boolean {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  // Legado 书源必带 bookSourceUrl；个别残缺源只有名字，也收下（后面导入时会跳过）
  return (
    typeof o.bookSourceUrl === 'string' ||
    typeof o.bookSourceName === 'string' ||
    typeof o.ruleSearch === 'object'
  );
}

function collectSources(v: any, out: BookSource[], depth = 0): BookSource[] {
  if (v == null || v === FAIL || depth > 6) return out;

  if (Array.isArray(v)) {
    for (const x of v) collectSources(x, out, depth + 1);
    return out;
  }

  if (typeof v === 'string') {
    // 数组元素是被编码成字符串的 JSON
    const t = v.trim();
    if (t.length > 2 && (t[0] === '{' || t[0] === '[')) {
      let inner = tryParse(t);
      if (inner === FAIL) inner = tryParse(t.replace(/\\"/g, '"'));
      if (inner !== FAIL) collectSources(inner, out, depth + 1);
    }
    return out;
  }

  if (typeof v === 'object') {
    if (isSourceLike(v)) {
      out.push(v as BookSource);
      return out;
    }
    // 壳对象：往下钻。只钻一层常见容器，避免把无关嵌套全扫一遍
    for (const k of Object.keys(v)) collectSources((v as any)[k], out, depth + 1);
    return out;
  }

  return out;
}

// 从杂字里揪出「花括号平衡」的块。会跳过字符串内部的括号。
function extractObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (c === '\\') {
        esc = true;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          out.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return out;
}

function dedupe(list: BookSource[]): BookSource[] {
  const seen = new Set<string>();
  const out: BookSource[] = [];
  for (const s of list) {
    const key = s.bookSourceUrl || `__noname__${s.bookSourceName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export interface ParseOutcome {
  list: BookSource[];
  /** 认出来的格式，展示给用户，便于判断是不是猜歪了 */
  mode: string;
}

export function parseSourceText(raw: string): ParseOutcome {
  const base = (raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/\u200B/g, '')
    .trim();

  if (!base) throw new Error('文件是空的');

  // 候选文本：原文，以及去掉一层转义后的版本
  const candidates: { text: string; tag: string }[] = [{ text: base, tag: 'JSON' }];

  if (/\\"/.test(base)) {
    candidates.push({
      text: base.replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
      tag: '转义 JSON',
    });
  }
  // 整个文件是一个 JSON 字符串字面量：先 parse 出内层文本再走一遍
  if (base.length > 2 && base[0] === '"' && base[base.length - 1] === '"') {
    const inner = tryParse(base);
    if (inner !== FAIL && typeof inner === 'string') {
      candidates.unshift({ text: inner.trim(), tag: 'JSON 字符串' });
      if (/\\"/.test(inner)) {
        candidates.unshift({
          text: inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
          tag: 'JSON 字符串 + 转义',
        });
      }
    }
  }

  for (const { text, tag } of candidates) {
    // a) 整体就是一个合法 JSON
    const whole = tryParse(text);
    if (whole !== FAIL) {
      const got = dedupe(collectSources(whole, []));
      if (got.length) return { list: got, mode: tag };
    }

    // b) 每行一条
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/,$/, ''))
      .filter((l) => l.length > 1 && (l[0] === '{' || l[0] === '['));
    if (lines.length > 1) {
      const got: BookSource[] = [];
      for (const ln of lines) {
        const v = tryParse(ln);
        if (v !== FAIL) collectSources(v, got);
      }
      const clean = dedupe(got);
      if (clean.length) return { list: clean, mode: `${tag} · 每行一条` };
    }

    // c) 从混杂文本里逐个提取平衡块
    const blocks = extractObjects(text);
    if (blocks.length) {
      const got: BookSource[] = [];
      for (const blk of blocks) {
        const v = tryParse(blk);
        if (v !== FAIL) collectSources(v, got);
      }
      const clean = dedupe(got);
      if (clean.length) return { list: clean, mode: `${tag} · 文本内提取` };
    }
  }

  // 全败：把原文开头带出去，让用户能直接看到真实内容
  const head = base.slice(0, 100).replace(/\s+/g, ' ');
  throw new Error(`认不出书源格式。文件开头是：${head}`);
}
