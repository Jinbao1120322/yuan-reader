import { Buffer } from 'buffer';
import { loadHtml, getValues, getElements, CheerioRoot } from './select';
import { buildSearchUrl, resolveUrl } from './evalUrl';
import { jsonField, jsonList } from './jsonPath';
import {
  BookSource,
  SearchBook,
  BookInfo,
  BookChapter,
  ChapterContent,
  RuleContent,
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

// —— 目录 ——
export async function getToc(
  source: BookSource,
  tocUrl: string
): Promise<BookChapter[]> {
  const rule = source.ruleToc;
  if (!rule || !rule.chapterList) return [];
  const html = await fetchHtml(tocUrl, source);

  const j = tryJson(html);
  if (j.ok) {
    const out: BookChapter[] = [];
    let i = 0;
    for (const it of jsonList(j.data, rule.chapterList)) {
      if (!it) continue;
      const name = jsonField(it, rule.chapterName);
      const urlRaw = jsonField(it, rule.chapterUrl);
      if (!name || !urlRaw) continue;
      out.push({ name, url: resolveUrl(urlRaw, tocUrl), index: i++ });
    }
    if (out.length) return out;
  }

  const $ = loadHtml(html);
  const items = getElements($, $, rule.chapterList);
  const out: BookChapter[] = [];
  let i = 0;
  items.each((_: number, el: any) => {
    const ctx = $(el);
    const name = first(getValues($, ctx, rule.chapterName, tocUrl));
    let url = first(getValues($, ctx, rule.chapterUrl, tocUrl));
    if (!name || !url) return;
    url = resolveUrl(url, tocUrl);
    out.push({ name, url, index: i++ });
  });
  return out;
}

// —— 章节正文 ——
export async function getContent(
  source: BookSource,
  chapterUrl: string,
  maxPages = 50
): Promise<ChapterContent> {
  const rule: RuleContent | undefined = source.ruleContent;
  if (!rule || !rule.content) return { content: '' };
  let url = chapterUrl;
  let paragraphs: string[] = [];
  let guard = 0;
  let nextUrl: string | undefined;
  while (url && guard < maxPages) {
    guard++;
    const html = await fetchHtml(url, source);
    const j = tryJson(html);
    let raw = '';
    if (j.ok) {
      raw = jsonField(j.data, rule.content);
      const nuJ = jsonField(j.data, rule.nextContentUrl);
      if (nuJ && nuJ !== url) {
        nextUrl = resolveUrl(nuJ, url);
        url = nextUrl;
      } else url = '';
    } else {
      const $ = loadHtml(html);
      raw = first(getValues($, $, rule.content, url));
      // 纯 text 提取会把 <p> 之间的换行全吃掉，正文挤成一大坨。
      // 这里回退取 innerHTML 再剥标签，把段落还原出来。
      if (!/\n/.test(raw)) {
        const htmlRule = /@(html|textnodes)$/i.test(rule.content)
          ? rule.content
          : rule.content.replace(/(@text)?$/i, '@html');
        const alt = first(getValues($, $, htmlRule, url));
        if (alt && alt.length > raw.length) raw = alt;
      }
      // 下一页
      const nu = first(getValues($, $, rule.nextContentUrl, url));
      if (nu && nu !== url) {
        nextUrl = resolveUrl(nu, url);
        url = nextUrl;
      } else url = '';
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
  if (rule.replaceRegex) {
    const i = rule.replaceRegex.indexOf('##');
    if (i !== -1) {
      const re = rule.replaceRegex.slice(0, i);
      const rpl = rule.replaceRegex.slice(i + 2);
      try {
        text = text.replace(new RegExp(re, 'g'), rpl);
      } catch {
        /* ignore bad regex */
      }
    } else {
      try {
        text = text.replace(new RegExp(rule.replaceRegex, 'g'), '');
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
