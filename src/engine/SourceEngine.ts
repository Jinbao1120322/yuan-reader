import { Buffer } from 'buffer';
import { loadHtml, getValues, getElements, CheerioRoot } from './select';
import { buildSearchUrl, resolveUrl } from './evalUrl';
import { jsonField, jsonList } from './jsonPath';
import { pickBestChapters, guessContent, guessTocUrl, nextTocPageUrl, tocPagingUrls, xpathChapters } from './fallback';
import {
  BookSource,
  SearchBook,
  BookInfo,
  BookChapter,
  ChapterContent,
  RuleContent,
  RuleToc,
} from './types';

// 响应不是 HTML 而是 JSON 接口时，规则按 JSONPath 解析。
// 判断方式很朴素：首字符是 { 或 [，且能 JSON.parse 成功。
function tryJson(text: string): { ok: boolean; data: any } {
  const t = (text || '').trim();
  if (!t) return { ok: false, data: null };
  const c = t[0];
  if (c !== '{' && c !== '[') return { ok: false, data: null };
  try {
    return { ok: true, data: JSON.parse(t) };
  } catch {
    return { ok: false, data: null };
  }
}

// iconv-lite 改为运行期懒加载：避免它在模块加载期抛错时拖垮 App 启动。
// （它是 App 依赖图里唯一依赖 Node 内置模块 string_decoder 的库，风险最高）
type IconvModule = { decode: (buf: any, enc: string) => string };
let _iconv: IconvModule | null = null;
function iconvLib(): IconvModule {
  if (!_iconv) {
    const m: any = require('iconv-lite');
    _iconv = (m && m.decode ? m : (m && m.default) || m) as IconvModule;
  }
  return _iconv as IconvModule;
}

const DEFAULT_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function parseHeaders(source: BookSource): Record<string, string> {
  const h: Record<string, string> = { 'User-Agent': DEFAULT_UA };
  if (source.header) {
    try {
      const parsed = JSON.parse(source.header);
      for (const k of Object.keys(parsed)) h[k] = parsed[k];
    } catch {
      /* ignore */
    }
  }
  return h;
}

// 默认超时：跨源搜索时有几百个源在排队，任何一个卡死的站点都不能拖住整批。
const DEFAULT_TIMEOUT = 12000;

