import React, { useEffect, useState, useRef, useMemo } from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, FlatList, Alert, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useStore } from '../store/useStore';
import { getBookInfo, getContent, getToc } from '../engine/SourceEngine';
import { BookChapter } from '../engine/types';
import { TopBar } from '../components/TopBar';
import { PageCurlView } from '../components/PageCurlView';
import { APP, READER_THEMES } from '../theme/theme';
import {
  LOCAL_SOURCE_ID,
  getLocalChapters,
  getLocalChapterText,
} from '../utils/localBook';
import { paginate } from '../utils/paginate';
import { SourceSwitchSheet } from '../components/SourceSwitchSheet';
import { SearchBook } from '../engine/types';
import { matchChapterIndex } from '../utils/bookMatch';
import {
  pageTextHeight,
  pageTextWidth,
  PAGE_PAD_BOTTOM,
  PAGE_PAD_H,
  PAGE_PAD_TOP,
} from '../theme/layout';
import { Text } from '../components/AppText';

const THEME_KEYS = ['day', 'night', 'green', 'paper'] as const;

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: PAGE_PAD_H,
    paddingTop: PAGE_PAD_TOP,
    paddingBottom: PAGE_PAD_BOTTOM,
  },
  text: { fontSize: 18 },
  bottom: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    paddingVertical: 10,
  },
  bBtn: { flex: 1, alignItems: 'center' },
  bText: { fontSize: 14, fontWeight: '600' },
  drawerMask: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  drawer: {
    height: '70%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
  },
  drawerHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  drawerTitle: { color: APP.text, fontSize: 16, fontWeight: '700' },
  chItem: { paddingVertical: 12, borderBottomWidth: 1, borderColor: APP.border },
  chActive: { backgroundColor: APP.card2 },
  chText: { color: APP.text, fontSize: 14 },
  menu: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 80,
    borderRadius: 14,
    padding: 18,
  },
  menuTitle: { color: APP.text, fontSize: 16, fontWeight: '700', marginBottom: 12 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  menuLabel: { color: APP.text, fontSize: 15 },
  menuVal: { fontSize: 15 },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  step: {
    backgroundColor: APP.card2,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  stepText: { color: APP.text, fontSize: 15, fontWeight: '700' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderColor: APP.border,
  },
  switchSub: { color: APP.sub, fontSize: 11, marginTop: 3 },
  switchGo: { color: APP.accent, fontSize: 14, fontWeight: '700' },
  themes: { flexDirection: 'row' },
  themeDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    marginLeft: 10,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  themeActive: { borderColor: APP.accent },
});

