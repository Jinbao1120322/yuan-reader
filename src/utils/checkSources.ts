import { search, getToc } from '../engine/SourceEngine';
import { BookSource } from '../engine/types';

/*
 * 书源有效性检测
 * ===========================================================================
 * 判定标准只有一条：**用这个源能不能搜到书**。
 *
 * 为什么不只发个 GET 看状态码：
 *   绝大多数小说站的首页对任何路径都返回 200，甚至 404 页面也返回 200 + 一个
 *   「本站已改版」的模板页。所以「站点活着」完全不代表「书源能用」。
 *   真正会让书源不可用的是规则失配 —— 站点改版后 bookList 选择器匹配不到东西，
 *   表现就是搜到 0 条。这才是要清理的对象。
 *
 * 判定结果与处理：
 *   ok      能搜到     → 保留
 *   empty   搜到 0 条   → 规则失效，删
 *   http    站点报 4xx/5xx、或者根本连不上 → 删
 *   net     域名解析失败 / 连接被拒 / TLS 失败 → 删
 *   notoc   能搜到但取不到目录（深度检测才有）→ 删
 *   timeout 6 秒内没响应 → 删
 *   skip    没有搜索规则 → 删（这种源本来就搜不了书，留着占位）
 *
 * 注意：超时也算无效。6 秒都回不来结果的源，实际用的时候同样是卡住的，
 * 留着只会拖慢每次搜索。（早期版本为了防网络抖动误删曾保留超时源，已按用户要求改回删除）
 */

export type Verdict =
  | 'ok'
  | 'empty'
  | 'http'
  | 'net'
  | 'timeout'
  | 'notoc'
  | 'skip';

export interface CheckItem {
  id: string;
  name: string;
  host: string;
  verdict: Verdict;
  detail: string;
  books?: number;
  chapters?: number;
}

/** 这些判定结果属于「确定没用」，检测后自动删除 */
export const REMOVABLE: Verdict[] = ['empty', 'http', 'net', 'notoc', 'skip', 'timeout'];

export const VERDICT_LABEL: Record<Verdict, string> = {
  ok: '有效',
  empty: '搜不到书',
  http: '站点报错',
  net: '连不上',
  timeout: '超时',
  notoc: '取不到目录',
  skip: '无搜索规则',
};

export interface Tally {
  done: number;
  total: number;
  ok: number;
  dead: number;
  timeout: number;
  skip: number;
}

/** 检测时用的搜索词。单字容易被部分站点拒绝，两字命中率最高 */
export const CHECK_KEYWORD = '小说';

const PER_SOURCE_TIMEOUT = 6000;
const CONCURRENCY_FAST = 12;
const CONCURRENCY_DEEP = 6;

function searchUrlOf(s: BookSource): string {
  return (s.ruleSearch && s.ruleSearch.searchUrl) || s.searchUrl || '';
}

/**
 * 能不能参与搜索。跟搜索页的判定保持一致：
 * searchUrl 里没有 {{...}} 占位符的源，发出去只会拿到首页，永远不可能有结果；
 * 没有 bookList 的源就算打开搜索页也解析不出条目。
 */
export function searchable(s: BookSource): boolean {
  const u = searchUrlOf(s);
  if (!u) return false;
  if (!/\{\{[\s\S]*?\}\}/.test(u)) return false;
  if (!s.ruleSearch || !s.ruleSearch.bookList) return false;
  return true;
}

