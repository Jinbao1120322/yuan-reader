// 用 cheerio/slim 而非 'cheerio'：后者（batteries-included）的入口静态 import 了
// undici / parse5-parser-stream / encoding-sniffer / node:stream 等 Node 内置模块，
// React Native 的 Metro 打包器无法解析，会导致 xcodebuild archive 失败。
// /slim 仅依赖 htmlparser2 + domhandler，纯浏览器/移动端可用，API 与完整版一致。
import type { CheerioAPI } from 'cheerio/slim';

export type CheerioRoot = CheerioAPI;

// ---------------------------------------------------------------------------
// 解析库改为「运行期懒加载」。
//
// 原因：这三个库（cheerio/slim、@xmldom/xmldom、xpath）原本是静态 import，
// 会被 App 的依赖图在启动时**立即求值**。只要其中任何一个在加载期抛错
// （例如依赖了 Hermes 不支持的 API），registerRootComponent 就执行不到，
// 表现为「纯白屏 + 无报错 + 不闪退」。
//
// 改成函数内 require（Metro 依然会把它们打进 bundle，因为用的是字面量），
// 只有真正解析网页时才初始化，启动不再受它们影响。
// ---------------------------------------------------------------------------
type CheerioModule = { load: (html: string) => CheerioAPI };
type XmldomModule = {
  DOMParser: new () => { parseFromString: (src: string, mime: string) => any };
};
type XpathModule = { select: (expr: string, node: any) => any[] };

let _cheerio: CheerioModule | null = null;
let _xmldom: XmldomModule | null = null;
let _xpath: XpathModule | null = null;

function cheerioLib(): CheerioModule {
  if (!_cheerio) {
    const m: any = require('cheerio/slim');
    _cheerio = (m && m.load ? m : (m && m.default) || m) as CheerioModule;
  }
  return _cheerio as CheerioModule;
}

function xmldomLib(): XmldomModule {
  if (!_xmldom) {
    const m: any = require('@xmldom/xmldom');
    _xmldom = (m && m.DOMParser ? m : (m && m.default) || m) as XmldomModule;
  }
  return _xmldom as XmldomModule;
}

function xpathLib(): XpathModule {
  if (!_xpath) {
    const m: any = require('xpath');
    _xpath = (m && m.select ? m : (m && m.default) || m) as XpathModule;
  }
  return _xpath as XpathModule;
}

export function loadHtml(html: string): CheerioRoot {
  return cheerioLib().load(html);
}

// ---------------------------------------------------------------------------
// Legado（开源阅读）规则语法 → CSS 选择器
//
// 社区书源几乎全部用 Legado 的简写，不是标准 CSS：
//   class.result-list@tag.li@text   →  .result-list li 取文本
//   class.item.0@tag.a@href         →  .item:eq(0) a 取 href
//   tag.h3@text                     →  h3 取文本
//   id.content@html                 →  #content 取 innerHTML
//
// 之前直接把 "class.result-list@tag.li" 丢给 cheerio，它会把 class 当成标签名，
// 一个元素都选不到 → 请求成功但结果永远为空。
// ---------------------------------------------------------------------------

// Legado 内置的取值属性
const ATTR_NAMES = new Set([
  'text',
  'textnodes',
  'owntext',
  'html',
  'all',
  'outerhtml',
  'href',
  'src',
  'content',
  'title',
  'alt',
  'value',
  'data-src',
  'data-original',
  'data-id',
  'abs:href',
  'abs:src',
]);

// 以这些词开头的是「选择器类型」，不能当属性名
const SEL_TYPES = new Set(['class', 'tag', 'id', 'text']);

function isAttrName(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (ATTR_NAMES.has(t.toLowerCase())) return true;
  // 任意 HTML 属性名（不含点、空格的选择器语法）
  return /^[A-Za-z_][\w:-]*$/.test(t) && !SEL_TYPES.has(t.toLowerCase());
}

// 类名 / id / 标签名 → 合法的 CSS 标识符
function escapeIdent(s: string): string {
  return s.replace(/([^\w-])/g, '\\$1');
}

interface CssSel {
  css: string;
  index?: number;
}

