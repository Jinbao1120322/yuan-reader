import { search } from '../engine/SourceEngine';
import { BookChapter, BookSource, SearchBook } from '../engine/types';

/*
 * 同名书归并 + 跨源找同名书
 * ===========================================================================
 * 搜索是几百个源一起跑，同一本书会在十几个源里各出一条。用户看到的应该是
 * 一本书一行，而不是同一本书刷十几行。
 *
 * 归并键 = 规范化书名（+ 规范化作者）。作者为空时只按书名归并 —— 同名不同书
 * 确实会被合并，但这比「一本《三体》刷 20 行」的体验好得多，而且点进去还能
 * 看到各源，真撞了也能自己选。
 */

/** 去掉空格和常见标点，全角括号之类都算装饰 */
export function normKey(s: string): string {
  return (s || '')
    .replace(/[《》「」『』【】〔〕\s·・．.。,，、!！?？:：;；'"“”‘’()（）\[\]-]/g, '')
    .toLowerCase();
}

export interface BookGroup {
  key: string;
  name: string;
  author: string;
  items: SearchBook[]; // 各书源的条目，第一个是代表
  coverUrl?: string;
  lastChapter?: string;
}

/** 把扁平的搜索结果按「同名同作者」归并，保持首次出现的顺序 */
export function groupBooks(list: SearchBook[]): BookGroup[] {
  const map = new Map<string, BookGroup>();
  for (const b of list) {
    const nk = normKey(b.name);
    if (!nk) continue;
    const ak = normKey(b.author);
    const key = ak ? `${nk}|${ak}` : nk;
    const g = map.get(key);
    if (g) {
      if (!g.items.some((x) => x.sourceId === b.sourceId)) g.items.push(b);
      if (!g.coverUrl && b.coverUrl) g.coverUrl = b.coverUrl;
    } else {
      map.set(key, {
        key,
        name: b.name,
        author: b.author,
        items: [b],
        coverUrl: b.coverUrl,
        lastChapter: b.lastChapter,
      });
    }
  }
  return Array.from(map.values());
}

/** b 是不是「这本书」 */
export function isSameBook(b: SearchBook, name: string, author?: string): boolean {
  const nb = normKey(b.name);
  const nn = normKey(name);
  if (!nb || !nn) return false;
  if (nb !== nn) return false;
  const ab = normKey(b.author);
  const aa = normKey(author || '');
  // 有一边没写作者时不做作者校验，避免漏掉同书异写
  if (!ab || !aa) return true;
  return ab === aa;
}

export interface FindAltOptions {
  timeoutMs?: number;
  concurrency?: number;
  isCancelled?: () => boolean;
  onProgress?: (done: number, total: number, found: number) => void;
}

/**
 * 在已启用的书源里搜同名书，用于「换源」。
 * 只保留书名（和能对上的作者）一致的条目，每个源最多留一条。
 */
export async function findAltSources(
  name: string,
  author: string,
  sources: BookSource[],
  opt: FindAltOptions = {}
): Promise<SearchBook[]> {
  const kw = (name || '').trim();
  if (!kw) return [];

  const timeout = opt.timeoutMs ?? 6000;
  const conc = opt.concurrency ?? 8;
  const pool = sources.filter((s) => s._enabled !== false && isSearchable(s));
  const out: SearchBook[] = [];
  const seen = new Set<string>();
  let done = 0;
  let cursor = 0;

  const report = () => opt.onProgress && opt.onProgress(done, pool.length, out.length);

  const worker = async () => {
    for (;;) {
      if (opt.isCancelled && opt.isCancelled()) return;
      const i = cursor++;
      if (i >= pool.length) return;
      const s = pool[i];
      try {
        const list = await withTimeout(search(s, kw, 1, timeout), timeout + 1500);
        const hit = list.find((b) => isSameBook(b, name, author));
        if (hit && !seen.has(hit.sourceId)) {
          seen.add(hit.sourceId);
          out.push(hit);
        }
      } catch {
        /* 单个源失败不影响整体 */
      }
      done++;
      report();
    }
  };

  report();
  const n = Math.min(conc, Math.max(1, pool.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  report();

  // 书名 + 作者都对上的排前面
  return out.sort((a, b) => {
    const sa = normKey(a.author) === normKey(author) ? 0 : 1;
    const sb = normKey(b.author) === normKey(author) ? 0 : 1;
    return sa - sb;
  });
}

// —— 章节对齐（换源后要跳到「同一章」）——

/** 去掉「第12章」「第 3 节」这类前缀和空白，只留正文标题 */
export function chapterKey(t: string): string {
  return (t || '')
    .replace(/^\s*第\s*[0-9零一二三四五六七八九十百千两]+\s*[章节回卷话集部篇]\s*[:：.、]?\s*/, '')
    .replace(/\s+/g, '');
}

/**
 * 在新目录里找同名章节。三档放宽：
 * 全字匹配 → 去掉章节号前缀后比 → 互相包含
 * 都找不到返回 -1（调用方从第一章开始）
 */
export function matchChapterIndex(list: BookChapter[], title: string): number {
  const t = (title || '').trim();
  if (!t || !list || !list.length) return -1;
  const exact = list.findIndex((c) => (c.name || '').trim() === t);
  if (exact >= 0) return exact;
  const k = chapterKey(t);
  if (!k) return -1;
  const loose = list.findIndex((c) => chapterKey(c.name) === k);
  if (loose >= 0) return loose;
  return list.findIndex((c) => {
    const ck = chapterKey(c.name);
    return !!ck && (ck.includes(k) || k.includes(ck));
  });
}

function isSearchable(s: BookSource): boolean {
  const u = (s.ruleSearch && s.ruleSearch.searchUrl) || s.searchUrl || '';
  if (!u || !/\{\{[\s\S]*?\}\}/.test(u)) return false;
  return !!(s.ruleSearch && s.ruleSearch.bookList);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}