function hostOf(s: BookSource): string {
  const m = /^[a-zA-Z][\w+.-]*:\/\/([^/?#]+)/.exec(s.bookSourceUrl || '');
  return m ? m[1] : s.bookSourceUrl || '';
}

/** 引擎内部 abort 偶尔不生效，这里再压一层，保证每个源都有确定的结束时刻 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`超时 ${ms}ms`)), ms);
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

/** 把引擎抛出来的错误翻译成判定结果 */
function classify(e: any): { verdict: Verdict; detail: string } {
  const msg = String((e && e.message) || e || '未知错误');
  if (/^超时/.test(msg)) {
    return { verdict: 'timeout', detail: `${PER_SOURCE_TIMEOUT / 1000} 秒无响应` };
  }
  const m = /^HTTP (\d+)/.exec(msg);
  if (m) return { verdict: 'http', detail: `HTTP ${m[1]}` };
  if (
    /Failed to fetch|fetch failed|Network request failed|Could not connect|ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|offline|SSL|TLS|证书/i.test(
      msg
    )
  ) {
    return { verdict: 'net', detail: '域名不通或连接被拒' };
  }
  return { verdict: 'net', detail: msg.slice(0, 60) };
}

export interface CheckOptions {
  keyword?: string;
  /** 深度检测：搜索通过后再验一步「能不能取到章节目录」，能搜到却打不开的源也会被清掉 */
  deep?: boolean;
  isCancelled?: () => boolean;
  onProgress?: (t: Tally) => void;
}

async function checkOne(s: BookSource, opt: CheckOptions): Promise<CheckItem> {
  const base: CheckItem = {
    id: s._id || s.bookSourceUrl,
    name: s.bookSourceName || '(未命名)',
    host: hostOf(s),
    verdict: 'ok',
    detail: '',
  };

  if (!searchable(s)) {
    return { ...base, verdict: 'skip', detail: '没有搜索规则，搜不了书' };
  }

  const kw = opt.keyword || CHECK_KEYWORD;
  const limit = PER_SOURCE_TIMEOUT + 1500;

  // ① 搜索
  let books = 0;
  let firstUrl = '';
  try {
    const list = await withTimeout(search(s, kw, 1, PER_SOURCE_TIMEOUT), limit);
    books = list.length;
    if (books > 0) firstUrl = list[0].bookUrl || '';
  } catch (e) {
    return { ...base, ...classify(e) };
  }

  if (books === 0) {
    return { ...base, verdict: 'empty', detail: `搜「${kw}」没有任何结果` };
  }

  // ② 深度检测：目录
  if (opt.deep && firstUrl) {
    try {
      const ch = await withTimeout(
        getToc(s, firstUrl, firstUrl),
        PER_SOURCE_TIMEOUT + 4000
      );
      if (!ch.length) {
        return {
          ...base,
          verdict: 'notoc',
          books,
          detail: '能搜到书，但解析不出章节目录',
        };
      }
      return { ...base, verdict: 'ok', books, chapters: ch.length, detail: `${books} 本` };
    } catch (e) {
      const c = classify(e);
      // 目录这一步超时同样不算死站，退回「有效但慢」
      if (c.verdict === 'timeout') {
        return { ...base, verdict: 'ok', books, detail: `${books} 本（目录超时）` };
      }
      return { ...base, verdict: 'notoc', books, detail: '打开书籍时出错' };
    }
  }

  return { ...base, verdict: 'ok', books, detail: `${books} 本` };
}

export function emptyTally(total: number): Tally {
  return { done: 0, total, ok: 0, dead: 0, timeout: 0, skip: 0 };
}

/** 并发池跑完整个列表，边跑边回报进度 */
export async function runCheck(
  list: BookSource[],
  opt: CheckOptions = {}
): Promise<CheckItem[]> {
  const total = list.length;
  const results: CheckItem[] = [];
  const tally = emptyTally(total);
  const conc = opt.deep ? CONCURRENCY_DEEP : CONCURRENCY_FAST;
  let cursor = 0;

  const report = () => {
    if (opt.onProgress) opt.onProgress({ ...tally });
  };
  report();

  const worker = async () => {
    for (;;) {
      if (opt.isCancelled && opt.isCancelled()) return;
      const idx = cursor++;
      if (idx >= total) return;
      const item = await checkOne(list[idx], opt);
      results.push(item);

      tally.done++;
      if (item.verdict === 'ok') tally.ok++;
      else if (item.verdict === 'timeout') tally.timeout++;
      else if (item.verdict === 'skip') tally.skip++;
      else tally.dead++;
      // 每完成 4 个报一次，避免 1300 个源时每完成一个就 setState 一次
      if (tally.done % 4 === 0 || tally.done === total) report();
    }
  };

  const n = Math.min(conc, Math.max(1, total));
  const workers: Promise<void>[] = [];
  for (let i = 0; i < n; i++) workers.push(worker());
  await Promise.all(workers);

  report();
  return results;
}
