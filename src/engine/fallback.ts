import { loadHtml } from './select';
import { resolveUrl } from './evalUrl';
import { BookChapter } from './types';

// 书源规则解析不出来时的启发式兜底。
//
// 现实情况：社区书源里相当一部分只有完整的搜索规则，目录/正文规则残缺，
// 或者站点改版后规则对不上了。搜索结果和详情能出来（说明规则和选择器都正常），
// 但一道目录就「未解析到章节目录」——这时候只能靠页面结构本身去猜。

const CHAP_NAME_RE =
  /第\s*[0-9零一二三四五六七八九十百千两]+\s*[章节回卷话集部篇]|^\s*\d{1,4}\s*[.、,，]|序章|楔子|引子|前言|后记|尾声|番外/;

function xpathLib(): any {
  const m: any = require('xpath');
  return m && m.select ? m : (m && m.default) || m;
}

function xmldomLib(): any {
  const m: any = require('@xmldom/xmldom');
  return m && m.DOMParser ? m : (m && m.default) || m;
}

// xpath 写的 chapterList（`xpath://div[@id='list']/dd`、`//dd/a`）：
// select.ts 的列表选择只走 CSS，这类规则以前一个元素都取不到。
export function xpathChapters(
  html: string,
  rule: string,
  baseUrl: string
): BookChapter[] {
  try {
    let expr = rule
      .replace(/^@?xpath:/i, '')
      .replace(/@(text|html|textnodes)$/i, '')
      .trim();
    if (!expr) return [];
    if (!expr.startsWith('//') && !expr.startsWith('/')) expr = '//' + expr;

    const doc = new (xmldomLib().DOMParser)().parseFromString(html, 'text/html');
    const nodes = xpathLib().select(expr, doc) as any[];
    if (!nodes.length) return [];

    const out: BookChapter[] = [];
    let i = 0;
    for (const n of nodes) {
      if (!n || n.nodeType !== 1) continue;
      const outer: string = typeof n.toString === 'function' ? n.toString() : '';
      if (!outer) continue;
      const name = outer
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
      const href = (outer.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
      if (!name || !href) continue;
      out.push({ name, url: resolveUrl(href, baseUrl), index: i++ });
    }
    return out;
  } catch {
    return [];
  }
}

// 从详情页里找「目录页」的链接
export function guessTocUrl(html: string, baseUrl: string): string | null {
  try {
    const $ = loadHtml(html);
    let bestUrl: string | null = null;
    let bestScore = 0;
    $('a[href]').each((_: number, el: any) => {
      const $el = $(el);
      const text = ($el.text() || '').replace(/\s+/g, ' ').trim();
      const href = $el.attr('href') || '';
      if (!href || /^(javascript:|#|mailto:)/i.test(href)) return;
      let score = 0;
      if (/目录|章节列表|全部章节|章节目录|查看目录/.test(text)) score += 10;
      if (/list|chapter|mulu|catalog|index/i.test(href)) score += 5;
      if (text.length > 0 && text.length <= 10) score += 1;
      if (score > bestScore) {
        bestScore = score;
        bestUrl = resolveUrl(href, baseUrl);
      }
    });
    return bestScore >= 5 ? bestUrl : null;
  } catch {
    return null;
  }
}

interface Link {
  name: string;
  url: string;
}

// 从目录页里按结构猜章节：同一目录下、名字像章节的那一组 <a>
export function guessChapters(html: string, baseUrl: string): BookChapter[] {
  try {
    const $ = loadHtml(html);

    const links: Link[] = [];
    $('a[href]').each((_: number, el: any) => {
      const $el = $(el);
      const name = ($el.text() || '').replace(/\s+/g, ' ').trim();
      const href = $el.attr('href') || '';
      if (!name || name.length > 60) return;
      if (/^(javascript:|#|mailto:|tel:)/i.test(href)) return;
      links.push({ name, url: resolveUrl(href, baseUrl) });
    });
    if (links.length < 5) return [];

    // 章节链接几乎都共享同一个目录前缀，只有最后一段不同 → 按前缀聚类
    const groups = new Map<string, Link[]>();
    for (const l of links) {
      const key = l.url.replace(/[^/]*$/, '');
      const arr = groups.get(key);
      if (arr) arr.push(l);
      else groups.set(key, [l]);
    }

    let best: Link[] = [];
    for (const g of groups.values()) {
      const seen = new Set<string>();
      const uniq: Link[] = [];
      for (const x of g) {
        if (seen.has(x.name)) continue;
        seen.add(x.name);
        uniq.push(x);
      }
      if (uniq.length > best.length) best = uniq;
    }
    if (best.length < 5) return [];

    const looksChapter = best.filter((l) => CHAP_NAME_RE.test(l.name)).length;
    // 要么标题明显是章节，要么条数够多（几百条的列表基本不可能是导航）
    if (looksChapter < 3 && best.length < 30) return [];

    return best.map((l, i) => ({ name: l.name, url: l.url, index: i }));
  } catch {
    return [];
  }
}

// 多个候选页面都猜出东西时，挑最像目录的那一份：
// 条数越多、名字里带「第 N 章」的比例越高，越可信。
export function pickBestChapters(
  pages: { url: string; html: string }[]
): BookChapter[] {
  let best: BookChapter[] = [];
  let bestScore = 0;
  for (const p of pages) {
    const ch = guessChapters(p.html, p.url);
    if (ch.length < 3) continue;
    const ratio =
      ch.filter((c) => CHAP_NAME_RE.test(c.name)).length / ch.length;
    const score = ch.length * (0.4 + ratio);
    if (score > bestScore) {
      bestScore = score;
      best = ch;
    }
  }
  return best;
}

// 从章节页里猜正文容器：带较多 <br>/<p>、文本量可观、又不至于包住整页
export function guessContent(html: string, baseUrl: string): string {
  try {
    const $ = loadHtml(html);
    const totalLen = ($('body').text() || '').length || 1;
    let bestHtml = '';
    let bestLen = 0;

    $('div, article, section, td').each((_: number, el: any) => {
      const inner = $(el).html() || '';
      if (!inner || inner.length > 300000) return;
      const brs = (inner.match(/<br\s*\/?>/gi) || []).length;
      const ps = (inner.match(/<p[\s>]/gi) || []).length;
      if (brs + ps < 3) return;
      // 内部还套着好几个块级容器的，基本是页面框架而不是正文
      const childBlocks = $(el).children('div, article, section, table, ul').length;
      if (childBlocks >= 3) return;
      const textLen = ($(el).text() || '').length;
      // 顺带挡掉「文本量几乎等于整页」的最外层容器
      if (textLen > totalLen * 0.995) return;
      if (textLen > bestLen) {
        bestLen = textLen;
        bestHtml = inner;
      }
    });

    // 太小了不像正文（一般一章至少几百字）
    if (bestLen < 200) return '';
    return bestHtml;
  } catch {
    return '';
  }
}