async function fetchHtml(
  url: string,
  source: BookSource,
  method: 'GET' | 'POST' = 'GET',
  timeoutMs = DEFAULT_TIMEOUT
): Promise<string> {
  const headers = parseHeaders(source);
  // AbortController 在个别 RN 版本里可能缺失，缺了也不能让整批搜索直接失败
  const ctrl =
    typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => {
    try {
      ctrl?.abort();
    } catch {
      /* ignore */
    }
  }, timeoutMs);
  let buf: ArrayBuffer;
  let ct: string;
  try {
    const resp = await fetch(url, {
      method,
      headers,
      ...(ctrl ? { signal: ctrl.signal } : {}),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} @ ${url}`);
    ct = resp.headers.get('content-type') || '';
    buf = await resp.arrayBuffer();
  } catch (e: any) {
    if (e && (e.name === 'AbortError' || (ctrl && ctrl.signal.aborted))) {
      throw new Error(`超时 ${timeoutMs}ms @ ${url}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  // 尝试从 header 拿编码
  let charset = 'utf-8';
  const m = ct.match(/charset=([\w-]+)/i);
  if (m) charset = m[1].toLowerCase();
  // 若 header 未声明，尝试从 <meta> 提取（先按 utf-8 解码看 meta）
  if (!m) {
    const peek = iconvLib().decode(Buffer.from(buf), 'utf-8');
    const mm = peek.match(/<meta[^>]+charset=["']?([\w-]+)/i);
    if (mm) charset = mm[1].toLowerCase();
  }
  if (charset === 'utf-8' || charset === 'utf8') {
    return iconvLib().decode(Buffer.from(buf), 'utf-8');
  }
  try {
    return iconvLib().decode(Buffer.from(buf), charset);
  } catch {
    return iconvLib().decode(Buffer.from(buf), 'utf-8');
  }
}

function first(arr: string[], fallback = ''): string {
  return arr && arr.length ? arr[0] : fallback;
}

// —— 搜索 ——
export async function search(
  source: BookSource,
  key: string,
  page = 1,
  timeoutMs = DEFAULT_TIMEOUT
): Promise<SearchBook[]> {
  const rule = source.ruleSearch;
  const searchUrl =
    (rule && rule.searchUrl) || source.searchUrl;
  if (!searchUrl) return [];
  const url = resolveUrl(
    buildSearchUrl(searchUrl, key, page),
    source.bookSourceUrl || ''
  );
  const html = await fetchHtml(url, source, 'GET', timeoutMs);
  const listRule = rule && rule.bookList;
  if (!listRule) return [];

  // ---- JSON 接口源 ----
  const j = tryJson(html);
  if (j.ok) {
    const out: SearchBook[] = [];
    for (const it of jsonList(j.data, listRule)) {
      if (!it || typeof it !== 'object') continue;
      const name = jsonField(it, rule!.name);
      const bookUrlRaw = jsonField(it, rule!.bookUrl);
      if (!name || !bookUrlRaw) continue;
      const cover = jsonField(it, rule!.coverUrl);
      out.push({
        name,
        author: jsonField(it, rule!.author),
        bookUrl: resolveUrl(bookUrlRaw, url),
        coverUrl: cover ? resolveUrl(cover, url) : undefined,
        intro: jsonField(it, rule!.intro),
        kind: jsonField(it, rule!.kind),
        lastChapter: jsonField(it, rule!.lastChapter),
        wordCount: jsonField(it, rule!.wordCount),
        sourceId: source.bookSourceUrl,
        sourceName: source.bookSourceName,
      });
    }
    if (out.length) return out;
    // 没捞到条目就继续走 HTML 分支（有些接口把 HTML 塞在 JSON 字段里）
  }

  const $ = loadHtml(html);
  const items = getElements($, $, listRule);
  const out: SearchBook[] = [];
  items.each((_: number, el: any) => {
    const ctx = $(el);
    const name = first(getValues($, ctx, rule!.name, url));
    const author = first(getValues($, ctx, rule!.author, url));
    const bookUrl = resolveUrl(first(getValues($, ctx, rule!.bookUrl, url)), url);
    if (!name || !bookUrl) return;
    const cover = first(getValues($, ctx, rule!.coverUrl, url));
    const intro = first(getValues($, ctx, rule!.intro, url));
    const kind = first(getValues($, ctx, rule!.kind, url));
    const lastChapter = first(getValues($, ctx, rule!.lastChapter, url));
    const wordCount = first(getValues($, ctx, rule!.wordCount, url));
    out.push({
      name,
      author,
      bookUrl,
      coverUrl: cover ? resolveUrl(cover, url) : undefined,
      intro,
      kind,
      lastChapter,
      wordCount,
      sourceId: source.bookSourceUrl,
      sourceName: source.bookSourceName,
    });
  });
  return out;
}

// —— 书籍详情 ——
export async function getBookInfo(
  source: BookSource,
  bookUrl: string
): Promise<BookInfo | null> {
  const rule = source.ruleBookInfo;
  if (!rule) return null;
  const html = await fetchHtml(bookUrl, source);

  const j = tryJson(html);
  if (j.ok) {
    const jname = jsonField(j.data, rule.name);
    if (jname) {
      const jcover = jsonField(j.data, rule.coverUrl);
      let jtoc = jsonField(j.data, rule.tocUrl);
      jtoc = jtoc ? resolveUrl(jtoc, bookUrl) : bookUrl;
      return {
        name: jname,
        author: jsonField(j.data, rule.author),
        coverUrl: jcover ? resolveUrl(jcover, bookUrl) : undefined,
        intro: jsonField(j.data, rule.intro),
        kind: jsonField(j.data, rule.kind),
        lastChapter: jsonField(j.data, rule.lastChapter),
        wordCount: jsonField(j.data, rule.wordCount),
        bookUrl,
        tocUrl: jtoc,
        sourceId: source.bookSourceUrl,
        sourceName: source.bookSourceName,
      };
    }
  }

  const $ = loadHtml(html);
  const name = first(getValues($, $, rule.name, bookUrl));
  if (!name) return null;
  const author = first(getValues($, $, rule.author, bookUrl));
  const cover = first(getValues($, $, rule.coverUrl, bookUrl));
  const intro = first(getValues($, $, rule.intro, bookUrl));
  const kind = first(getValues($, $, rule.kind, bookUrl));
  const lastChapter = first(getValues($, $, rule.lastChapter, bookUrl));
  const wordCount = first(getValues($, $, rule.wordCount, bookUrl));
  let tocUrl = first(getValues($, $, rule.tocUrl, bookUrl));
  if (tocUrl) tocUrl = resolveUrl(tocUrl, bookUrl);
  else tocUrl = bookUrl;
  return {
    name,
    author,
    coverUrl: cover ? resolveUrl(cover, bookUrl) : undefined,
    intro,
    kind,
    lastChapter,
    wordCount,
    bookUrl,
    tocUrl,
    sourceId: source.bookSourceUrl,
    sourceName: source.bookSourceName,
  };
}

// 按书源规则解析目录（JSON 接口 或 HTML）
function tocByRule(
  html: string,
  pageUrl: string,
  rule: RuleToc
): BookChapter[] {
  try {
    const j = tryJson(html);
    if (j.ok) {
      const out: BookChapter[] = [];
      let i = 0;
      for (const it of jsonList(j.data, rule.chapterList)) {
        if (!it) continue;
        const name =
          jsonField(it, rule.chapterName) ||
          jsonField(it, 'name') ||
          jsonField(it, 'title');
        const urlRaw =
          jsonField(it, rule.chapterUrl) ||
          jsonField(it, 'url') ||
          jsonField(it, 'link');
        if (!name || !urlRaw) continue;
        out.push({ name, url: resolveUrl(urlRaw, pageUrl), index: i++ });
      }
      if (out.length) return out;
    }

    const listRule = rule.chapterList || '';
    if (!listRule) return [];

    const $ = loadHtml(html);
    const items = getElements($, $, listRule);
    if (!items || !items.length) {
      // xpath 写的 chapterList 走独立分支
      if (/^@?(xpath:|\/\/)/i.test(listRule)) {
        const xc = xpathChapters(html, listRule, pageUrl);
        if (xc.length) return xc;
      }
      return [];
    }

    const out: BookChapter[] = [];
    let i = 0;
    items.each((_: number, el: any) => {
      const ctx = $(el);
      let name = rule.chapterName
        ? first(getValues($, ctx, rule.chapterName, pageUrl))
        : '';
      let url = rule.chapterUrl
        ? first(getValues($, ctx, rule.chapterUrl, pageUrl))
        : '';
      // 书源只写了 chapterList 的情况很常见，按最常见的结构补齐
      const ownHref = typeof ctx.attr === 'function' ? ctx.attr('href') : '';
      if (!url && ownHref) url = ownHref;
      if (!url) url = ctx.find('a').first().attr('href') || '';
      if (!name && ownHref) name = (ctx.text() || '').replace(/\s+/g, ' ').trim();
      if (!name) {
        name = (ctx.find('a').first().text() || ctx.text() || '')
          .replace(/\s+/g, ' ')
          .trim();
      }
      if (!name || !url) return;
      out.push({ name, url: resolveUrl(url, pageUrl), index: i++ });
    });
    return out;
  } catch {
    return [];
  }
}

// —— 目录 ——
// 三路尝试：①按书源规则 ②顺着详情页里的「目录」入口再试 ③按页面结构猜。
// 之前只走第一路，规则一残缺就「未解析到章节目录」，书搜到了却读不了。
export async function getToc(
  source: BookSource,
  tocUrl: string,
  bookUrl?: string
): Promise<BookChapter[]> {
  const rule = source.ruleToc;

  interface Page {
    url: string;
    html: string;
  }
  const pages: Page[] = [];
  const seen = new Set<string>();
  // 目录页可能是分页的，所以上限给得比"三五个候选页"宽一些
  // 目录分页可以很多（2941 章的书有 147 页），这两个上限决定"能拿多全 vs 等多久"
  const MAX_TOC_PAGES = 50;
  const MAX_TOC_CHAPTERS = 1200;

  const load = async (u: string): Promise<Page | null> => {
    if (!u) return null;
    // 同一个地址可能先被 guessTocUrl 当作「目录入口」加载过，翻页撞上时要复用而不是放弃
    const exist = pages.find((x) => x.url === u);
    if (exist) return exist;
    if (pages.length >= MAX_TOC_PAGES) return null;
    seen.add(u);
    try {
      const html = await fetchHtml(u, source, 'GET', 10000);
      if (!html) return null;
      const p = { url: u, html };
      pages.push(p);
      return p;
    } catch {
      return null;
    }
  };

  // 每页按规则解析，结果挂在 parsed 上（同一页只解析一次）
  const parsed = new Map<Page, BookChapter[]>();
  const parsePage = (p: Page): BookChapter[] => {
    const hit = parsed.get(p);
    if (hit) return hit;
    if (!rule || !rule.chapterList) return [];
    const ch = tocByRule(p.html, p.url, rule);
    if (ch.length) parsed.set(p, ch);
    return ch;
  };

  const bestSoFar = (): { ch: BookChapter[]; page?: Page } => {
    let best: { ch: BookChapter[]; page?: Page } = { ch: [] };
    for (const [p, ch] of parsed) {
      if (ch.length > best.ch.length) best = { ch, page: p };
    }
    return best;
  };

  await load(tocUrl);
  if (bookUrl) await load(bookUrl);
  if (!pages.length) return [];
  pages.slice().forEach(parsePage);

  /*
   * 关键：**不再"解析出章节就立刻返回"**。
   * 详情页上通常挂着「最新章节」十来条，规则一样能匹配，以前就把它当成目录返回了，
   * 用户看到的就是"这本书只有 7 章"。现在把所有候选页都比一遍，取最完整的那份。
   */

  // 详情页里常有「查看目录 / 全部章节」的入口，顺着去一次。
  // 只在当前结果明显不完整时才找 —— 否则在完整目录页上会把底部的「下一页」
  //（href 里带 index）误当成目录入口。
  if (bestSoFar().ch.length < 100) {
    for (const p of pages.slice()) {
      const link = guessTocUrl(p.html, p.url);
      if (!link) continue;
      const np = await load(link);
      if (np) parsePage(np);
    }
  }

  let best = bestSoFar();

  // 章数明显偏少 → 目录页可能是分页的，把剩下的页补上
  if (best.page && isTocIncomplete(best.ch)) {
    const base = best.page;
    let all = best.ch.slice();

    // ① 目录页常常把全部分页地址铺在源码里（<select> 或底部页码），能一次拿到就并行抓
    const pages2 = tocPagingUrls(base.html, base.url).slice(0, MAX_TOC_PAGES - 1);
    if (pages2.length) {
      const batchSize = 6;
      for (let i = 0; i < pages2.length && all.length < MAX_TOC_CHAPTERS; i += batchSize) {
        const chunk = pages2.slice(i, i + batchSize);
        const got = await Promise.all(chunk.map((u) => load(u)));
        for (const p2 of got) {
          if (!p2) continue;
          const ch = parsePage(p2);
          if (ch.length) all = dedupeChapters(all.concat(ch));
        }
      }
    }

    // ② 拿不到分页清单，就顺着「下一页」一页页跟（最多 12 页，别把目录加载拖太久）
    if (all.length === best.ch.length) {
      let cur = base;
      const visited = new Set<string>([cur.url]);
      for (let guard = 0; guard < 12 && all.length < MAX_TOC_CHAPTERS; guard++) {
        const next = nextTocPageUrl(cur.html, cur.url);
        if (!next || visited.has(next)) break;
        visited.add(next);
        const np = await load(next);
        if (!np) break;
        const ch = parsePage(np);
        if (!ch.length) break;
        all = dedupeChapters(all.concat(ch));
        cur = np;
      }
    }

    if (all.length > best.ch.length) {
      best = { ch: all, page: base };
    }
  }

  if (best.ch.length) return normalizeChapterOrder(best.ch);

  // 兜底：规则完全对不上时按结构猜
  const guessed = pickBestChapters(pages);
  if (guessed.length) return normalizeChapterOrder(guessed);

  return [];
}

/** 中文数字 → 阿拉伯，用于识别章号 */
function cnToNum(t: string): number {
  if (/^\d+$/.test(t)) return Number(t);
  const D: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let unit = 0, num = 0;
  for (const ch of t) {
    if (ch === '十' || ch === '百' || ch === '千') {
      const w = ch === '十' ? 10 : ch === '百' ? 100 : 1000;
      unit += (num || 1) * w;
      num = 0;
    } else if (D[ch] !== undefined) {
      num = D[ch];
    } else {
      return NaN;
    }
  }
  return unit + num;
}

/** 从章节名里取章号，取不到返回 NaN */
function chapterNo(name: string): number {
  const m = /第\s*([0-9零一二三四五六七八九十百千两]+)\s*[章节回]/.exec(name || '');
  if (m) return cnToNum(m[1]);
  const m2 = /^\s*(\d+)\s*[、.．:：]/.exec(name || '');
  if (m2) return Number(m2[1]);
  return NaN;
}

/**
 * 修正章节顺序。
 * 不少站点的目录是「最新在前」倒序的（翻页拿到的也是从后往前），
 * 直接交给阅读器会导致"打开就是最后一章"。这里只在识别出明显倒序时翻转，
 * 拿不到章号就原样返回，不动那些顺序本来就没问题的站点。
 */
function normalizeChapterOrder(list: BookChapter[]): BookChapter[] {
  if (list.length < 3) return list;

  const items = list.map((c, i) => ({ c, i, n: chapterNo(c.name) }));
  const valid = items.filter((x) => !Number.isNaN(x.n));
  // 章号覆盖不到八成就不动它（有些站的章节名完全不带数字，硬排会打乱原顺序）
  if (valid.length < list.length * 0.8) return list;

  // 已经是从小到大就不用动
  let sorted = true;
  for (let k = 1; k < valid.length; k++) {
    if (valid[k].n < valid[k - 1].n) {
      sorted = false;
      break;
    }
  }
  if (sorted) return list;

  // 按章号稳定排序；取不到章号的排到最后，保持它们原来的相对顺序
  const arr = items.slice().sort((a, b) => {
    const an = Number.isNaN(a.n) ? Number.MAX_SAFE_INTEGER : a.n;
    const bn = Number.isNaN(b.n) ? Number.MAX_SAFE_INTEGER : b.n;
    if (an !== bn) return an - bn;
    return a.i - b.i;
  });
  return arr.map((x, i) => ({ ...x.c, index: i }));
}

/** 章节按 url 去重，分页边界常常重复几章 */
function dedupeChapters(list: BookChapter[]): BookChapter[] {
  const seen = new Set<string>();
  const out: BookChapter[] = [];
  for (const c of list) {
    const k = c.url || `${c.name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...c, index: out.length });
  }
  return out;
}

/**
 * 判断这份目录是不是"不完整"。
 * 两种情况：条数太少（多半是详情页的最新章节），
 * 或者章节号远大于条数（比如只有 10 条却写着「第2941章」，明显是倒序摘录）。
 */
function isTocIncomplete(ch: BookChapter[]): boolean {
  if (ch.length < 100) {
    let maxNo = 0;
    for (const c of ch) {
      const m = /第\s*(\d+)\s*[章节回]/.exec(c.name || '');
      if (m) maxNo = Math.max(maxNo, Number(m[1]));
    }
    if (maxNo > ch.length * 3 + 20) return true; // 章节号远超条数
    return ch.length < 100;
  }
  return false;
}

// —— 章节正文 ——
export async function getContent(
  source: BookSource,
  chapterUrl: string,
  maxPages = 50
): Promise<ChapterContent> {
  const rule: RuleContent | undefined = source.ruleContent;
  const contentRule = rule && rule.content ? rule.content : '';
  const nextRule = rule && rule.nextContentUrl ? rule.nextContentUrl : '';

  let url = chapterUrl;
  let paragraphs: string[] = [];
  let guard = 0;
  let nextUrl: string | undefined;
  while (url && guard < maxPages) {
    guard++;
    const pageUrl = url;
    const html = await fetchHtml(pageUrl, source);
    const j = tryJson(html);
    let raw = '';

    if (j.ok) {
      raw = contentRule ? jsonField(j.data, contentRule) : '';
      const nuJ = nextRule ? jsonField(j.data, nextRule) : '';
      url = nuJ && nuJ !== pageUrl ? resolveUrl(nuJ, pageUrl) : '';
    } else {
      const $ = loadHtml(html);
      if (contentRule) {
        raw = first(getValues($, $, contentRule, pageUrl));
        // 纯 text 提取会把 <p> 之间的换行全吃掉，正文挤成一大坨。
        // 这里回退取 innerHTML 再剥标签，把段落还原出来。
        if (!/\n/.test(raw)) {
          const htmlRule = /@(html|textnodes)$/i.test(contentRule)
            ? contentRule
            : contentRule.replace(/(@text)?$/i, '@html');
          const alt = first(getValues($, $, htmlRule, pageUrl));
          if (alt && alt.length > raw.length) raw = alt;
        }
      }
      // 规则没写或没命中 → 按页面结构猜正文
      if (!raw) raw = guessContent(html, pageUrl);

      const nu = nextRule ? first(getValues($, $, nextRule, pageUrl)) : '';
      url = nu && nu !== pageUrl ? resolveUrl(nu, pageUrl) : '';
    }

    // 分段：按 <br> / 换行 / 句号 切分，并清理空白与标签
    const cleaned = stripTags(raw);
    const parts = cleaned
      .split(/\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    paragraphs.push(...parts);
    if (!url) break;
  }
  // 书源级替换净化：replaceRegex 形如 "pattern##replacement" 或 "pattern"（删除）
  let text = paragraphs.join('\n\n');
  const replaceRegex = rule && rule.replaceRegex ? rule.replaceRegex : '';
  if (replaceRegex) {
    const i = replaceRegex.indexOf('##');
    if (i !== -1) {
      const re = replaceRegex.slice(0, i);
      const rpl = replaceRegex.slice(i + 2);
      try {
        text = text.replace(new RegExp(re, 'g'), rpl);
      } catch {
        /* ignore bad regex */
      }
    } else {
      try {
        text = text.replace(new RegExp(replaceRegex, 'g'), '');
      } catch {
        /* ignore */
      }
    }
  }
  return { content: text };
}

function stripTags(html: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h\d|li|dd|dt|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    // cheerio 取 innerHTML 时会把中文等非 ASCII 转成 &#x51b0; 这种十六进制实体，
    // 不还原的话正文会变成一串 &#x...;
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
