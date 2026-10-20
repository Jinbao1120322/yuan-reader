import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, FlatList, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, Keyboard } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useStore } from '../store/useStore';
import { search } from '../engine/SourceEngine';
import { BookSource, SearchBook } from '../engine/types';
import { BookCover } from '../components/BookCover';
import { APP } from '../theme/theme';
import { TopBar } from '../components/TopBar';
import { BookGroup, groupBooks } from '../utils/bookMatch';
import { Text } from '../components/AppText';

// 跨源搜索的调度参数。
// 之前是 Promise.all 一次性把几百个源全发出去、且等全部返回才渲染，
// 任何一个卡死的站点都会让界面永远停在「正在跨书源搜索…」。
const CONCURRENCY = 12; // 同时在飞的请求数
const PER_SOURCE_TIMEOUT = 6000; // 单个源的超时（毫秒）

interface Stat {
  done: number;
  total: number;
  hit: number;
  skipped: number;
}

// 模块级会话缓存：点进书籍详情再返回时，直接恢复上次的结果，不用重搜。
// 如果上次还没搜完就离开了，回来会自动接着搜。
let session: {
  kw: string;
  results: SearchBook[];
  done: boolean;
  stat: Stat;
} | null = null;

function searchUrlOf(s: BookSource): string {
  return (s.ruleSearch && s.ruleSearch.searchUrl) || s.searchUrl || '';
}

// searchUrl 里没写 {{key}} 的源，发出去只会拿到首页，纯浪费一次请求；
// 没有 bookList 的源就算有搜索页也解析不出条目。
function searchable(s: BookSource): boolean {
  const u = searchUrlOf(s);
  if (!u) return false;
  if (!/\{\{[\s\S]*?\}\}/.test(u)) return false;
  if (!s.ruleSearch || !s.ruleSearch.bookList) return false;
  return true;
}

// 粗排：书名完全命中 > 前缀命中 > 包含 > 作者命中 > 其它
function rankOf(b: SearchBook, kw: string): number {
  const n = b.name || '';
  const a = b.author || '';
  if (n === kw) return 0;
  if (n.startsWith(kw)) return 1;
  if (n.includes(kw)) return 2;
  if (a === kw) return 3;
  if (a.includes(kw)) return 4;
  return 5;
}

// 超时兜底：fetch 的 AbortController 在个别 RN 版本上不生效，
// 光靠引擎内部 abort 仍有可能卡死，这里再压一层 Promise.race。
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms + 1500);
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

const EMPTY_STAT: Stat = { done: 0, total: 0, hit: 0, skipped: 0 };

// zustand 的持久化是异步的（AsyncStorage）。首帧 sources 还是空数组，
// 这时候点搜索会「一个源都没有」。等 hydrate 完再干活。
async function ensureHydrated(): Promise<void> {
  const p: any = (useStore as any).persist;
  if (!p || typeof p.hasHydrated !== 'function' || p.hasHydrated()) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const fin = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    try {
      p.onFinishHydration(fin);
    } catch {
      fin();
    }
    setTimeout(fin, 3000); // 兜底，别永远等下去
  });
}

