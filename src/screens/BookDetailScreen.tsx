import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useStore } from '../store/useStore';
import { getBookInfo, getToc } from '../engine/SourceEngine';
import { BookInfo, BookChapter } from '../engine/types';
import { BookCover } from '../components/BookCover';
import { TopBar } from '../components/TopBar';
import { APP } from '../theme/theme';
import { LOCAL_SOURCE_ID, getLocalChapters } from '../utils/localBook';

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
  } = route.params as any;

  const sources = useStore((s) => s.sources);
  const addToShelf = useStore((s) => s.addToShelf);
  const cacheChapters = useStore((s) => s.cacheChapters);

  const [info, setInfo] = useState<BookInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [localChapters, setLocalChapters] = useState<BookChapter[] | null>(null);

  useEffect(() => {
    let cancel = false;
    const load = async () => {
      if (sourceId === LOCAL_SOURCE_ID) {
        const ch = (await getLocalChapters(bookUrl)) as BookChapter[];
        if (!cancel) setLocalChapters(ch);
        return;
      }
      const src = sources.find((s) => s.bookSourceUrl === sourceId);
      if (!src) return;
      setLoading(true);
      try {
        const bi = await getBookInfo(src, bookUrl);
        if (!cancel && bi) setInfo(bi);
      } catch (e) {
        if (!cancel) setInfo(null);
      } finally {
        if (!cancel) setLoading(false);
      }
    };
    load();
    return () => {
      cancel = true;
    };
  }, [bookUrl, sourceId]);

  const startRead = async () => {
    try {
      let chapters: BookChapter[];
      if (sourceId === LOCAL_SOURCE_ID) {
        chapters = (await getLocalChapters(bookUrl)) as BookChapter[];
      } else {
        const src = sources.find((s) => s.bookSourceUrl === sourceId);
        if (!src) throw new Error('未找到对应书源');
        const tocUrl = (info?.tocUrl || bookUrl) as string;
        chapters = await getToc(src, tocUrl);
        if (chapters.length === 0) throw new Error('未解析到章节目录');
        cacheChapters(bookUrl, sourceId, chapters);
      }
      addToShelf({
        bookUrl,
        sourceId,
        name: info?.name || name,
        author: info?.author || author,
        coverUrl: info?.coverUrl || coverUrl,
        intro: info?.intro || intro,
        lastChapter: info?.lastChapter || lastChapter,
        addedAt: Date.now(),
        lastReadAt: Date.now(),
        lastChapterIndex: 0,
        lastReadPos: 0,
      });
      navigation.navigate('Reader', {
        bookUrl,
        sourceId,
        name: info?.name || name,
        author: info?.author || author,
        chapterIndex: chapterIndex || 0,
        pageIndex: pageIndex || 0,
      });
    } catch (e: any) {
      Alert.alert('打开失败', e?.message || String(e));
    }
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
          </View>
        </View>

        <Text style={styles.section}>简介</Text>
        <Text style={styles.intro}>{displayIntro || '（无简介）'}</Text>

        {localChapters && (
          <Text style={styles.section}>目录 · 共 {localChapters.length} 章</Text>
        )}
        {loading && (
          <View style={styles.loadWrap}>
            <ActivityIndicator color={APP.accent} />
            <Text style={styles.hint}>加载详情中…</Text>
          </View>
        )}
      </ScrollView>

      <TouchableOpacity style={styles.readBtn} onPress={startRead}>
        <Text style={styles.readText}>加入书架并开始阅读</Text>
      </TouchableOpacity>
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
  readBtn: {
    backgroundColor: APP.accent,
    margin: 16,
    marginTop: 0,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  readText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
