import React, { useEffect, useState } from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useStore } from '../store/useStore';
import { getBookInfo, getToc } from '../engine/SourceEngine';
import { BookInfo, BookChapter } from '../engine/types';
import { BookCover } from '../components/BookCover';
import { TopBar } from '../components/TopBar';
import { APP } from '../theme/theme';
import { LOCAL_SOURCE_ID, getLocalChapters } from '../utils/localBook';
import { SourceSwitchSheet } from '../components/SourceSwitchSheet';
import { SearchBook } from '../engine/types';
import { Text } from '../components/AppText';

// 报错时把长链接裁短，否则 Alert 里糊成一片看不清
function shortUrl(u: string): string {
  const s = String(u || '');
  if (s.length <= 70) return s;
  return s.slice(0, 42) + '…' + s.slice(-24);
}

export function BookDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const {
    bookUrl,
    sourceId,
    name,
    author,
    coverUrl,
    intro,
    lastChapter,
    chapterIndex,
    pageIndex,
    alts, // 搜索结果里同名同作者的其他来源，有的话换源可以秒开
  } = route.params as any;

  const sources = useStore((s) => s.sources);
  const shelf = useStore((s) => s.shelf);
  const addToShelf = useStore((s) => s.addToShelf);
  const cacheChapters = useStore((s) => s.cacheChapters);
  const onShelf = shelf.some((x) => x.bookUrl === bookUrl && x.sourceId === sourceId);

  const [info, setInfo] = useState<BookInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [chapters, setChapters] = useState<BookChapter[]>([]);
  const [tocLoading, setTocLoading] = useState(false);
  const [tocErr, setTocErr] = useState('');
  const [showAllChapters, setShowAllChapters] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);

  useEffect(() => {
    let cancel = false;
    const load = async () => {
      if (sourceId === LOCAL_SOURCE_ID) {
        const ch = (await getLocalChapters(bookUrl)) as BookChapter[];
        if (!cancel) setChapters(ch);
        return;
      }
      const src = sources.find((s) => s.bookSourceUrl === sourceId);
      if (!src) return;
      setLoading(true);
      let tocUrl = bookUrl as string;
      try {
        const bi = await getBookInfo(src, bookUrl);
        if (!cancel && bi) setInfo(bi);
        tocUrl = ((bi && bi.tocUrl) || bookUrl) as string;
      } catch (e) {
        if (!cancel) setInfo(null);
      } finally {
        if (!cancel) setLoading(false);
      }
      if (cancel) return;

      // 详情页直接展示目录，用户先看得到章节目录再决定读不读
      setTocLoading(true);
      setTocErr('');
      try {
        const ch = await getToc(src, tocUrl, bookUrl);
        if (cancel) return;
        setChapters(ch);
        if (!ch.length) setTocErr('这个书源没解析出目录，换一个源试试');
      } catch (e: any) {
        if (!cancel) setTocErr(e?.message || '目录加载失败');
      } finally {
        if (!cancel) setTocLoading(false);
      }
    };
    load();
    return () => {
      cancel = true;
    };
  }, [bookUrl, sourceId]);

  // 阅读：只进阅读器，**不自动加书架**。要不要收藏由用户点「加入书架」决定。
  const openReader = (idx: number) => {
    if (!chapters.length) {
      Alert.alert('打不开', tocErr || '目录还没加载出来，稍等一下或换个书源');
      return;
    }
    const start = Math.min(Math.max(idx, 0), chapters.length - 1);
    navigation.navigate('Reader', {
      bookUrl,
      sourceId,
      name: displayName,
      author: displayAuthor,
      chapterIndex: start,
      pageIndex: 0,
      // 目录已经拉过了，直接带过去，省一次请求
      preloadedChapters: chapters,
      preloadedSourceId: sourceId,
      preloadedBookUrl: bookUrl,
    });
  };

  const addOnly = () => {
    if (onShelf) return;
    addToShelf({
      bookUrl,
      sourceId,
      name: displayName,
      author: displayAuthor,
      coverUrl: displayCover,
      intro: displayIntro,
      lastChapter: info?.lastChapter || lastChapter,
      addedAt: Date.now(),
      lastReadAt: Date.now(),
      lastChapterIndex: 0,
      lastReadPos: 0,
    });
    if (chapters.length) cacheChapters(bookUrl, sourceId, chapters);
  };

  // 换源 = 用新源的 bookUrl 重新加载这个详情页。replace 而不是 push，
  // 返回时不会一层层叠出好几个详情页。
  const onPickSource = (b: SearchBook) => {
    setSwitchOpen(false);
    navigation.replace('BookDetail', {
      bookUrl: b.bookUrl,
      sourceId: b.sourceId,
      name: b.name,
      author: b.author,
      coverUrl: b.coverUrl,
      intro: b.intro,
      lastChapter: b.lastChapter,
      alts,
    });
  };

  const displayName = info?.name || name;
  const displayAuthor = info?.author || author;
  const displayIntro = info?.intro || intro;
  const displayCover = info?.coverUrl || coverUrl;

  return (
    <View style={styles.container}>
      <TopBar title="书籍详情" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.head}>
          <BookCover uri={displayCover} name={displayName} width={110} height={154} />
          <View style={styles.headMeta}>
            <Text style={styles.title} numberOfLines={3}>
              {displayName}
            </Text>
            <Text style={styles.line}>{displayAuthor}</Text>
            {info?.kind ? <Text style={styles.line}>{info.kind}</Text> : null}
            {info?.wordCount ? (
              <Text style={styles.line}>{info.wordCount} 字</Text>
            ) : null}
            {info?.lastChapter ? (
              <Text style={styles.line} numberOfLines={1}>
                最新：{info.lastChapter}
              </Text>
            ) : null}
            <TouchableOpacity style={styles.switchBtn} onPress={() => setSwitchOpen(true)}>
              <Text style={styles.switchText}>
                换源{alts && alts.length > 1 ? ` · ${alts.length} 个来源` : ''}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.section}>简介</Text>
        <Text style={styles.intro}>{displayIntro || '（无简介）'}</Text>

        {loading && (
          <View style={styles.loadWrap}>
            <ActivityIndicator color={APP.accent} />
            <Text style={styles.hint}>加载详情中…</Text>
          </View>
        )}

        {/* 目录：进页面就拉好，让用户先看清有多少章、能不能读 */}
        <Text style={styles.section}>
          目录{chapters.length ? ` · 共 ${chapters.length} 章` : ''}
        </Text>
        {tocLoading && (
          <View style={styles.tocLoading}>
            <ActivityIndicator color={APP.accent} size="small" />
            <Text style={styles.hint}>正在解析目录…</Text>
          </View>
        )}
        {!tocLoading && !!tocErr && (
          <Text style={styles.tocErr}>{tocErr}</Text>
        )}
        {!tocLoading &&
          (showAllChapters ? chapters : chapters.slice(0, 100)).map((c, i) => (
            <TouchableOpacity
              key={`${c.index}-${i}`}
              style={styles.chRow}
              onPress={() => openReader(i)}
            >
              <Text style={styles.chText} numberOfLines={1}>
                {c.name}
              </Text>
            </TouchableOpacity>
          ))}
        {!tocLoading && chapters.length > 100 && (
          <TouchableOpacity
            style={styles.moreBtn}
            onPress={() => setShowAllChapters((v) => !v)}
          >
            <Text style={styles.moreText}>
              {showAllChapters ? '收起' : `展开全部 ${chapters.length} 章`}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.shelfBtn, onShelf && styles.shelfBtnOn]}
          onPress={addOnly}
          disabled={onShelf}
        >
          <Text style={[styles.shelfText, onShelf && styles.shelfTextOn]}>
            {onShelf ? '✓ 已在书架' : '＋ 加入书架'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.readBtn, !chapters.length && { opacity: 0.5 }]}
          onPress={() => openReader(chapterIndex || 0)}
          disabled={!chapters.length}
        >
          <Text style={styles.readText}>开始阅读</Text>
        </TouchableOpacity>
      </View>

      <SourceSwitchSheet
        visible={switchOpen}
        name={displayName}
        author={displayAuthor}
        currentSourceId={sourceId}
        presets={alts}
        onClose={() => setSwitchOpen(false)}
        onPick={onPickSource}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: APP.bg },
  body: { padding: 16, paddingBottom: 20 },
  head: { flexDirection: 'row' },
  headMeta: { flex: 1, marginLeft: 16 },
  title: { color: APP.text, fontSize: 20, fontWeight: '800' },
  line: { color: APP.sub, fontSize: 14, marginTop: 6 },
  section: {
    color: APP.text,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 22,
    marginBottom: 8,
  },
  intro: { color: APP.sub, fontSize: 14, lineHeight: 22 },
  loadWrap: { alignItems: 'center', marginTop: 20 },
  hint: { color: APP.sub, fontSize: 14, marginTop: 8 },
  bottomBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 8,
    backgroundColor: APP.bg,
    borderTopWidth: 1,
    borderColor: APP.border,
  },
  shelfBtn: {
    flex: 1,
    marginRight: 8,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: APP.card,
    borderWidth: 1,
    borderColor: APP.border,
  },
  shelfBtnOn: { backgroundColor: APP.card2 },
  shelfText: { color: APP.text, fontSize: 16, fontWeight: '700' },
  shelfTextOn: { color: APP.sub },
  readBtn: {
    flex: 1.4,
    backgroundColor: APP.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  tocLoading: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  tocErr: { color: APP.danger, fontSize: 13, lineHeight: 19, marginTop: 4 },
  chRow: { paddingVertical: 10, borderBottomWidth: 1, borderColor: APP.border },
  chText: { color: APP.text, fontSize: 14 },
  moreBtn: { alignItems: 'center', paddingVertical: 12 },
  moreText: { color: APP.accent, fontSize: 14, fontWeight: '600' },
  readText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  switchBtn: {
    marginTop: 12,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: APP.card2,
    borderWidth: 1,
    borderColor: APP.border,
  },
  switchText: { color: APP.accent, fontSize: 13, fontWeight: '700' },
});
