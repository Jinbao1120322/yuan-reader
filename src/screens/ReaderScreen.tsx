import React, { useEffect, useState, useRef, useMemo } from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, FlatList, Alert, Animated } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Battery from 'expo-battery';
import { bookKey, useStore } from '../store/useStore';
import {
  clearTocCache,
  loadTocCache,
  saveTocCache,
  TOC_TTL,
} from '../store/tocCache';
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
import { trimPageEdges, typeset } from '../utils/typeset';
import { SourceSwitchSheet } from '../components/SourceSwitchSheet';
import { SearchBook } from '../engine/types';
import { matchChapterIndex } from '../utils/bookMatch';
import { useAppFont } from '../components/AppText';
import {
  PAGE_FOOTER_H,
  PAGE_HEADER_H,
  PAGE_PAD_BOTTOM,
  PAGE_PAD_H,
  PAGE_PAD_TOP,
  pageTextHeight,
  pageTextWidth,
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
  presetBtn: {
    backgroundColor: APP.accent,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 4,
  },
  presetText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  switchPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: APP.card2,
    borderWidth: 1,
    borderColor: APP.border,
  },
  switchPillOn: { backgroundColor: APP.accent, borderColor: APP.accent },
  switchPillText: { color: APP.sub, fontSize: 13, fontWeight: '600' },
  switchPillTextOn: { color: '#fff' },
  pageHeader: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: PAGE_HEADER_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: PAGE_PAD_H,
  },
  pageFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: PAGE_FOOTER_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: PAGE_PAD_H,
  },
  pageMeta: { fontSize: 10.5, flexShrink: 1 },
  pageMetaRight: { marginLeft: 12, textAlign: 'right' },
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
  // 实测「一行能放几个字」。字体不同字宽差很多，靠估算必然失准
  // （换自定义字体后估 17 字、实际只放得下 16 字，每行最后一个字被挤到下一行单独成行）。
  const [charsPerLine, setCharsPerLine] = useState(0);
  // 排版后的正文：段首缩进 + 段落留白。
  // 测量层和渲染层都用这一份，否则分页会按一种文本算、显示另一种。
  const displayText = useMemo(
    () =>
      typeset(content, {
        indent: settings.paraIndent !== false,
        paraGap: settings.paraGap ?? 0,
      }),
    [content, settings.paraIndent, settings.paraGap]
  );

  // 真实排版测量出的每一行（y/height 由原生排版给出）。
  // 用它切页才能把页面排满 —— 按「能放几行」估算永远会低估，底部就空一块。
  const [measuredLines, setMeasuredLines] = useState<
    { text: string; y: number; h: number }[]
  >([]);
  // 手动刷新目录时 +1，用来强制重新走一次加载
  const [tocTick, setTocTick] = useState(0);

  // 页脚右下角的电量
  const [battery, setBattery] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    Battery.getBatteryLevelAsync()
      .then((v) => {
        if (alive) setBattery(v);
      })
      .catch(() => {});
    let sub: any = null;
    try {
      sub = Battery.addBatteryLevelListener(({ batteryLevel }) => setBattery(batteryLevel));
    } catch {
      /* 个别环境不支持订阅，静态读一次就够 */
    }
    return () => {
      alive = false;
      try {
        sub && sub.remove();
      } catch {
        /* ignore */
      }
    };
  }, []);
  const appFont = useAppFont();
  // 页眉页脚是绝对定位的，绝对定位不认父容器的安全区 padding，
  // 必须自己把安全区高度加上，否则会被状态栏/灵动岛和 home indicator 压住。
  const insets = useSafeAreaInsets();

  // zustand 的持久化是异步的（AsyncStorage）。首帧 shelf 还是空数组，
  // 这时候去找"有没有缓存目录"必然找不到 → 白白重拉一次。
  const [hydrated, setHydrated] = useState(() => {
    const p: any = (useStore as any).persist;
    return !p || typeof p.hasHydrated !== 'function' ? true : p.hasHydrated();
  });
  useEffect(() => {
    const p: any = (useStore as any).persist;
    if (!p || typeof p.hasHydrated !== 'function') {
      setHydrated(true);
      return;
    }
    if (p.hasHydrated()) {
      setHydrated(true);
      return;
    }
    const un = p.onFinishHydration?.(() => setHydrated(true));
    return () => {
      if (typeof un === 'function') un();
    };
  }, []);
  const pendingPageIndex = useRef<number | null>(null); // -1 表示定位到本章末页
  // 滚动模式：保存的阅读进度是 0~1000 的百分比，首次进入时恢复到该位置
  const scrollRestoreFrac = useRef<number | null>(
    isPaged ? null : Math.min((routePageIndex || 0) / 1000, 1)
  );
  const [scrollContentH, setScrollContentH] = useState(0);
  const [scrollViewH, setScrollViewH] = useState(0);

  const currentKey = bookKey(bookUrl, sourceId);
  const shelfBook = shelf.find(
    (s) => bookKey(s.bookUrl, s.sourceId) === currentKey
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
    // store 还没读完就别急着发请求，否则会当成"没有缓存"重拉一遍
    if (!hydrated) return;
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
      // ① 独立存储里的目录缓存（按书一个 key，不受主 store 体积影响）
      const tc = await loadTocCache(currentKey);
      if (tc && tc.chapters.length && Date.now() - tc.at < TOC_TTL) {
        applyList(tc.chapters);
        return;
      }

      // ② 主 store 里的旧缓存（老版本留下的），有就顺手搬到独立存储
      const cached = shelfBook?.cachedChapters;
      const fresh =
        cached &&
        cached.length > 0 &&
        (!shelfBook?.cachedAt || Date.now() - shelfBook.cachedAt < TOC_TTL);
      if (fresh) {
        applyList(cached as BookChapter[]);
        saveTocCache(currentKey, cached as BookChapter[]);
        return;
      }
      const src = sources.find((s) => s.bookSourceUrl === sourceId);
      if (!src) return;
      const bi = await getBookInfo(src, bookUrl).catch(() => null);
      const tocUrl = (bi?.tocUrl || bookUrl) as string;
      const ch = await getToc(src, tocUrl, bookUrl);
      applyList(ch);
      if (!cancel && ch.length) {
        cacheChapters(bookUrl, sourceId, ch);
        saveTocCache(currentKey, ch);
      }
    };
    load();
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookUrl, sourceId, hydrated, tocTick]);

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
  // 优先用真实排版量出来的行切页：每页正好填满能放下的行，底部不会留白。
  // 测量还没回来时，先用旧的字数估算顶一下，避免闪一下空白。
  const pages = useMemo(() => {
    if (!isPaged || !area.w || !area.h) return [];
    const H = pageTextHeight(area.h);

    // 测量结果不可靠（只有一行，或所有行 y 都是 0）时别硬切，回落估算
    const measuredOk =
      measuredLines.length > 1 && measuredLines.some((l) => l.y > 0);

    if (measuredOk) {
      // 行高必须用「字号 × 行距」兜底。onTextLayout 在有些 RN 版本上
      // 返回的 height 是 0，之前拿 H/10 兜底（≈70pt）比真实行高（≈41pt）大得多，
      // 一页只塞十行，中间就空出一大块。
      const lineH = settings.fontSize * settings.lineHeight;
      const out: string[] = [];
      let cur: string[] = [];
      let baseY = measuredLines[0].y;
      for (const ln of measuredLines) {
        const bottom = ln.y + (ln.h > 0 ? ln.h : lineH) - baseY;
        if (cur.length && bottom > H + 0.5) {
          out.push(trimPageEdges(cur.join('\n')));
          cur = [];
          baseY = ln.y;
        }
        cur.push(ln.text);
      }
      if (cur.length) out.push(trimPageEdges(cur.join('\n')));
      if (out.length) return out.filter((p) => p.trim().length > 0);
    }

    return paginate(displayText, {
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight,
      width: pageTextWidth(area.w),
      height: H,
      charsPerLine,
    });
    // 换字体后行高和字宽都会变，必须重新分页
  }, [
    content,
    area.w,
    area.h,
    settings.fontSize,
    settings.lineHeight,
    settings.fontId,
    charsPerLine,
    measuredLines,
    displayText,
    isPaged,
  ]);

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

  // 手动刷新目录：把缓存时间戳清掉，再踢一次 effect 走网络
  const refreshToc = () => {
    setMenuOpen(false);
    clearTocCache(currentKey);
    if (!shelfBook) return;
    useStore.setState((st) => ({
      shelf: st.shelf.map((x) =>
        bookKey(x.bookUrl, x.sourceId) === currentKey
          ? { ...x, cachedAt: 0 }
          : x
      ),
    }));
    setTocTick((t) => t + 1);
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
      {/* 排版标定：用当前真实字体渲染一行，数出「一行到底能放几个字」。
          opacity 0 + 绝对定位，不参与布局也不用 pointerEvents 处理。 */}
      {area.w > 0 && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: pageTextWidth(area.w),
            opacity: 0,
          }}
        >
          <Text
            key={`ruler-${settings.fontSize}-${settings.lineHeight}-${appFont || 'sys'}-${Math.round(area.w)}`}
            style={{
              fontSize: settings.fontSize,
              lineHeight: settings.fontSize * settings.lineHeight,
            }}
            onTextLayout={(e: any) => {
              const ls = e && e.nativeEvent && e.nativeEvent.lines;
              if (!ls || !ls.length) return;
              const n = (ls[0].text || '').length;
              // 少于 4 个说明宽度异常，别拿它去分页
              if (n >= 4 && n !== charsPerLine) setCharsPerLine(n);
            }}
          >
            {'汉'.repeat(80)}
          </Text>
        </View>
      )}

      {/* 真实排版测量：把整章用同样的宽度/字号/行高渲染一遍（不可见），
          原生排版会告诉我们每一行落在哪个 y、有多高。
          用它切页，每页正好填满 —— 不再是「估算能放几行」。 */}
      {isPaged && area.w > 0 && !!content && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: pageTextWidth(area.w),
            opacity: 0,
          }}
        >
          <Text
            key={`measure-${settings.fontSize}-${settings.lineHeight}-${appFont || 'sys'}-${Math.round(area.w)}-${index}-${content.length}`}
            style={{
              fontSize: settings.fontSize,
              lineHeight: settings.fontSize * settings.lineHeight,
            }}
            onTextLayout={(e: any) => {
              const ls = e && e.nativeEvent && e.nativeEvent.lines;
              if (!ls || !ls.length) return;
              setMeasuredLines(
                ls.map((l: any) => ({
                  text: l.text || '',
                  y: l.y || 0,
                  h: l.height || 0,
                }))
              );
            }}
          >
            {displayText}
          </Text>
        </View>
      )}

      {/* 顶栏做成浮层（绝对定位）：以前它占位，隐藏了也占着 111pt，
          正文就永远铺不满屏。浮层之后正文区始终是整块屏幕，工具栏只是临时盖上来。 */}
      <Animated.View
        style={{
          opacity: barsOpacity,
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          zIndex: 20,
        }}
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
          {/* 底部安全区由下面那条工具栏负责，这里再吃一次 bottom 会让
              正文区高度少算 34pt，分页按多出来的高度切 → 页面显得排不满 */}
          <SafeAreaView
            style={{ flex: 1 }}
            edges={['left', 'right', 'top', 'bottom']}
            onLayout={(e) => {
              const { width, height } = e.nativeEvent.layout;
              // onLayout 给的是**含 padding** 的总高，而这个 SafeAreaView 上下都吃着
              // 安全区（灵动岛 59 + home 条 34）。不减掉就等于多算 93pt，
              // 分页会多切两三行，最后那几行就掉到页脚下面、溢出屏幕。
              const usable = height - insets.top - insets.bottom;
              setArea((a) =>
                a.w === width && a.h === usable ? a : { w: width, h: usable }
              );
            }}
          >
            {area.w > 0 ? (
              <>
              <PageCurlView
                pages={pages}
                /* 排版测量回来后页数可能变少（每页能装的行数和估算不同），
                   页号要夹在有效范围内，否则会停在一张不存在的页上 */
                index={Math.min(pageIndex, Math.max(0, pages.length - 1))}
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
              {/* 页眉：左章节名、右书名。固定在每页顶部，不随翻页移动 */}
              <View
                style={[
                  styles.pageHeader,
                  { backgroundColor: theme.bg, top: insets.top },
                ]}
                pointerEvents="none"
              >
                <Text
                  style={[styles.pageMeta, { color: theme.sub }]}
                  numberOfLines={1}
                >
                  {curChapter?.name || ''}
                </Text>
                <Text
                  style={[styles.pageMeta, styles.pageMetaRight, { color: theme.sub }]}
                  numberOfLines={1}
                >
                  {name}
                </Text>
              </View>
              {/* 页脚：左「本章第几页 · 全书进度」、右电量 */}
              <View
                style={[
                  styles.pageFooter,
                  { backgroundColor: theme.bg, bottom: insets.bottom },
                ]}
                pointerEvents="none"
              >
                <Text style={[styles.pageMeta, { color: theme.sub }]}>
                  {pages.length ? `${pageIndex + 1}/${pages.length}` : ''}
                  {chapters.length
                    ? ` · 全书 ${(
                        ((index + (pages.length ? (pageIndex + 1) / pages.length : 0)) /
                          chapters.length) *
                        100
                      ).toFixed(1)}%`
                    : ''}
                </Text>
                <Text
                  style={[styles.pageMeta, styles.pageMetaRight, { color: theme.sub }]}
                >
                  {battery == null ? '' : `${Math.round(battery * 100)}%`}
                </Text>
              </View>
              </>
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
              {displayText}
            </Text>
          </ScrollView>
        </View>
      )}

      {/* 底部工具栏（同样浮层，不占正文空间） */}
      <Animated.View
        style={{
          opacity: barsOpacity,
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 20,
        }}
        pointerEvents={barsVisible ? 'auto' : 'none'}
      >
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: theme.barBg }}>
          <View style={[styles.bottom, { backgroundColor: theme.barBg }]}>
            <TouchableOpacity style={styles.bBtn} onPress={handlePrev}>
              <Text style={[styles.bText, { color: theme.barText }]}>
                上一章
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
                下一章
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

            <TouchableOpacity style={styles.switchRow} onPress={refreshToc}>
              <View style={{ flex: 1 }}>
                <Text style={styles.menuLabel}>刷新目录</Text>
                <Text style={styles.switchSub} numberOfLines={1}>
                  {shelfBook
                    ? '书架里的书会缓存目录，书更新了点这里拉最新'
                    : '加入书架后才会缓存目录'}
                </Text>
              </View>
              <Text style={styles.switchGo}>刷新</Text>
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
              <TouchableOpacity
                style={styles.presetBtn}
                onPress={() =>
                  updateSettings({
                    fontSize: 18,
                    lineHeight: 1.6,
                    paraIndent: true,
                    paraGap: 0,
                  })
                }
              >
                <Text style={styles.presetText}>推荐排版（18 号 · 1.6 行距）</Text>
              </TouchableOpacity>
              <Text style={[styles.menuLabel, { marginTop: 10 }]}>字号</Text>
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
              <Text style={styles.menuLabel}>段间距</Text>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={styles.step}
                  onPress={() =>
                    updateSettings({
                      paraGap: Math.max(0, (settings.paraGap ?? 0) - 1),
                    })
                  }
                >
                  <Text style={styles.stepText}>－</Text>
                </TouchableOpacity>
                <Text style={[styles.menuVal, { color: APP.text }]}>
                  {(settings.paraGap ?? 0) === 0 ? '紧贴' : `空 ${settings.paraGap ?? 0} 行`}
                </Text>
                <TouchableOpacity
                  style={styles.step}
                  onPress={() =>
                    updateSettings({
                      paraGap: Math.min(2, (settings.paraGap ?? 0) + 1),
                    })
                  }
                >
                  <Text style={styles.stepText}>＋</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.row}>
              <Text style={styles.menuLabel}>段首缩进</Text>
              <TouchableOpacity
                style={[
                  styles.switchPill,
                  settings.paraIndent !== false && styles.switchPillOn,
                ]}
                onPress={() =>
                  updateSettings({ paraIndent: settings.paraIndent === false })
                }
              >
                <Text
                  style={[
                    styles.switchPillText,
                    settings.paraIndent !== false && styles.switchPillTextOn,
                  ]}
                >
                  {settings.paraIndent !== false ? '两字缩进' : '顶格'}
                </Text>
              </TouchableOpacity>
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