// 单个 Legado 片段 → CSS
function segToCss(segRaw: string): CssSel | null {
  let s = segRaw.trim();
  if (!s) return null;

  // @css: / css: 前缀：后面整体当标准 CSS
  if (/^@?css:/i.test(s)) {
    s = s.replace(/^@?css:/i, '').trim();
    return s ? { css: s } : null;
  }
  // 其它引擎前缀交给调用方跳过
  if (/^@?(xpath|json|js|regex):/i.test(s) || s.startsWith('//')) return null;

  // 尾部索引：class.item.0 / class.item.-1
  let index: number | undefined;
  const m = s.match(/^(.*?)\.(-?\d+)$/);
  if (m && m[1] && !/^[\d.]+$/.test(m[1])) {
    s = m[1];
    index = parseInt(m[2], 10);
  }

  const dot = s.indexOf('.');
  if (dot === -1) return { css: s, index }; // 纯标签名 / 纯 CSS

  const type = s.slice(0, dot).toLowerCase();
  const name = s.slice(dot + 1);
  if (!name) return null;

  if (type === 'class') return { css: '.' + escapeIdent(name), index };
  if (type === 'tag') return { css: escapeIdent(name), index };
  if (type === 'id') return { css: '#' + escapeIdent(name), index };
  if (type === 'text') return null; // 文本包含匹配，暂不支持

  // 已经是标准 CSS（如 li.item）
  return { css: s, index };
}

interface ParsedPart {
  selectors: CssSel[];
  attr: string | null;
}

function parsePart(partRaw: string): ParsedPart {
  let body = partRaw.trim();
  let attr: string | null = null;

  // 只剥末尾一个 @属性。
  // 注意这里用 <=：规则可以整体只有一个 @href（条目本身就是 <a> 的常见情形），
  // 这时 selectors 为空、attr 为 href，getValues 会走「直接取 context 自身属性」分支。
  const tail = body.match(/@([A-Za-z_][\w:-]*)$/);
  if (tail && tail[0].length <= body.length && isAttrName(tail[1])) {
    attr = tail[1].toLowerCase();
    body = body.slice(0, body.length - tail[0].length);
  }

  const selectors: CssSel[] = [];
  for (const seg of body.split('@')) {
    const c = segToCss(seg);
    if (c) selectors.push(c);
  }
  return { selectors, attr };
}

function extractAttr($: CheerioRoot, el: any, attr: string | null): string {
  const $el = $(el);
  const a = (attr || 'text').toLowerCase();
  if (a === 'text') {
    return ($el.text() || '').replace(/\s+/g, ' ').trim();
  }
  if (a === 'owntext') {
    // 只取直接文本节点，不含子元素里的文字
    const own = ($el.contents() as any)
      .filter((_: number, n: any) => n.type === 'text')
      .map((_: number, n: any) => n.data)
      .get()
      .join('');
    return (own || '').replace(/\s+/g, ' ').trim();
  }
  if (a === 'html' || a === 'outerhtml' || a === 'all') {
    return $el.html() || '';
  }
  if (a === 'content') {
    const meta = $el.attr('content');
    return meta ? meta : ($el.text() || '').trim();
  }
  return $el.attr(a) || '';
}

// 处理 ## 净化：left 为选择器，right 为 regex 或 regex##replacement
function applyClean(src: string, rule: string): string {
  const idx = rule.indexOf('##');
  if (idx === -1) return rule; // 不是净化，返回原规则串
  const left = rule.slice(0, idx);
  let right = rule.slice(idx + 2);
  let repl = '';
  const r2 = right.indexOf('##');
  if (r2 !== -1) {
    repl = right.slice(r2 + 2);
    right = right.slice(0, r2);
  }
  try {
    const re = new RegExp(right, 'g');
    return (left || src).replace(re, repl);
  } catch {
    return src;
  }
}

function splitTop(s: string, sep: string): string[] {
  // 仅按顶层 sep 拆分（规则里基本无转义需求）
  return s.split(sep).map((x) => x.trim());
}

function normIndex(i: number, len: number): number {
  return i < 0 ? Math.max(0, len + i) : i;
}

// 顺着 Legado 片段链向下选择，返回元素集合
function walkSelectors(
  $: CheerioRoot,
  start: any,
  selectors: CssSel[]
): any {
  let cur: any = start;
  for (const s of selectors) {
    if (!s.css) continue;
    const found = typeof cur === 'function' ? $(s.css) : cur.find(s.css);
    cur = typeof s.index === 'number' ? found.eq(normIndex(s.index, found.length)) : found;
    if (!cur || cur.length === 0) return $();
  }
  return cur;
}

