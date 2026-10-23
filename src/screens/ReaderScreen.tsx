import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useCallback } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  FlatList,
  Alert,
  Animated,
  TextInput,
  Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
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
import { hasVisibleText } from '../utils/text';
import { captureRef } from 'react-native-view-shot';
import * as Clipboard from 'expo-clipboard';
import { SelectablePage } from '../components/SelectablePage';
import {
  clearBookChapters,
  countCached,
  hasChapter,
  loadChapter,
  saveChapter,
} from '../utils/chapterCache';
import { SourceSwitchSheet } from '../components/SourceSwitchSheet';
import { SearchBook } from '../engine/types';
import { matchChapterIndex } from '../utils/bookMatch';
import { useAppFont } from '../components/AppText';
import {
  PAGE_PAD_BOTTOM,
  PAGE_FIXED_LINES,
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
  // 固定高度：FlatList 的 getItemLayout 要拿它算偏移，目录才能精确跳到当前章
  chItem: { height: 46, justifyContent: 'center', borderBottomWidth: 1, borderColor: APP.border },
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
  cacheRow: {
    flexDirection: 'row',
    marginBottom: 8,
    marginTop: 2,
  },
  cacheBtn: {
    flex: 1,
    backgroundColor: APP.card2,
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
    marginRight: 8,
    borderWidth: 1,
    borderColor: APP.border,
  },
  cacheBtnText: { color: APP.text, fontSize: 13, fontWeight: '600' },
  cacheBtnGhost: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: APP.danger,
    justifyContent: 'center',
  },
  cacheBtnGhostText: { color: APP.danger, fontSize: 13, fontWeight: '600' },
  cacheCancel: { color: APP.danger, fontSize: 13, fontWeight: '700' },
  filterMask: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 26,
  },
  filterCard: { backgroundColor: APP.card, borderRadius: 14, padding: 18 },
  filterTitle: { color: APP.text, fontSize: 17, fontWeight: '700' },
  filterHint: { color: APP.sub, fontSize: 11, marginTop: 4 },
  filterLabel: { color: APP.sub, fontSize: 12, marginTop: 14, marginBottom: 6 },
  filterInput: {
    backgroundColor: APP.card2,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: APP.text,
    fontSize: 14,
    maxHeight: 96,
    textAlignVertical: 'top',
  },
  filterBtns: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 18 },
  filterBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 8, marginLeft: 10 },
  filterBtnPrimary: { backgroundColor: APP.accent },
  filterBtnText: { color: APP.sub, fontSize: 14, fontWeight: '600' },
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
  // 净化规则变化后用它强制重载当前章（loadContent 的依赖里有它）
  const [reloadTick, setReloadTick] = useState(0);

  // 打开目录时滚到当前正在读的那一章，而不是停在第一章
  useEffect(() => {
    if (!tocOpen) return;
    const t = setTimeout(() => {
      try {
        tocListRef.current?.scrollToIndex({
          index,
          viewPosition: 0.35, // 让当前章落在偏上的位置，前后文都能看到
          animated: false,
        });
      } catch {
        /* 列表还没量好，忽略这次 */
      }
    }, 70);
    return () => clearTimeout(t);
  }, [tocOpen, index]);
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
  const tocListRef = useRef<FlatList<any>>(null);

  // 顶/底工具栏显隐。点屏幕中间切换，方便沉浸阅读。
  // 用透明度而不是条件渲染：工具栏仍然占位，分页不会因为显隐而重排跳页。
  const [barsVisible, setBarsVisible] = useState(true);
  const barsOpacity = useRef(new Animated.Value(1)).current;
  // 翻页时把工具栏收起来：它是浮层（74pt），展开状态下会盖住正文最后两行，
  // 边翻边看就会觉得"前后接不上"。
  const hideBars = () => {
    if (!barsVisible) return;
    setBarsVisible(false);
    Animated.timing(barsOpacity, {
      toValue: 0,
      duration: 120,
      useNativeDriver: true,
    }).start();
  };

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
        // 设置里的「段首缩进」已删，固定为缩进（靠缩进区分段落，不留空行）
        indent: true,
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

  const appFont = useAppFont();
  // 页眉页脚是绝对定位的，绝对定位不认父容器的安全区 padding，
  // 必须自己把安全区高度加上，否则会被状态栏/灵动岛和 home indicator 压住。
  const insets = useSafeAreaInsets();
  /*
   * 页眉页脚已移除（用户 2026-10-21 决定不要电量/进度/章节名）。
   * 但顶部不能顶着状态栏出字 —— 用户要求「从第三行开始」，
   * 也就是顶部先空两行。底部留白做成可调（settings.bottomGapLines，单位行）。
   * 这两个值会同时作用于「可排印高度」和「页面内边距」，所以只改这里就够。
   */
  const lineH = settings.fontSize * settings.lineHeight;
  // 顶部 / 底部留白都以「行」为单位，步进 0.2
  const topGap = Math.max(0, Math.min(5, settings.topGapLines ?? 1.5));
  const bottomGap = Math.max(0, Math.min(5, settings.bottomGapLines ?? 0));
  const metaHeaderH = lineH * topGap;
  const metaFooterH = lineH * bottomGap;

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
  /*
   * 跳页意图。**必须带目标章节**：
   * 之前只存页码，而 effect 的依赖里有 index —— index 一变就立刻消费，
   * 但那时 pages 还是上一章的，页码被套到错的章上、意图随即被清空，
   * 等新章真正加载完就没人管了 → 于是永远停在新章第一页。
   * page = -1 表示"目标章最后一页"。
   */
  const navTarget = useRef<{ ch: number; page: number } | null>(null);
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
          // 先看本地缓存：命中就不用联网，翻页/重进都是秒开
          const cachedText = await loadChapter(currentKey, index);
          if (cachedText) {
            text = cachedText;
          } else {
            const res = await getContent(src, ch.url);
            text = res.content;
            if (text) saveChapter(currentKey, index, text);
          }
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
  }, [index, chapters.length, settings.replaceRules, reloadTick, sourceId, bookUrl]);

  // 分页（仅非滚动模式）
  // 优先用真实排版量出来的行切页：每页正好填满能放下的行，底部不会留白。
  // 测量还没回来时，先用旧的字数估算顶一下，避免闪一下空白。
  /*
   * ===== 「过滤文字」功能 =====
   * 长按正文 → 弹面板（自动带上剪贴板里刚复制的那段，比如盗版站插的广告）
   * → 一键删除，或者自己写替换字。规则进 settings.replaceRules，
   * 对所有章节全文生效，不是只改当前页。
   */
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState('');
  const [filterReplace, setFilterReplace] = useState('');
  // 选取模式：正文换成可选中的 TextInput，直接长按选字来净化
  const [selectMode, setSelectMode] = useState(false);

  const openFilterSheet = useCallback(async () => {
    // 预填剪贴板：用户刚复制的那段文字，省得手打
    try {
      const clip = await Clipboard.getStringAsync();
      if (clip && clip.trim()) setFilterDraft(clip.trim().slice(0, 200));
    } catch {
      /* 剪贴板读不到就算了，手动输入 */
    }
    setFilterReplace('');
    setFilterOpen(true);
  }, []);

  const submitFilter = useCallback(() => {
    const raw = filterDraft.trim();
    if (!raw) {
      setFilterOpen(false);
      return;
    }
    // 用户输入按「字面」处理，正则元字符全部转义，避免意外
    const pattern = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    updateSettings({
      replaceRules: [
        ...settings.replaceRules,
        { pattern, replacement: filterReplace, isRegex: false },
      ],
    });
    setFilterOpen(false);
    // 当前章节重新走一遍净化，立刻看到效果
    setReloadTick((t) => t + 1);
    Alert.alert(
      '已加入过滤',
      `「${raw}」会${filterReplace ? `替换成「${filterReplace}」` : '被删除'}，从当前章节开始生效。`
    );
  }, [filterDraft, filterReplace, settings.replaceRules, updateSettings]);

  const rawPages = useMemo(() => {
    if (!isPaged || !area.w || !area.h) return [];
    const H = pageTextHeight(area.h, metaHeaderH, metaFooterH);

    // 测量结果不可靠（只有一行，或所有行 y 都是 0）时别硬切，回落估算
    const measuredOk =
      measuredLines.length > 1 && measuredLines.some((l) => l.y > 0);

    if (measuredOk) {
      // 行高必须用「字号 × 行距」兜底。onTextLayout 在有些 RN 版本上
      // 返回的 height 是 0，之前拿 H/10 兜底（≈70pt）比真实行高（≈41pt）大得多，
      // 一页只塞十行，中间就空出一大块。
      const lineH = settings.fontSize * settings.lineHeight;
      /*
       * 双保险：除了按坐标切，还要卡死「一页最多几行」。
       * onTextLayout 报的 line.height 会比实际渲染略小一点，几十行累积下来，
       * 最后一行会掉出可排印区 —— 被容器裁掉半截（看起来像"最后一行被吞了"、
       * 翻页后前后接不上）。用 floor(H/lineH) 兜一层，多一行都不给。
       */
      // 行高用「实测相邻行的间距中位数」，而不是算出来的 fontSize*lineHeight。
      // 实测值才反映真实排版（自定义字体的行高度量、舍入都可能不一样）。
      const gaps: number[] = [];
      for (let i = 1; i < measuredLines.length; i++) {
        const g = measuredLines[i].y - measuredLines[i - 1].y;
        if (g > 0) gaps.push(g);
      }
      gaps.sort((a, b) => a - b);
      const realLineH = gaps.length ? gaps[Math.floor(gaps.length / 2)] : lineH;
      // 固定行数（用户要求 18 行）；只有字号大到 18 行真放不下时才让位给可用高度
      const fitLines = Math.max(1, Math.floor(H / realLineH));
      const wantLines = settings.linesPerPage ?? PAGE_FIXED_LINES;
      const maxLines = Math.max(1, Math.min(wantLines, fitLines));
      const out: string[] = [];
      let cur: string[] = [];
      let baseY = measuredLines[0].y;
      for (const ln of measuredLines) {
        /*
         * 关键：这里用 realLineH（实测行距），而不是 ln.h。
         * onTextLayout 报的 height 比实际渲染小一点，拿它算 bottom 会低估，
         * 于是"以为放得下"却溢出，最后一行就被容器裁掉半截。
         * 实测行距 + 行数上限用同一个值，两边严格一致，才排得准。
         */
        const bottom = ln.y + realLineH - baseY;
        if (cur.length && (bottom > H + 0.5 || cur.length >= maxLines)) {
          out.push(trimPageEdges(cur.join('\n')));
          cur = [];
          baseY = ln.y;
        }
        cur.push(ln.text);
      }
      if (cur.length) out.push(trimPageEdges(cur.join('\n')));
      /*
       * 这里必须判断**过滤之后**的数组长度。
       * 原来写的是 `if (out.length)`（过滤前），一旦过滤完变成空数组就会直接
       * 返回 [] —— pages 空 → 整页渲染成空白，看起来就是「内容突然全部消失」。
       * 空的时候一定要 fall through 到下面的 paginate 兜底。
       */
      const cleaned = out.filter((p) => hasVisibleText(p));
      if (cleaned.length) return cleaned;
    }

    // 兜底路径只知道理论行高（实测值还没回来），保守少排半行，宁少勿裁
    const fallback = paginate(displayText, {
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight,
      width: pageTextWidth(area.w),
      // 兜底路径同样按固定行数给高度
      height: Math.max(
        1,
        Math.min(
          H,
          (settings.linesPerPage ?? PAGE_FIXED_LINES) *
            settings.fontSize *
            settings.lineHeight
        )
      ),
      charsPerLine,
    });
    // 最后一道保险：无论如何不能让 pages 是空数组，否则整页全白
    return fallback.length ? fallback : [' '];
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
    settings.linesPerPage,
    metaHeaderH,
    metaFooterH,
    isPaged,
  ]);

  /*
   * 最终上屏的页数组：**在这里统一剔一次空页**。
   * 之前只在 measuredLines 那条路径上过滤，一旦走到别的分支（或者数组被
   * 别处改动），就会出现「页脚显示 4/15、正文却整页空」的情况。
   * 放在这里过滤，翻页、页码、进度全部跟着干净。
   */
  const pages = useMemo(() => {
    /*
     * 压掉页内的空行。
     * onTextLayout 切行时，某些行会拿到空 text（段落末尾、缩进行被拆开等），
     * join('\n') 之后就成了 '\n\n' —— 屏幕上就是整行空白。
     * 空行本身没有任何内容，压掉它不会丢字，只是让页面更紧凑。
     */
    const clean = rawPages
      .map((p) => String(p || '').replace(/(\r?\n)(?:[ \t\u3000]*\r?\n)+/g, '$1'))
      .filter((p) => hasVisibleText(p));
    if (clean.length) return clean;
    return rawPages.length ? [' '] : [];
  }, [rawPages]);

  /*
   * ===== 页面位图化（对齐爱阅书香的思路）=====
   * 正文用「活的 Text」渲染时，每翻一页都要重新做一次文字排版，
   * 那几十毫秒里屏幕是空的。爱阅书香不会空，是因为它把每页当成一张图，
   * 翻页期间只对图做几何变换，根本不碰文字。
   *
   * 这里做同样的事：后台用隐藏容器把相邻几页渲染出来 → 截成图片 →
   * 翻页组件优先贴图。图还没截好时自动退回实时文字（首屏那一下）。
   */
  const [pageImages, setPageImages] = useState<Record<number, string>>({});
  const imagesRef = useRef<Record<number, string>>({});
  imagesRef.current = pageImages;
  const shotHostRef = useRef<any>(null);
  const shotQueueRef = useRef<{ idx: number; text: string }[]>([]);
  const [shotTarget, setShotTarget] = useState<{ idx: number; text: string } | null>(null);

  /*
   * 位图失效：**直接盯住分页结果 pages**。
   *
   * 之前是枚举条件（换章 / 改字号 / 改行距 / 改每页行数 / 段首缩进 / 尺寸），
   * 结果加了「顶部留白 / 底部留白」之后忘了补 —— 调留白会重排分页，
   * 但旧图仍然挂在旧页码上，于是翻到第 2 页贴出来的是"旧排版下的第 2 页"，
   * 用户看到的就是「不管翻多少页都是同一页」。
   *
   * pages 是 useMemo，任何导致重排的输入变都会产出新数组，所以盯它就够了。
   */
  useEffect(() => {
    setPageImages({});
  }, [pages]);

  // 入队：优先下一页（翻页最需要），再当前页、上一页
  useEffect(() => {
    if (!isPaged || !pages.length || !area.w || !area.h) return;
    const want: { idx: number; text: string }[] = [];
    for (const i of [index + 1, index, index - 1]) {
      if (i < 0 || i >= pages.length) continue;
      const t = pages[i];
      if (!hasVisibleText(t) || imagesRef.current[i]) continue;
      if (want.some((x) => x.idx === i)) continue;
      want.push({ idx: i, text: t });
    }
    shotQueueRef.current = want;
    setShotTarget(want[0] ?? null);
  }, [isPaged, index, pages, area.w, area.h]);

  // 出一张图，然后接着下一张
  useEffect(() => {
    if (!shotTarget || !shotHostRef.current) return;
    let cancel = false;
    const timer = setTimeout(async () => {
      let uri: string | null = null;
      try {
        uri = await captureRef(shotHostRef, {
          format: 'jpg',
          quality: 0.85,
          width: area.w,
          height: area.h,
          result: 'tmpfile',
        });
      } catch {
        uri = null;
      }
      if (cancel) return;
      if (uri) {
        setPageImages((prev) => ({ ...prev, [shotTarget.idx]: uri as string }));
      }
      shotQueueRef.current.shift();
      setShotTarget(shotQueueRef.current[0] ?? null);
    }, 80);
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  }, [shotTarget, area.w, area.h]);

  /*
   * 首次进书：把书架里存的章节 + 页码还原回来。
   * 之前完全没有这段逻辑 —— 所以退出再进来永远停在本章第一页。
   * 用 pendingPageIndex 传递，让下面的 effect 去夹紧并落位。
   */
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !shelfBook || !chapters.length) return;
    restoredRef.current = true;
    const ci = Math.min(shelfBook.lastChapterIndex ?? 0, chapters.length - 1);
    if (ci > 0) setIndex(ci);
    if ((shelfBook.lastReadPos ?? 0) > 0) {
      navTarget.current = { ch: ci, page: shelfBook.lastReadPos };
    }
  }, [shelfBook, chapters.length]);

  /*
   * 章节排版变化后落位。
   * **只有 pending 存在时才动 pageIndex、才写进度**：
   * 之前没有 pending 时也会 t = pageIndex 然后 updateProgress，
   * 等于进书那一刻就把进度改写成 0（pageIndex 初值就是 0），把存的位置冲掉了。
   */
  useEffect(() => {
    const t = navTarget.current;
    if (!t || !pages.length) return;
    // 章节还没切到目标章 → 这次 pages 是别的章的，等下一次
    if (t.ch !== index) return;
    navTarget.current = null;
    const want = t.page === -1 ? pages.length - 1 : t.page;
    const pos = Math.min(Math.max(want, 0), Math.max(0, pages.length - 1));
    setPageIndex(pos);
    updateProgress(bookUrl, sourceId, index, pos);
  }, [pages, index, bookUrl, sourceId, updateProgress]);

  const goPrev = () => {
    if (index > 0) {
      navTarget.current = { ch: index - 1, page: 0 };
      setPageIndex(0);
      setIndex(index - 1);
    }
  };
  // 跳章 = 跳到那一章的**第一页**。只改 index 不改 pageIndex 的话，
  // 会停在上一章看到一半的页码上（比如第 5 页），看起来就不是"开头"。
  const goNext = () => {
    if (index < chapters.length - 1) {
      navTarget.current = { ch: index + 1, page: 0 };
      setPageIndex(0);
      setIndex(index + 1);
    }
  };

  // —— 正文缓存 ——
  // 阅读时自动把后面 5 章抓下来，翻页不用等网络
  const prefetchingRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (loading || !chapters.length || sourceId === LOCAL_SOURCE_ID) return;
    const src = sources.find((s) => s.bookSourceUrl === sourceId);
    if (!src) return;
    let cancel = false;
    // 关键：预取要等当前页彻底稳定再开始。
    // 解析一章 HTML（cheerio）是纯 JS 计算，翻页时同时跑 5 个会把 JS 线程占满，
    // 动画就会一顿一顿的。延迟 1.5 秒，快速连翻时根本不会启动预取。
    const timer = setTimeout(() => {
      if (cancel) return;
      (async () => {
        for (let i = 1; i <= 5; i++) {
          const t = index + i;
          if (cancel) return;
          if (t >= chapters.length) return;
          if (prefetchingRef.current.has(t)) continue;
          if (await hasChapter(currentKey, t)) continue;
          prefetchingRef.current.add(t);
          try {
            const r = await getContent(src, chapters[t].url);
            if (r.content) await saveChapter(currentKey, t, r.content);
          } catch {
            /* 预取失败无所谓，翻到那儿再拉 */
          } finally {
            prefetchingRef.current.delete(t);
          }
          // 每章之间让出一帧，别把 JS 线程连着占死
          await new Promise((res) => setTimeout(res, 60));
        }
      })();
    }, 1500);
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, chapters.length, loading, sourceId, currentKey]);

  const [cacheJob, setCacheJob] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const cacheCancelRef = useRef(false);

  const startCache = (count: number) => {
    if (cacheJob) return;
    if (!chapters.length) return;
    const n = count < 0 ? chapters.length : Math.min(chapters.length, count);
    // 几百章要跑挺久，先说清楚，别让人以为卡住了
    if (n > 200) {
      Alert.alert(
        '缓存章节',
        `将缓存 ${n} 章，需要一段时间，期间请保持 App 在前台，可以随时取消。`,
        [
          { text: '取消', style: 'cancel' },
          { text: '开始', onPress: () => runCache(count) },
        ]
      );
      return;
    }
    runCache(count);
  };

  const runCache = async (count: number) => {
    const src = sources.find((s) => s.bookSourceUrl === sourceId);
    if (!src || !chapters.length) return;
    const total = count < 0 ? chapters.length : Math.min(chapters.length, count);
    cacheCancelRef.current = false;
    setCacheJob({ done: 0, total });
    let done = 0;
    for (let i = 0; i < total; i++) {
      if (cacheCancelRef.current) break;
      if (!(await hasChapter(currentKey, i))) {
        try {
          const r = await getContent(src, chapters[i].url);
          if (r.content) await saveChapter(currentKey, i, r.content);
        } catch {
          /* 单章失败跳过 */
        }
      }
      done = i + 1;
      setCacheJob({ done, total });
    }
    setCacheJob(null);
    Alert.alert(
      cacheCancelRef.current ? '已取消' : '缓存完成',
      `本次处理 ${done} 章。之后读这些章不用再联网。`
    );
  };

  const clearCache = () => {
    if (cacheJob) return;
    Alert.alert('清空正文缓存', '只删本书已缓存的正文，不影响目录和书架。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: async () => {
          await clearBookChapters(currentKey, chapters.length);
          Alert.alert('已清空', '这本书的正文缓存已经删掉了。');
        },
      },
    ]);
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

  // 进度写盘节流。updateProgress 会触发 zustand persist —— 每次都要把
  // 整个 store（含全部书源规则）序列化写盘，一页一次的话翻得快点就掉帧。
  // 连续翻页时只写最后一次，卸载时补一次。
  const saveTimerRef = useRef<any>(null);
  const pendingRef = useRef<{ i: number; p: number } | null>(null);
  const flushProgress = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const p = pendingRef.current;
    if (p) {
      pendingRef.current = null;
      updateProgress(bookUrl, sourceId, p.i, p.p);
    }
  };
  const savePageProgress = (pi: number) => {
    pendingRef.current = { i: index, p: pi };
    if (saveTimerRef.current) return;
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      flushProgress();
    }, 350);
  };
  /*
   * 章内翻页也要落盘。
   * 之前 savePageProgress 只在「换章」的几条路径里调用，**章内翻页从来没存过**，
   * 于是书架里的 lastReadPos 一直是 0，恢复逻辑的「> 0」判断根本不成立
   * → 表现就是「退到书架再进来永远回到本章第一页」。
   */
  useEffect(() => {
    if (!pages.length || !restoredRef.current) return;
    // 还有待执行的跳页意图时先别存，等它落位后再存，免得把旧页码顶掉
    if (navTarget.current) return;
    savePageProgress(pageIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIndex, pages]);

  useEffect(() => () => flushProgress(), []);
  useEffect(() => {
    // 换章时把上一章的进度补写掉，别丢
    return () => flushProgress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // 分页模式下：优先页内翻，到章边界再翻章
  const handlePrevPage = () => {
    hideBars();
    if (!isPaged) return goPrev();
    if (pageIndex > 0) {
      const ni = pageIndex - 1;
      setPageIndex(ni);
      savePageProgress(ni);
      return;
    }
    if (index > 0) {
      navTarget.current = { ch: index - 1, page: -1 }; // 跳到上一章末页
      setIndex(index - 1);
    }
  };
  const handleNextPage = () => {
    hideBars();
    if (!isPaged) return goNext();
    if (pageIndex < pages.length - 1) {
      const ni = pageIndex + 1;
      setPageIndex(ni);
      savePageProgress(ni);
      return;
    }
    if (index < chapters.length - 1) {
      navTarget.current = { ch: index + 1, page: 0 }; // 跳到下一章首页
      setIndex(index + 1);
    }
  };

  // 底部按钮：直接跳到上一章 / 下一章的开头（不是翻页）
  // 底部按钮：跳章。**不要收工具栏** —— 收了想再点一次就得重新呼出来，
  // 连续翻章很别扭。遮挡问题在页脚删掉之后已经不严重。
  const handlePrevChapter = () => {
    goPrev();
  };
  const handleNextChapter = () => {
    goNext();
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
              {/*
               * 隐藏的「截图宿主」：把待截图的页按正式排版渲染一遍（透明不可见），
               * 然后由 captureRef 拍成图片。位置和尺寸必须和正文页面完全一致，
               * 否则截出来的图和实际显示对不上。
               */}
              <View
                ref={shotHostRef}
                collapsable={false}
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: area.w,
                  height: area.h,
                  // 不能用 opacity: 0 —— iOS 会把「完全透明」的视图优化掉，
                  // 压根不绘制，captureRef 截出来的就是一张空白图。
                  // 0.01 肉眼绝对看不出来，但保证它真的被画出来。
                  opacity: 0.01,
                }}
              >
                {shotTarget ? (
                  <View
                    style={{
                      width: area.w,
                      height: area.h,
                      backgroundColor: theme.bg,
                      paddingTop: PAGE_PAD_TOP + metaHeaderH,
                      paddingBottom: PAGE_PAD_BOTTOM + metaFooterH,
                      paddingHorizontal: PAGE_PAD_H,
                    }}
                  >
                    <Text
                      style={{
                        color: theme.text,
                        fontSize: settings.fontSize,
                        lineHeight: settings.fontSize * settings.lineHeight,
                      }}
                    >
                      {shotTarget.text}
                    </Text>
                  </View>
                ) : null}
              </View>
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
                headerH={metaHeaderH}
                footerH={metaFooterH}
                /*
                 * 暂时停用位图化。
                 * 现象：翻页后显示的是别的页的文字（诊断显示 index / flipBase 都对），
                 * 说明是贴图贴错了 —— captureRef 是异步的，截到的可能是相邻页的画面。
                 * 先把图这条路关掉，用纯文字渲染验证：如果内容对了，就锁定是位图化的锅。
                 * 截图管线代码保留（pageImages / 截图宿主都还在），只是不再喂给渲染层。
                 */
                images={undefined}
                onLongPress={() => {
                  // 长按正文 = 进入选取状态，选中文字后自动弹过滤面板
                  setSelectMode(true);
                }}
                onTapLeft={handlePrevPage}
                onTapRight={handleNextPage}
                onTapCenter={toggleBars}
              />

              {/*
               * 选取模式覆盖层：正文换成可选中文本。
               * RN 的 Text 拿不到选择事件，只有 TextInput 有 onSelectionChange，
               * 所以进这个模式时用 TextInput 顶上，选完就自动退出。
               * editable 必须是 true 才能选中；用 showSoftInputOnFocus={false} 挡住键盘。
               */}
              {selectMode ? (
                <View
                  style={[
                    StyleSheet.absoluteFill,
                    {
                      backgroundColor: theme.bg,
                      zIndex: 30,
                      // 必须让出状态栏：正常阅读的正文是从安全区顶部开始的，
                      // 覆盖层如果从屏幕 0 开始，整页会往上偏 59pt，
                      // 底部还会多出一大块空白（底部条就悬在半空）。
                      paddingTop: insets.top,
                    },
                  ]}
                >
                  <SelectablePage
                    text={pages[Math.min(pageIndex, Math.max(0, pages.length - 1))] || ''}
                    width={area.w}
                    height={area.h}
                    fontSize={settings.fontSize}
                    lineHeight={settings.lineHeight}
                    color={theme.text}
                    bg={theme.bg}
                    padTop={PAGE_PAD_TOP + metaHeaderH}
                    padBottom={PAGE_PAD_BOTTOM + metaFooterH}
                    padH={PAGE_PAD_H}
                    offsetTop={insets.top}
                    onExit={() => setSelectMode(false)}
                    onAction={(sel, action) => {
                      setSelectMode(false);
                      const raw = sel.trim();
                      if (!raw) return;
                      /*
                       * 跨行选中时，选中的文本里带换行符。
                       * 但原文的换行形式可能是 \n、\r\n，或者两边还夹着缩进空格 ——
                       * 直接按字面匹配会匹配不到（这就是"选两行净化不掉"的原因）。
                       * 所以把换行替换成「可选空白 + 换行 + 可选空白」。
                       */
                      const pattern = raw
                        .split('\n')
                        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                        .join('[ \\t]*\\r?\\n[ \\t]*');
                      if (action === 'filter') {
                        /*
                         * 净化 = 直接删除，立刻生效。
                         * **跨行必须逐行加规则**：选中的文字来自 `pages[]`（分页后按测量切的行），
                         * 而替换规则是对原文 `content` 跑的 —— 两边行边界不一样，
                         * 拿整段（带换行）去匹配原文永远匹配不到，看起来就是"跨行净化没反应"。
                         * 逐行拆开、每行各自作为一条字面规则，就能命中了。
                         */
                        const parts = raw
                          .split('\n')
                          .map((l) => l.trim())
                          .filter((l) => l.length >= 2);
                        const adds = (parts.length ? parts : [raw]).map((l) => ({
                          pattern: l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
                          replacement: '',
                          isRegex: false,
                        }));
                        updateSettings({
                          replaceRules: [...settings.replaceRules, ...adds],
                        });
                        setReloadTick((t) => t + 1);
                        return;
                      }
                      // 替换 = 打开面板让用户填替换字
                      setFilterDraft(raw);
                      setFilterReplace('');
                      setFilterOpen(true);
                    }}
                  />
                  {/* 顶部横幅：让用户一眼看出"现在是选择模式" */}
                  <View
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: 0,
                      backgroundColor: 'rgba(28,28,30,0.94)',
                      paddingVertical: 11,
                      paddingHorizontal: 16,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <TouchableOpacity
                      onPress={() => setSelectMode(false)}
                      hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                      style={{ paddingVertical: 4, paddingRight: 18 }}
                    >
                      <Text style={{ color: '#0a84ff', fontSize: 15, fontWeight: '700' }}>
                        ‹ 退出
                      </Text>
                    </TouchableOpacity>
                    <Text style={{ color: '#fff', fontSize: 12, flexShrink: 1 }}>
                      按住并拖动选字
                    </Text>
                  </View>

                </View>
              ) : null}
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
            <TouchableOpacity style={styles.bBtn} onPress={handlePrevChapter}>
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
            <TouchableOpacity style={styles.bBtn} onPress={handleNextChapter}>
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
              ref={tocListRef}
              data={chapters}
              keyExtractor={(i) => String(i.index)}
              initialScrollIndex={index}
              getItemLayout={(_, i) => ({ length: 46, offset: 46 * i, index: i })}
              onScrollToIndexFailed={() => {}}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.chItem,
                    item.index === index && styles.chActive,
                  ]}
                  onPress={() => {
                    navTarget.current = { ch: item.index, page: 0 }; // 跳到目标章首页
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

      {/* 过滤文字面板：长按正文弹出 */}
      <Modal
        visible={filterOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFilterOpen(false)}
      >
        <View style={styles.filterMask}>
          <View style={styles.filterCard}>
            <Text style={styles.filterTitle}>过滤文字</Text>
            <Text style={styles.filterHint}>
              对所有章节全文生效，不只当前页
            </Text>

            <Text style={styles.filterLabel}>要过滤的原文（已自动带上剪贴板）</Text>
            <TextInput
              style={styles.filterInput}
              value={filterDraft}
              onChangeText={setFilterDraft}
              multiline
              placeholder="例如：都重生了谁谈恋爱啊无弹窗"
              placeholderTextColor={APP.sub}
            />

            <Text style={styles.filterLabel}>替换成（留空 = 删除）</Text>
            <TextInput
              style={[styles.filterInput, { maxHeight: 52 }]}
              value={filterReplace}
              onChangeText={setFilterReplace}
              placeholder="删除就留空"
              placeholderTextColor={APP.sub}
            />

            <View style={styles.filterBtns}>
              <TouchableOpacity
                style={styles.filterBtn}
                onPress={() => setFilterOpen(false)}
              >
                <Text style={styles.filterBtnText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterBtn, styles.filterBtnPrimary]}
                onPress={submitFilter}
              >
                <Text style={[styles.filterBtnText, { color: '#fff' }]}>确定</Text>
              </TouchableOpacity>
            </View>
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

                        <View style={styles.cacheRow}>
              {[
                { label: '50 章', n: 50 },
                { label: '100 章', n: 100 },
                { label: '全部', n: -1 },
              ].map((it) => (
                <TouchableOpacity
                  key={it.label}
                  style={[styles.cacheBtn, cacheJob && { opacity: 0.4 }]}
                  disabled={!!cacheJob}
                  onPress={() => startCache(it.n)}
                >
                  <Text style={styles.cacheBtnText}>{it.label}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={[styles.cacheBtnGhost, cacheJob && { opacity: 0.4 }]}
                disabled={!!cacheJob}
                onPress={clearCache}
              >
                <Text style={styles.cacheBtnGhostText}>清空</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.row}>
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
              <Text style={styles.menuLabel}>每页行数</Text>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={styles.step}
                  onPress={() =>
                    updateSettings({
                      linesPerPage: Math.max(10, (settings.linesPerPage ?? 18) - 1),
                    })
                  }
                >
                  <Text style={styles.stepText}>－</Text>
                </TouchableOpacity>
                <Text style={[styles.menuVal, { color: APP.text }]}>
                  {settings.linesPerPage ?? 18}
                </Text>
                <TouchableOpacity
                  style={styles.step}
                  onPress={() =>
                    updateSettings({
                      linesPerPage: Math.min(30, (settings.linesPerPage ?? 18) + 1),
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
              <Text style={styles.menuLabel}>顶部留白</Text>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={styles.step}
                  onPress={() =>
                    updateSettings({
                      topGapLines: Math.max(
                        0,
                        +((settings.topGapLines ?? 1.5) - 0.2).toFixed(1)
                      ),
                    })
                  }
                >
                  <Text style={styles.stepText}>－</Text>
                </TouchableOpacity>
                <Text style={[styles.menuVal, { color: APP.text }]}>
                  {(settings.topGapLines ?? 1.5).toFixed(1)} 行
                </Text>
                <TouchableOpacity
                  style={styles.step}
                  onPress={() =>
                    updateSettings({
                      topGapLines: Math.min(
                        5,
                        +((settings.topGapLines ?? 1.5) + 0.2).toFixed(1)
                      ),
                    })
                  }
                >
                  <Text style={styles.stepText}>＋</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.row}>
              <Text style={styles.menuLabel}>底部留白</Text>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={styles.step}
                  onPress={() =>
                    updateSettings({
                      bottomGapLines: Math.max(
                        0,
                        +((settings.bottomGapLines ?? 0) - 0.2).toFixed(1)
                      ),
                    })
                  }
                >
                  <Text style={styles.stepText}>－</Text>
                </TouchableOpacity>
                <Text style={[styles.menuVal, { color: APP.text }]}>
                  {(settings.bottomGapLines ?? 0).toFixed(1)} 行
                </Text>
                <TouchableOpacity
                  style={styles.step}
                  onPress={() =>
                    updateSettings({
                      bottomGapLines: Math.min(
                        5,
                        +((settings.bottomGapLines ?? 0) + 0.2).toFixed(1)
                      ),
                    })
                  }
                >
                  <Text style={styles.stepText}>＋</Text>
                </TouchableOpacity>
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
