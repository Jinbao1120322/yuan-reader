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
      // 文案明确说是目录的，最可信
      if (/目录|章节列表|全部章节|章节目录|查看目录|所有章节/.test(text)) score += 12;
      // 很多站详情页的入口写的是「点击阅读 / 开始阅读」，点进去其实就是目录
      else if (/点击阅读|开始阅读|继续阅读|立即阅读|从头阅读|免费阅读/.test(text)) score += 8;

      // 路径里出现 list/mulu/index/chapter，要是独立路径段才算，
      // 否则 newslist.php 这种也会命中，把新闻列表当成目录（真实踩过）。
      if (/(?:^|\/)(list|mulu|catalog|index|chapterlist)(?:[\/._-]|$)/i.test(href)) score += 6;
      else if (/chapter|mulu|catalog/i.test(href)) score += 3;

      // 明显不是目录的，扣分
      if (/news|article|search|login|user|register|about|help|contact/i.test(href)) score -= 6;
      if (/新闻|公告|登录|注册|搜索/.test(text)) score -= 6;

      if (text.length > 0 && text.length <= 10) score += 1;
      if (score > bestScore) {
        bestScore = score;
        bestUrl = resolveUrl(href, baseUrl);
      }
    });
    return bestScore >= 6 ? bestUrl : null;
  } catch {
    return null;
  }
}

/**
 * 目录页里一次性列出的所有分页地址（很多站用 <select> 把所有页的地址铺在源码里）。
 * 拿到之后可以并行抓，比一页一页顺着「下一页」翻快好几倍。
 */
export function tocPagingUrls(html: string, baseUrl: string): string[] {
  try {
    const $ = loadHtml(html);
    const set = new Set<string>();
    $('a[href], option').each((_: number, el: any) => {
      const $el = $(el);
      const raw = $el.attr('href') || $el.attr('value') || '';
      if (!raw) return;
      if (!/(index|asc|page|list|chapterlist)[-_]?\d+/i.test(raw)) return;
      const abs = resolveUrl(raw, baseUrl);
      if (abs && abs !== baseUrl) set.add(abs);
    });
    return Array.from(set);
  } catch {
    return [];
  }
}

/**
 * 目录页的「下一页」。很多站的目录是分页的（index_2.html、asc-2/ 之类），
 * 不翻页就只能拿到第一页那二三十章，用户会以为这本书就这么短。
 */
export function nextTocPageUrl(html: string, baseUrl: string): string | null {
  try {
    const $ = loadHtml(html);
    let found: string | null = null;
    $('a[href]').each((_: number, el: any) => {
      if (found) return;
      const t = ($(el).text() || '').replace(/\s+/g, '');
      const h = $(el).attr('href') || '';
      if (!h || /^(javascript:|#|mailto:)/i.test(h)) return;
      if (/^(下一页|下一頁|下页|下頁|next|›|»)$/i.test(t)) {
        found = resolveUrl(h, baseUrl);
      }
    });
    if (found) return found;

    // 兜底：从 index_2.html / asc-2/ 这种带页码的地址推下一页。
    // 只认明确带页码前缀的，避免把 /25/25428/ 误推成 /25/25429/
    const m = baseUrl.match(/^(.*?(?:index_?|asc-|page-?|list_?|chapterlist-?))(\d+)(\.html?|\/?)$/i);
    if (m && Number(m[2]) < 5000) {
      return `${m[1]}${Number(m[2]) + 1}${m[3]}`;
    }
    return null;
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
    if (ch.length < 5) continue;
    const ratio =
      ch.filter((c) => CHAP_NAME_RE.test(c.name)).length / ch.length;
    // 详情页上零散的几个链接（「开始阅读」「加入书架」之类）也会被猜成"章节"，
    // 门槛松了就会把三五条垃圾当成目录返回，用户看到的就是"这本书只有几章"。
    // 要求：至少 5 条，且六成以上的标题确实长得像章节名。
    if (ratio < 0.6) continue;
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