// 提取单个 OR 段（&& 链）得到元素集合（用于列表 / 子规则上下文）
function selectElements(
  $: CheerioRoot,
  context: any,
  seg: string
): any {
  const parts = splitTop(seg, '&&');
  let cur: any = context;
  let touched = false;
  for (const p of parts) {
    const parsed = parsePart(p);
    if (!parsed.selectors.length) {
      // xpath / js / regex / text 这类规则在列表场景无法处理
      if (/@?(xpath|json|js|regex):|^\/\//i.test(p)) return $();
      continue;
    }
    cur = walkSelectors($, cur, parsed.selectors);
    touched = true;
    if (!cur || cur.length === 0) return $();
  }
  return touched ? cur : $();
}

// 提取值（字符串数组），context 为 cheerio 上下文
export function getValues(
  $: CheerioRoot,
  context: any,
  ruleStr: string | undefined,
  baseUrl: string
): string[] {
  if (!ruleStr) return [];

  // 整个规则先做 ## 净化拆分（仅当规则整体含 ## 且左侧为选择器时）
  const cleanIdx = ruleStr.indexOf('##');
  let cleanRegex: string | null = null;
  let cleanRepl = '';
  let selectorRule = ruleStr;
  if (cleanIdx !== -1) {
    // 形如 selector@attr##regex##repl 或 selector##regex
    const head = ruleStr.slice(0, cleanIdx);
    let tail = ruleStr.slice(cleanIdx + 2);
    const r2 = tail.indexOf('##');
    if (r2 !== -1) {
      cleanRepl = tail.slice(r2 + 2);
      tail = tail.slice(0, r2);
    }
    cleanRegex = tail;
    selectorRule = head;
  }

  // Legado 用 || 表示并列，先试 ||
  const orSegs =
    selectorRule.indexOf('||') !== -1
      ? splitTop(selectorRule, '||')
      : splitTop(selectorRule, '|');

  for (const seg of orSegs) {
    // regex: 规则直接在整段文本上做匹配
    const regexHit = seg.match(/(?:^|&&)\s*@?regex:([\s\S]*)$/i);
    if (regexHit) {
      const curText =
        typeof context === 'function'
          ? $('body').text()
          : (context as any).text
          ? (context as any).text()
          : '';
      try {
        const m = curText.match(new RegExp(regexHit[1], 'g')) || [];
        if (m.length) return m;
      } catch {
        /* 非法正则，继续试下一段 */
      }
      continue;
    }

    // xpath: 走独立分支
    if (/@?xpath:|^\/\//i.test(seg)) {
      const xres = xpathValue($, context, seg, null);
      if (xres.length) {
        return cleanRegex
          ? xres.map((s) => applyClean(s, `##${cleanRegex}##${cleanRepl}`))
          : xres;
      }
      continue;
    }

    const parts = splitTop(seg, '&&');
    let cur: any = context;
    let lastAttr: string | null = null;
    let touched = false;

    for (const p of parts) {
      const parsed = parsePart(p);
      if (parsed.attr) lastAttr = parsed.attr;
      if (!parsed.selectors.length) {
        // 只有 @text 这种纯取值段
        continue;
      }
      cur = walkSelectors($, cur, parsed.selectors);
      touched = true;
      if (!cur || cur.length === 0) break;
    }

    if (!touched) {
      // 规则整体没有选择器（例如只剩 @text），直接取 context 自身
      const v = extractAttr($, context, lastAttr);
      if (v) return cleanRegex ? [applyClean(v, `##${cleanRegex}##${cleanRepl}`)] : [v];
      continue;
    }
    if (!cur || cur.length === 0) continue;

    const vals = (cur as any)
      .map((_: any, el: any) => extractAttr($, el, lastAttr))
      .get()
      .filter((v: string) => v && v.length > 0);

    if (vals.length) {
      return cleanRegex
        ? vals.map((s: string) => applyClean(s, `##${cleanRegex}##${cleanRepl}`))
        : vals;
    }
  }
  return [];
}

// 提取列表元素（每个作为子规则上下文）
export function getElements(
  $: CheerioRoot,
  context: any,
  ruleStr: string | undefined
): any {
  if (!ruleStr) return $();
  const orSegs =
    ruleStr.indexOf('||') !== -1 ? splitTop(ruleStr, '||') : splitTop(ruleStr, '|');
  for (const seg of orSegs) {
    const els = selectElements($, context, seg);
    if (els && (els as any).length > 0) return els;
  }
  return $();
}

function xpathValue(
  $: CheerioRoot,
  context: any,
  seg: string,
  attr: string | null
): string[] {
  try {
    let html =
      typeof context === 'function'
        ? $('html').html() || ''
        : (context as any).html
        ? (context as any).html()
        : $('html').html() || '';
    const doc = new (xmldomLib().DOMParser)().parseFromString(html, 'text/html');
    const parts = splitTop(seg, '&&');
    let xexpr = parts[parts.length - 1].replace(/^@?xpath:/i, '').split('@')[0];
    if (!xexpr.startsWith('//')) xexpr = '//' + xexpr;
    const nodes = xpathLib().select(xexpr, doc) as any[];
    const out: string[] = [];
    for (const n of nodes) {
      if (n.nodeType === 2) out.push(n.nodeValue || '');
      else if (n.nodeType === 1) {
        if (attr && attr !== 'text' && attr !== 'html') out.push(n.getAttribute(attr) || '');
        else if (attr === 'html') out.push((n as any).toString());
        else out.push((n.textContent || '').replace(/\s+/g, ' ').trim());
      } else if (n.nodeType === 3) out.push((n.nodeValue || '').trim());
    }
    return out.filter(Boolean);
  } catch {
    return [];
  }
}