export function ReaderScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const routeParams = route.params as any;
  const { chapterIndex, pageIndex: routePageIndex } = routeParams;

  // 书籍标识放进 state：换源时要整体切走，如果还是从路由参数里取就换不了。
  // 下面仍然解构成同名变量，其余代码一行不用改。
  const [book, setBook] = useState({
    bookUrl: routeParams.bookUrl as string,
    sourceId: routeParams.sourceId as string,
    name: (routeParams.name || '') as string,
    author: (routeParams.author || '') as string,
  });
  const { bookUrl, sourceId, name, author } = book;

  const sources = useStore((s) => s.sources);
  const shelf = useStore((s) => s.shelf);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const updateProgress = useStore((s) => s.updateProgress);
  const cacheChapters = useStore((s) => s.cacheChapters);
  const addToShelf = useStore((s) => s.addToShelf);
  const removeFromShelf = useStore((s) => s.removeFromShelf);

  const theme = READER_THEMES[settings.theme];
  const isPaged = settings.pageMode !== 'scroll';

  const [chapters, setChapters] = useState<BookChapter[]>([]);
  const [index, setIndex] = useState<number>(chapterIndex || 0);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  // 详情页已经把目录拉过了，直接带过来，省一次请求（只对初始这本书有效，换源后要重拉）
  const preloadRef = useRef<BookChapter[] | null>(
    routeParams.preloadedChapters &&
      routeParams.preloadedSourceId === routeParams.sourceId &&
      routeParams.preloadedBookUrl === routeParams.bookUrl
      ? (routeParams.preloadedChapters as BookChapter[])
      : null
  );
  // 换源后要跳到「同一章」，先把当前章节名记下来，等新目录到了再匹配
  const pendingChapterTitle = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // 顶/底工具栏显隐。点屏幕中间切换，方便沉浸阅读。
  // 用透明度而不是条件渲染：工具栏仍然占位，分页不会因为显隐而重排跳页。
  const [barsVisible, setBarsVisible] = useState(true);
  const barsOpacity = useRef(new Animated.Value(1)).current;
  const toggleBars = () => {
    const next = !barsVisible;
    setBarsVisible(next);
    Animated.timing(barsOpacity, {
      toValue: next ? 1 : 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  };
  // 滚动模式没有分页手势，靠自己判定「轻点」：位移 < 12pt 且时长 < 350ms
  const touchRef = useRef({ x: 0, y: 0, t: 0 });
  const onTouchStart = (e: any) => {
    const n = e.nativeEvent;
    touchRef.current = { x: n.pageX, y: n.pageY, t: Date.now() };
  };
  const onTouchEnd = (e: any) => {
    const n = e.nativeEvent;
    const d = touchRef.current;
    if (
      Date.now() - d.t < 350 &&
      Math.abs(n.pageX - d.x) < 12 &&
      Math.abs(n.pageY - d.y) < 12
    ) {
      toggleBars();
    }
  };

  // 分页翻页相关
  // 初始页：分页模式直接用保存的页号；滚动模式由下方 scroll 恢复逻辑处理（百分比）
  const [pageIndex, setPageIndex] = useState<number>(
    isPaged ? routePageIndex || 0 : 0
  );
  const [area, setArea] = useState({ w: 0, h: 0 });
  const pendingPageIndex = useRef<number | null>(null); // -1 表示定位到本章末页
  // 滚动模式：保存的阅读进度是 0~1000 的百分比，首次进入时恢复到该位置
  const scrollRestoreFrac = useRef<number | null>(
    isPaged ? null : Math.min((routePageIndex || 0) / 1000, 1)
  );
  const [scrollContentH, setScrollContentH] = useState(0);
  const [scrollViewH, setScrollViewH] = useState(0);

  const shelfBook = shelf.find(
    (s) => s.bookUrl === bookUrl && s.sourceId === sourceId
  );
  const onShelf = !!shelfBook;

  // 阅读界面里直接收藏。已经在书架上的再点就是移出（会二次确认，进度一起清掉）
  const toggleShelf = () => {
    if (onShelf) {
      Alert.alert('移出书架', `把《${name}》移出书架？阅读进度也会一起清掉。`, [
        { text: '取消', style: 'cancel' },
        {
          text: '移出',
          style: 'destructive',
          onPress: () => removeFromShelf(bookUrl, sourceId),
        },
      ]);
      return;
    }
    addToShelf({
      bookUrl,
      sourceId,
      name,
      author,
      lastChapter: chapters[chapters.length - 1]?.name,
      addedAt: Date.now(),
      lastReadAt: Date.now(),
      lastChapterIndex: index,
      lastReadPos: 0,
    });
    if (chapters.length) cacheChapters(bookUrl, sourceId, chapters);
    // addToShelf 内部把进度写成 0，这里补回当前正在看的章节
    updateProgress(bookUrl, sourceId, index, pageIndex);
  };

  // 加载目录
  useEffect(() => {
    let cancel = false;
    const load = async () => {
      const applyList = (ch: BookChapter[]) => {
        if (cancel) return;
        setChapters(ch);
        // 换源后按章节名对齐：先精确匹配，再退一步去掉「第X章」前缀比
        const want = pendingChapterTitle.current;
        if (want && ch.length) {
          pendingChapterTitle.current = null;
          const mi = matchChapterIndex(ch, want);
          if (mi >= 0) {
            setIndex(mi);
            setPageIndex(0);
          }
        }
      };

      if (preloadRef.current) {
        const ch = preloadRef.current;
        preloadRef.current = null;
        applyList(ch);
        return;
      }

      if (sourceId === LOCAL_SOURCE_ID) {
        const ch = (await getLocalChapters(bookUrl)) as BookChapter[];
        applyList(ch);
        return;
      }
      const cached = shelfBook?.cachedChapters;
      if (cached && cached.length) {
        applyList(cached);
        return;
      }
      const src = sources.find((s) => s.bookSourceUrl === sourceId);
      if (!src) return;
      const bi = await getBookInfo(src, bookUrl).catch(() => null);
      const tocUrl = (bi?.tocUrl || bookUrl) as string;
      const ch = await getToc(src, tocUrl, bookUrl);
      applyList(ch);
      if (!cancel && ch.length) cacheChapters(bookUrl, sourceId, ch);
    };
    load();
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookUrl, sourceId]);

  // 加载正文
  useEffect(() => {
    let cancel = false;
    const loadContent = async () => {
      setLoading(true);
      try {
        let text = '';
        if (sourceId === LOCAL_SOURCE_ID) {
          text = await getLocalChapterText(bookUrl, index);
        } else {
          const src = sources.find((s) => s.bookSourceUrl === sourceId);
          const ch = chapters[index];
          if (!src || !ch) {
            if (!cancel) setContent('');
            return;
          }
          const res = await getContent(src, ch.url);
          text = res.content;
        }
        // 应用全局替换净化
        for (const r of settings.replaceRules) {
          try {
            text = text.replace(new RegExp(r.pattern, 'g'), r.replacement);
          } catch {
            /* ignore bad regex */
          }
        }
        if (!cancel) {
          setContent(text || '（本章内容为空）');
          // 注意：不要在此把进度清零，否则会覆盖已保存的页码/滚动位置。
          // 分页模式的进度由下方 pages 定位逻辑统一持久化；滚动模式由 onMomentumScrollEnd 处理。
          scrollRef.current?.scrollTo({ y: 0, animated: false });
        }
      } catch (e: any) {
        if (!cancel) setContent('加载失败：' + (e?.message || e));
      } finally {
        if (!cancel) setLoading(false);
      }
    };
    loadContent();
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, chapters.length]);

  // 分页（仅非滚动模式）
  const pages = useMemo(() => {
    if (!isPaged || !area.w || !area.h) return [];
    return paginate(content, {
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight,
      width: pageTextWidth(area.w),
      height: pageTextHeight(area.h),
    });
    // 换字体后行高和字宽都会变，必须重新分页，否则每页行数对不上
  }, [content, area.w, area.h, settings.fontSize, settings.lineHeight, settings.fontId, isPaged]);

  // 章节内容/排版变化后，按 pending 定位当前页（翻章时跳到首/末页），并持久化进度
  useEffect(() => {
    if (!pages.length) return;
    let t: number;
    if (pendingPageIndex.current !== null) {
      t =
        pendingPageIndex.current === -1
          ? pages.length - 1
          : pendingPageIndex.current;
      pendingPageIndex.current = null;
    } else {
      t = pageIndex;
    }
    t = Math.min(Math.max(t, 0), Math.max(0, pages.length - 1));
    setPageIndex(t);
    updateProgress(bookUrl, sourceId, index, t);
  }, [pages, pageIndex, index, bookUrl, sourceId, updateProgress]);

  const goPrev = () => {
    if (index > 0) setIndex(index - 1);
  };
  const goNext = () => {
    if (index < chapters.length - 1) setIndex(index + 1);
  };

  // 换源：记下当前章节名 → 切书源 → 新目录到了自动跳到同一章
  const onPickSource = (b: SearchBook) => {
    setSwitchOpen(false);
    if (b.sourceId === sourceId && b.bookUrl === bookUrl) return;
    pendingChapterTitle.current = chapters[index]?.name || null;
    setPageIndex(0);
    setContent('');
    setChapters([]);

    // 书架里的书跟着迁移，否则从书架再点进来还是旧源、进度也对不上
    if (shelfBook) {
      removeFromShelf(shelfBook.bookUrl, shelfBook.sourceId);
      addToShelf({
        bookUrl: b.bookUrl,
        sourceId: b.sourceId,
        name: b.name || shelfBook.name,
        author: b.author || shelfBook.author,
        coverUrl: b.coverUrl || shelfBook.coverUrl,
        intro: b.intro || shelfBook.intro,
        lastChapter: b.lastChapter || shelfBook.lastChapter,
        addedAt: shelfBook.addedAt,
        lastReadAt: Date.now(),
        lastChapterIndex: 0,
        lastReadPos: 0,
      });
    }

    setBook({
      bookUrl: b.bookUrl,
      sourceId: b.sourceId,
      name: b.name || name,
      author: b.author || author,
    });
  };

  const savePageProgress = (pi: number) => {
    updateProgress(bookUrl, sourceId, index, pi);
  };

  // 分页模式下：优先页内翻，到章边界再翻章
  const handlePrev = () => {
    if (!isPaged) return goPrev();
    if (pageIndex > 0) {
      const ni = pageIndex - 1;
      setPageIndex(ni);
      savePageProgress(ni);
      return;
    }
    if (index > 0) {
      pendingPageIndex.current = -1; // 跳到上一章末页
      setIndex(index - 1);
    }
  };
  const handleNext = () => {
    if (!isPaged) return goNext();
    if (pageIndex < pages.length - 1) {
      const ni = pageIndex + 1;
      setPageIndex(ni);
      savePageProgress(ni);
      return;
    }
    if (index < chapters.length - 1) {
      pendingPageIndex.current = 0; // 跳到下一章首页
      setIndex(index + 1);
    }
  };

  // 滚动模式：首次加载正文后，根据保存的百分比恢复阅读位置
  useEffect(() => {
    if (isPaged || scrollRestoreFrac.current == null) return;
    if (scrollContentH > 0 && scrollViewH > 0) {
      const y = scrollRestoreFrac.current * Math.max(0, scrollContentH - scrollViewH);
      scrollRef.current?.scrollTo({ y, animated: false });
      scrollRestoreFrac.current = null;
    }
  }, [scrollContentH, scrollViewH, isPaged]);

  const curChapter = chapters[index];

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <Animated.View
        style={{ opacity: barsOpacity }}
        pointerEvents={barsVisible ? 'auto' : 'none'}
      >
        <TopBar
          title={curChapter?.name || name}
          onBack={() => navigation.goBack()}
          backgroundColor={theme.bg}
          textColor={theme.text}
          darkText={settings.theme !== 'night'}
          right={
            <TouchableOpacity
              onPress={toggleShelf}
              hitSlop={{ top: 12, bottom: 12, left: 14, right: 14 }}
            >
              <Text
                style={{
                  fontSize: 22,
                  color: onShelf ? theme.sub : theme.text,
                }}
              >
                {onShelf ? '★' : '☆'}
              </Text>
            </TouchableOpacity>
          }
        />
      </Animated.View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.sub} />
        </View>
      ) : isPaged ? (
        <View style={{ flex: 1 }}>
          <SafeAreaView
            style={{ flex: 1 }}
            edges={['left', 'right', 'bottom']}
            onLayout={(e) => {
              const { width, height } = e.nativeEvent.layout;
              setArea((a) =>
                a.w === width && a.h === height ? a : { w: width, h: height }
              );
            }}
          >
            {area.w > 0 ? (
              <PageCurlView
                pages={pages}
                index={pageIndex}
                onPageChange={(i) => {
                  setPageIndex(i);
                  savePageProgress(i);
                }}
                canPrev={pageIndex > 0}
                canNext={pageIndex < pages.length - 1}
                mode={settings.pageMode === 'slide' ? 'slide' : 'simulate'}
                theme={theme}
                fontSize={settings.fontSize}
                lineHeight={settings.lineHeight}
                areaW={area.w}
                areaH={area.h}
                onTapLeft={handlePrev}
                onTapRight={handleNext}
                onTapCenter={toggleBars}
              />
            ) : (
              <View style={styles.center}>
                <ActivityIndicator color={theme.sub} />
              </View>
            )}
          </SafeAreaView>
        </View>
      ) : (
        <View
          style={{ flex: 1 }}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={styles.content}
            onContentSizeChange={(_, h) => setScrollContentH(h)}
            onLayout={(e) => setScrollViewH(e.nativeEvent.layout.height)}
            onMomentumScrollEnd={(e) => {
              const y = e.nativeEvent.contentOffset.y;
              const h = e.nativeEvent.contentSize.height;
              const pos = Math.round((y / Math.max(h, 1)) * 1000);
              updateProgress(bookUrl, sourceId, index, pos);
            }}
          >
            <Text
              style={[
                styles.text,
                {
                  color: theme.text,
                  fontSize: settings.fontSize,
                  lineHeight: settings.fontSize * settings.lineHeight,
                },
              ]}
            >
              {content}
            </Text>
          </ScrollView>
        </View>
      )}

      {/* 底部工具栏 */}
      <Animated.View
        style={{ opacity: barsOpacity }}
        pointerEvents={barsVisible ? 'auto' : 'none'}
      >
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: theme.barBg }}>
          <View style={[styles.bottom, { backgroundColor: theme.barBg }]}>
            <TouchableOpacity style={styles.bBtn} onPress={handlePrev}>
              <Text style={[styles.bText, { color: theme.barText }]}>
                {isPaged ? '上一页' : '上一章'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.bBtn} onPress={() => setTocOpen(true)}>
              <Text style={[styles.bText, { color: theme.barText }]}>目录</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.bBtn} onPress={() => setMenuOpen(true)}>
              <Text style={[styles.bText, { color: theme.barText }]}>设置</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.bBtn} onPress={handleNext}>
              <Text style={[styles.bText, { color: theme.barText }]}>
                {isPaged ? '下一页' : '下一章'}
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Animated.View>

      {/* 目录抽屉 */}
      <Modal visible={tocOpen} transparent animationType="slide">
        <View style={styles.drawerMask}>
          <View style={[styles.drawer, { backgroundColor: APP.card }]}>
            <View style={styles.drawerHead}>
              <Text style={styles.drawerTitle}>
                目录 · 共 {chapters.length} 章
              </Text>
              <TouchableOpacity onPress={() => setTocOpen(false)}>
                <Text style={{ color: APP.accent }}>关闭</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={chapters}
              keyExtractor={(i) => String(i.index)}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.chItem,
                    item.index === index && styles.chActive,
                  ]}
                  onPress={() => {
                    pendingPageIndex.current = 0; // 跳到目标章首页
                    setIndex(item.index);
                    setTocOpen(false);
                  }}
                >
                  <Text
                    style={[
                      styles.chText,
                      item.index === index && { color: APP.accent },
                    ]}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      <SourceSwitchSheet
        visible={switchOpen}
        name={name}
        author={author}
        currentSourceId={sourceId}
        onClose={() => setSwitchOpen(false)}
        onPick={onPickSource}
      />

      {/* 阅读设置 */}
      <Modal visible={menuOpen} transparent animationType="fade">
        <TouchableOpacity
          style={styles.drawerMask}
          activeOpacity={1}
          onPress={() => setMenuOpen(false)}
        >
          <View style={[styles.menu, { backgroundColor: APP.card }]}>
            <Text style={styles.menuTitle}>阅读设置</Text>
            <TouchableOpacity
              style={styles.switchRow}
              onPress={() => {
                setMenuOpen(false);
                setSwitchOpen(true);
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.menuLabel}>换源</Text>
                <Text style={styles.switchSub} numberOfLines={1}>
                  当前：{sources.find((x) => x.bookSourceUrl === sourceId)?.bookSourceName || '未知书源'}
                </Text>
              </View>
              <Text style={styles.switchGo}>切换</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.switchRow} onPress={toggleShelf}>
              <View style={{ flex: 1 }}>
                <Text style={styles.menuLabel}>{onShelf ? '移出书架' : '加入书架'}</Text>
                <Text style={styles.switchSub} numberOfLines={1}>
                  {onShelf ? '这本书已经在书架里了' : '把这本书收藏到书架，方便下次接着看'}
                </Text>
              </View>
              <Text style={[styles.switchGo, onShelf && { color: APP.danger }]}>
                {onShelf ? '移出' : '＋ 添加'}
              </Text>
            </TouchableOpacity>
            <View style={styles.row}>
              <Text style={styles.menuLabel}>字号</Text>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={styles.step}
                  onPress={() =>
                    updateSettings({
                      fontSize: Math.max(12, settings.fontSize - 1),
                    })
                  }
                >
                  <Text style={styles.stepText}>A-</Text>
                </TouchableOpacity>
                <Text style={[styles.menuVal, { color: APP.text }]}>
                  {settings.fontSize}
                </Text>
                <TouchableOpacity
                  style={styles.step}
                  onPress={() =>
                    updateSettings({
                      fontSize: Math.min(30, settings.fontSize + 1),
                    })
                  }
                >
                  <Text style={styles.stepText}>A+</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.row}>
              <Text style={styles.menuLabel}>行距</Text>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={styles.step}
                  onPress={() =>
                    updateSettings({
                      lineHeight: Math.max(
                        1.2,
                        +(settings.lineHeight - 0.1).toFixed(1)
                      ),
                    })
                  }
                >
                  <Text style={styles.stepText}>－</Text>
                </TouchableOpacity>
                <Text style={[styles.menuVal, { color: APP.text }]}>
                  {settings.lineHeight.toFixed(1)}
                </Text>
                <TouchableOpacity
                  style={styles.step}
                  onPress={() =>
                    updateSettings({
                      lineHeight: Math.min(
                        2.5,
                        +(settings.lineHeight + 0.1).toFixed(1)
                      ),
                    })
                  }
                >
                  <Text style={styles.stepText}>＋</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.row}>
              <Text style={styles.menuLabel}>主题</Text>
              <View style={styles.themes}>
                {THEME_KEYS.map((k) => (
                  <TouchableOpacity
                    key={k}
                    style={[
                      styles.themeDot,
                      { backgroundColor: READER_THEMES[k].bg },
                      settings.theme === k && styles.themeActive,
                    ]}
                    onPress={() => updateSettings({ theme: k })}
                  />
                ))}
              </View>
            </View>
            <View style={styles.row}>
              <Text style={styles.menuLabel}>翻页模式</Text>
              <TouchableOpacity
                onPress={() => {
                  setMenuOpen(false);
                  const opts: { text: string; mode: any }[] = [
                    { text: '滚动', mode: 'scroll' },
                    { text: '仿真', mode: 'simulate' },
                    { text: '滑动', mode: 'slide' },
                  ];
                  Alert.alert(
                    '翻页模式',
                    '仿真 = 书页卷曲翻页；滑动 = 整页左右切换；滚动 = 连续滚动。',
                    [
                      ...opts.map((o) => ({
                        text:
                          settings.pageMode === o.mode
                            ? `✓ ${o.text}`
                            : o.text,
                        onPress: () => updateSettings({ pageMode: o.mode }),
                      })),
                      { text: '取消', style: 'cancel' as const },
                    ]
                  );
                }}
              >
                <Text style={[styles.menuVal, { color: APP.accent }]}>
                  {pageLabel(settings.pageMode)} ›
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function pageLabel(k: string) {
  return (
    { scroll: '滚动', cover: '覆盖', simulate: '仿真', slide: '滑动' }[k] || k
  );
}
