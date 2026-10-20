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

function extractAttr(
  $: CheerioRoot,
  el: any,
  attr: string | null
): string {
  const $el = $(el);
  if (!attr || attr === 'text' || attr === 'textnode') {
    return ($el.text() || '').replace(/\s+/g, ' ').trim();
  }
  if (attr === 'html') {
    return $el.html() || '';
  }
  return $el.attr(attr) || '';
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
    return (left ? src : src).replace(re, repl);
  } catch {
    return src;
  }
}

function splitTop(s: string, sep: string): string[] {
  // 仅按顶层 sep 拆分（规则里基本无转义需求）
  return s.split(sep).map((x) => x.trim());
}

// 提取单个 OR 段（AND 链）得到元素集合（用于列表 / 子规则上下文）
function selectElements(
  $: CheerioRoot,
  context: any,
  seg: string
): any {
  const parts = splitTop(seg, '&&');
  let cur: any = context;
  for (const p of parts) {
    let sel = p;
    if (sel.startsWith('css:')) sel = sel.slice(4);
    else if (sel.startsWith('xpath:') || sel.startsWith('//')) {
      // xpath 仅支持值提取，列表场景回退为空
      return $();
    }
    if (sel.startsWith('regex:')) return $();
    if (sel.indexOf('@') !== -1) sel = sel.split('@')[0];
    if (!sel) return $();
    cur = cur === context && typeof context === 'function' ? $(sel) : (cur as any).find(sel);
  }
  return cur || $();
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

  const orSegs = splitTop(selectorRule, '|');
  for (const seg of orSegs) {
    let cur = context;
    const parts = splitTop(seg, '&&');
    let lastAttr: string | null = null;
    let usedXpath = false;
    for (const p of parts) {
      let sel = p;
      const at = sel.match(/^(.*?)@([A-Za-z0-9_]+)$/);
      if (at) {
        sel = at[1];
        lastAttr = at[2].toLowerCase();
      }
      if (sel.startsWith('regex:')) {
        const reSrc = sel.slice(6);
        // 对当前文本做正则
        const curText = cur === context && typeof context === 'function'
          ? $('body').text()
          : (cur as any).text ? (cur as any).text() : '';
        const m = curText.match(new RegExp(reSrc, 'g')) || [];
        return m;
      }
      if (sel.startsWith('xpath:')) {
        usedXpath = true;
        break;
      }
      if (sel.startsWith('css:')) sel = sel.slice(4);
      if (!sel) continue;
      if (cur === context && typeof context === 'function') {
        cur = $(sel);
      } else {
        cur = (cur as any).find(sel);
      }
    }
    if (usedXpath) {
      // xpath 值提取（best-effort）
      const xres = xpathValue($, context, seg, lastAttr);
      if (xres.length) {
        return cleanRegex ? xres.map((s) => applyClean(s, `##${cleanRegex}##${cleanRepl}`)) : xres;
      }
      continue;
    }
    if (!cur || (cur as any).length === 0) continue;
    const vals = (cur as any)
      .map((_: any, el: any) => extractAttr($, el, lastAttr))
      .get()
      .filter((v: string) => v && v.length > 0);
    if (vals.length) {
      return cleanRegex ? vals.map((s: string) => applyClean(s, `##${cleanRegex}##${cleanRepl}`)) : vals;
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
  const orSegs = splitTop(ruleStr, '|');
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
    let html = typeof context === 'function' ? $('html').html() || '' : (context as any).html ? (context as any).html() : $('html').html() || '';
    const doc = new (xmldomLib().DOMParser)().parseFromString(html, 'text/html');
    const parts = splitTop(seg, '&&');
    let xexpr = parts[parts.length - 1].replace(/^xpath:/, '').split('@')[0];
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
