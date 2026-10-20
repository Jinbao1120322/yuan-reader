import iconv from 'iconv-lite';
import { loadHtml, getValues, getElements, CheerioRoot } from './select';
import { buildSearchUrl, resolveUrl } from './evalUrl';
import {
  BookSource,
  SearchBook,
  BookInfo,
  BookChapter,
  ChapterContent,
  RuleContent,
} from './types';

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

async function fetchHtml(
  url: string,
  source: BookSource,
  method: 'GET' | 'POST' = 'GET'
): Promise<string> {
  const headers = parseHeaders(source);
  const resp = await fetch(url, { method, headers });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} @ ${url}`);
  // 尝试从 header 拿编码
  const ct = resp.headers.get('content-type') || '';
  const buf = await resp.arrayBuffer();
  let charset = 'utf-8';
  const m = ct.match(/charset=([\w-]+)/i);
  if (m) charset = m[1].toLowerCase();
  // 若 header 未声明，尝试从 <meta> 提取（先按 utf-8 解码看 meta）
  if (!m) {
    const peek = iconv.decode(Buffer.from(buf), 'utf-8');
    const mm = peek.match(/<meta[^>]+charset=["']?([\w-]+)/i);
    if (mm) charset = mm[1].toLowerCase();
  }
  if (charset === 'utf-8' || charset === 'utf8') {
    return iconv.decode(Buffer.from(buf), 'utf-8');
  }
  try {
    return iconv.decode(Buffer.from(buf), charset);
  } catch {
    return iconv.decode(Buffer.from(buf), 'utf-8');
  }
}

function first(arr: string[], fallback = ''): string {
  return arr && arr.length ? arr[0] : fallback;
}

// —— 搜索 ——
export async function search(
  source: BookSource,
  key: string,
  page = 1
): Promise<SearchBook[]> {
  const rule = source.ruleSearch;
  const searchUrl =
    (rule && rule.searchUrl) || source.searchUrl;
  if (!searchUrl) return [];
  const url = buildSearchUrl(searchUrl, key, page);
  const html = await fetchHtml(url, source);
  const $ = loadHtml(html);
  const listRule = rule && rule.bookList;
  if (!listRule) return [];
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
    const $ = loadHtml(html);
    const raw = first(getValues($, $, rule.content, url));
    // 分段：按 <br> / 换行 / 句号 切分，并清理空白与标签
    const cleaned = stripTags(raw);
    const parts = cleaned
      .split(/\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    paragraphs.push(...parts);
    // 下一页
    const nu = first(getValues($, $, rule.nextContentUrl, url));
    if (nu && nu !== url) {
      nextUrl = resolveUrl(nu, url);
      url = nextUrl;
    } else break;
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
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}