export function SearchScreen() {
  const navigation = useNavigation<any>();

  const [key, setKey] = useState(session?.kw || '');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchBook[]>(session?.results || []);
  const [done, setDone] = useState(!!session?.done);
  const [stat, setStat] = useState<Stat>(session?.stat || EMPTY_STAT);

  // runId 用来作废旧搜索：新一轮开始时，上一轮还在飞的请求回来也不会污染结果
  const runIdRef = useRef(0);
  const cancelRef = useRef(false);
  // 组件卸载后不再 setState（但会话缓存照写，返回时能恢复）
  const aliveRef = useRef(true);

  const runSearch = async (rawKw: string) => {
    const kw = rawKw.trim();
    if (!kw) return;
    Keyboard.dismiss();

    await ensureHydrated();

    // 直接读 store 快照，而不是闭包里的旧值：书源页刚改过开关也能立刻生效
    const enabled = (useStore.getState().sources || []).filter((s) => s._enabled);
    const usable = enabled.filter(searchable);
    const skipped = enabled.length - usable.length;

    if (usable.length === 0) {
      setResults([]);
      setStat({ done: 0, total: 0, hit: 0, skipped });
      setDone(true);
      setLoading(false);
      session = { kw, results: [], done: true, stat: { done: 0, total: 0, hit: 0, skipped } };
      return;
    }

    // 历史上真出过结果的源排到队首：先跑活的，死站丢在后面慢慢耗。
    // 这样第一批结果往往是「刚点搜索就出来」，而不用等几百个死域名超时。
    const hits = useStore.getState().sourceHits || {};
    const queue = usable
      .slice()
      .sort((a, b) => (hits[b.bookSourceUrl] || 0) - (hits[a.bookSourceUrl] || 0));

    const myRun = ++runIdRef.current;
    cancelRef.current = false;
    setLoading(true);
    setDone(false);
    setResults([]);
    setStat({ done: 0, total: usable.length, hit: 0, skipped });
    session = {
      kw,
      results: [],
      done: false,
      stat: { done: 0, total: usable.length, hit: 0, skipped },
    };

    const seen = new Set<string>();
    const acc: SearchBook[] = [];
    const hitIds: string[] = [];
    let finished = 0;
    let hit = 0;
    let lastStatAt = 0;

    // 有结果就立刻上屏——这是「谁先搜到谁先显示」的关键，
    // 不等凑满一批，也不等全部搜完。
    const pushResults = () => {
      const sorted = acc.slice().sort((a, b) => rankOf(a, kw) - rankOf(b, kw));
      if (session && session.kw === kw) session.results = sorted;
      if (aliveRef.current && myRun === runIdRef.current) setResults(sorted);
    };

    // 进度单独节流：每 4 个源刷新一次，避免几百次 setState 堵住 JS 线程
    const pushStat = (force = false) => {
      if (!force && finished - lastStatAt < 4) return;
      lastStatAt = finished;
      const next = { done: finished, total: usable.length, hit, skipped };
      if (session && session.kw === kw) session.stat = next;
      if (aliveRef.current && myRun === runIdRef.current) setStat(next);
    };

    const worker = async () => {
      for (;;) {
        if (cancelRef.current || myRun !== runIdRef.current) return;
        const s = queue.shift();
        if (!s) return;

        let items: SearchBook[] = [];
        try {
          items = await withTimeout(
            search(s, kw, 1, PER_SOURCE_TIMEOUT),
            PER_SOURCE_TIMEOUT
          );
        } catch {
          items = []; // 单源失败（超时/404/规则不匹配）不该影响整批
        }
        finished++;

        let added = 0;
        if (items.length) {
          hit++;
          hitIds.push(s.bookSourceUrl);
          for (const it of items) {
            const k = it.sourceId + '|' + it.bookUrl;
            if (!seen.has(k)) {
              seen.add(k);
              acc.push(it);
              added++;
            }
          }
        }
        if (added) pushResults();
        pushStat();
      }
    };

    const n = Math.min(CONCURRENCY, usable.length);
    await Promise.all(Array.from({ length: n }, () => worker()));

    if (myRun !== runIdRef.current) return;

    pushResults();
    pushStat(true);
    if (aliveRef.current) {
      setLoading(false);
      setDone(true);
    }
    if (session && session.kw === kw) session.done = true;

    // 记住这次出过结果的源，下次搜索优先跑它们
    if (hitIds.length) useStore.getState().bumpSourceHits(hitIds);
  };

  const onSearch = () => runSearch(key);

  const stop = () => {
    cancelRef.current = true;
    setLoading(false);
    setDone(true);
    if (session) session.done = true;
  };

  useEffect(() => {
    aliveRef.current = true;
    // 上次没搜完就离开了页面，回来自动接着搜
    if (session && session.kw && !session.done) {
      runSearch(session.kw);
    }
    return () => {
      aliveRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 同一本书在几十个源里各出一条，这里按「书名 + 作者」归并成一本一行，
  // 各源的条目挂在 items 上，详情页里可以直接换源
  const groups = useMemo(() => groupBooks(results), [results]);

  const renderItem = ({ item }: { item: BookGroup }) => {
    const first = item.items[0];
    const n = item.items.length;
    return (
      <TouchableOpacity
        style={styles.item}
        onPress={() =>
          navigation.navigate('BookDetail', {
            bookUrl: first.bookUrl,
            sourceId: first.sourceId,
            name: item.name,
            author: item.author,
            coverUrl: item.coverUrl,
            intro: first.intro,
            lastChapter: first.lastChapter,
            alts: item.items,
          })
        }
      >
        <BookCover uri={item.coverUrl} name={item.name} width={64} height={88} />
        <View style={styles.meta}>
          <Text style={styles.name} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.author} numberOfLines={1}>
            {item.author || '未知'}
          </Text>
          <Text style={styles.src} numberOfLines={1}>
            {n > 1 ? `${n} 个书源 · 点进去可换源` : first.sourceName}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const isEmpty = !loading && done && results.length === 0;

  return (
    <View style={styles.container}>
      {/* 搜索页是从书架推进来的独立页，带返回；TopBar 负责吃 top inset */}
      <TopBar title="搜索" onBack={() => navigation.goBack()} />
      <View style={styles.searchBar}>
        <TextInput
          style={styles.input}
          placeholder="输入书名 / 作者"
          placeholderTextColor={APP.sub}
          value={key}
          onChangeText={setKey}
          onSubmitEditing={onSearch}
          returnKeyType="search"
          autoCapitalize="none"
        />
        <TouchableOpacity style={styles.go} onPress={onSearch}>
          <Text style={styles.goText}>搜索</Text>
        </TouchableOpacity>
      </View>

      {/* 状态条：搜索中实时报进度，搜完报总数 */}
      {(loading || (done && stat.total > 0)) && (
        <View style={styles.statusBar}>
          {loading && <ActivityIndicator color={APP.accent} size="small" />}
          <Text style={styles.statusText} numberOfLines={1}>
            {loading
              ? `搜索中 ${stat.done}/${stat.total} · 已找到 ${groups.length} 本`
              : `共 ${groups.length} 本 · ${results.length} 条来源`}
            {stat.skipped > 0 ? ` · 跳过 ${stat.skipped} 个无搜索规则的源` : ''}
          </Text>
          {loading && (
            <TouchableOpacity
              onPress={stop}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.stopText}>停止</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {loading && results.length === 0 && (
        <View style={styles.center}>
          <ActivityIndicator color={APP.accent} size="large" />
          <Text style={styles.hint}>正在跨书源搜索…</Text>
          <Text style={styles.hintSub}>
            已返回 {stat.done}/{stat.total} 个源，哪个源先搜到就先显示
          </Text>
        </View>
      )}

      {isEmpty && (
        <View style={styles.center}>
          <Text style={styles.hint}>没有结果</Text>
          <Text style={styles.hintSub}>
            {stat.total === 0
              ? '启用的书源里没有一个带可用的搜索规则，去「书源」页检查一下'
              : '换个关键词，或减少启用书源后重试'}
          </Text>
        </View>
      )}

      <FlatList
        data={groups}
        keyExtractor={(i) => i.key}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: APP.bg },
  searchBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: APP.card,
    color: APP.text,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    borderWidth: 1,
    borderColor: APP.border,
  },
  go: {
    marginLeft: 10,
    backgroundColor: APP.accent,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  goText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  statusText: { flex: 1, color: APP.sub, fontSize: 12, marginLeft: 8 },
  stopText: { color: APP.accent, fontSize: 13, fontWeight: '600', marginLeft: 8 },
  center: { alignItems: 'center', marginTop: 56, paddingHorizontal: 40 },
  hint: { color: APP.text, fontSize: 15, marginTop: 12 },
  hintSub: { color: APP.sub, fontSize: 12, marginTop: 8, textAlign: 'center', lineHeight: 18 },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  item: {
    flexDirection: 'row',
    backgroundColor: APP.card,
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: APP.border,
  },
  meta: { flex: 1, marginLeft: 12, justifyContent: 'center' },
  name: { color: APP.text, fontSize: 16, fontWeight: '700' },
  author: { color: APP.sub, fontSize: 13, marginTop: 4 },
  src: { color: APP.sub, fontSize: 12, marginTop: 6 },
});
