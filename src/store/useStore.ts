import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BookSource, BookInfo, BookChapter } from '../engine/types';

/**
 * 同一本书的判定键。
 * bookUrl 经常只差一点点（尾斜杠、#后面的标记、http 与 https），
 * 用 === 直接比会"明明在书架里却找不到"，于是每次都重新拉目录。
 */
export function bookKey(url: string, sourceId: string): string {
  const u = String(url || '')
    .split('#')[0]
    .trim()
    .replace(/\/+$/, '')
    .replace(/^http:\/\//i, 'https://');
  return `${u}|${sourceId}`;
}

export interface ShelfBook {
  bookUrl: string;
  sourceId: string;
  name: string;
  author: string;
  coverUrl?: string;
  intro?: string;
  lastChapter?: string;
  addedAt: number;
  lastReadAt: number;
  lastChapterIndex: number;
  lastReadPos: number; // 阅读进度（字符偏移）
  cachedChapters?: BookChapter[]; // 缓存目录
  cachedAt?: number; // 缓存时间，用来判断要不要刷新
}

export type ThemeKey = 'day' | 'night' | 'green' | 'paper';
export type PageMode = 'cover' | 'simulate' | 'slide' | 'scroll';

export interface ReplaceRule {
  pattern: string;
  replacement: string;
  isRegex: boolean;
}

// 用户在 App 里导入的自定义字体
export interface CustomFont {
  id: string; // f + 时间戳
  alias: string; // 注册到 expo-font 的别名，同时就是样式里的 fontFamily
  label: string; // 显示名（文件名去后缀）
  uri: string; // 复制到 App 沙盒后的路径（仅作参考，换 App 版本后会失效）
  /**
   * 沙盒里的文件名（如 f1a2b3.ttf）。
   * **必须存这个**：iOS 每次更新 App，沙盒容器的 UUID 会变，
   * 绝对路径就指向了旧容器 —— 文件明明还在，却按老路径找不到，
   * 表现为"更新一次字体就失效，要重新导入"。
   */
  file?: string;
}

export interface Settings {
  theme: ThemeKey;
  fontSize: number;
  lineHeight: number;
  paraIndent: boolean; // 段首缩进两字
  paraGap: number; // 段落之间空几行
  linesPerPage: number; // 每页固定行数（用户可调，10-30）
  bottomGapLines: number; // 页面底部额外留白，单位「行」（0-5）
  topGapLines: number; // 页面顶部额外留白，单位「行」（0-5，步长 0.5）
  bgColor?: string;
  pageMode: PageMode;
  replaceRules: ReplaceRule[];
  useSystemUA: boolean;
  // 选中的自定义字体 id，空 = 跟随系统
  fontId?: string | null;
}

interface State {
  sources: BookSource[];
  shelf: ShelfBook[];
  settings: Settings;
  // 各书源历史命中次数：搜索时用来把「活着、能出结果」的源排到队首，
  // 用户不用先等几百个死站跑完才看到第一批结果
  sourceHits: Record<string, number>;
  // 已导入的自定义字体
  fonts: CustomFont[];
  addFont: (f: CustomFont) => void;
  removeFont: (id: string) => void;
  // 书源
  addSource: (s: BookSource) => void;
  removeSource: (id: string) => void;
  // 批量删除：检测书源时会一次删掉成百上千个，逐个 removeSource 会触发同等次数的
  // 持久化写入，直接把 JS 线程堵死，所以必须一次性 set。
  removeSources: (ids: string[]) => void;
  toggleSource: (id: string) => void;
  setAllSourcesEnabled: (enabled: boolean) => void;
  importSources: (list: BookSource[]) => number;
  bumpSourceHits: (ids: string[]) => void;
  // 书架
  addToShelf: (b: ShelfBook) => void;
  removeFromShelf: (bookUrl: string, sourceId: string) => void;
  updateProgress: (
    bookUrl: string,
    sourceId: string,
    chapterIndex: number,
    pos: number
  ) => void;
  cacheChapters: (bookUrl: string, sourceId: string, ch: BookChapter[]) => void;
  // 设置
  updateSettings: (patch: Partial<Settings>) => void;
}

function normalizeSource(s: BookSource): BookSource {
  return {
    ...s,
    _id: s.bookSourceUrl,
    // 已经是内部对象（比如检测后撤销删除、或从备份恢复）就沿用原来的启用状态，
    // 不要被 enabled 字段重置，否则用户手动停用过的源会莫名变回启用。
    _enabled:
      typeof s._enabled === 'boolean' ? s._enabled : s.enabled !== false,
  };
}

const defaultSettings: Settings = {
  theme: 'day',
  fontSize: 18,
  lineHeight: 1.8,
  paraIndent: true,
  paraGap: 0,
  linesPerPage: 18,
  bottomGapLines: 0,
  topGapLines: 1.5,
  pageMode: 'scroll',
  replaceRules: [],
  useSystemUA: true,
};

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      sources: [],
      shelf: [],
      settings: defaultSettings,
      sourceHits: {},
      fonts: [],

      addFont: (f) =>
        set((st) => ({ fonts: [...st.fonts.filter((x) => x.id !== f.id), f] })),

      // 删字体的同时把选中项退回系统默认，避免留下指向已删字体的 fontId
      removeFont: (id) =>
        set((st) => ({
          fonts: st.fonts.filter((x) => x.id !== id),
          settings:
            st.settings.fontId === id
              ? { ...st.settings, fontId: null }
              : st.settings,
        })),

      addSource: (s) =>
        set((st) => {
          const list = st.sources.filter((x) => x.bookSourceUrl !== s.bookSourceUrl);
          return { sources: [...list, normalizeSource(s)] };
        }),

      removeSource: (id) =>
        set((st) => ({ sources: st.sources.filter((x) => x._id !== id) })),

      removeSources: (ids) =>
        set((st) => {
          if (!ids.length) return {};
          const dead = new Set(ids);
          return { sources: st.sources.filter((x) => !dead.has(x._id!)) };
        }),

      toggleSource: (id) =>
        set((st) => ({
          sources: st.sources.map((x) =>
            x._id === id ? { ...x, _enabled: !x._enabled } : x
          ),
        })),

      // 一键全开 / 全关。一次 set 完成，避免逐个 toggle 触发 N 次持久化。
      setAllSourcesEnabled: (enabled) =>
        set((st) => ({
          sources: st.sources.map((x) =>
            x._enabled === enabled ? x : { ...x, _enabled: enabled }
          ),
        })),

      importSources: (list) => {
        let added = 0;
        const map = new Map(get().sources.map((s) => [s.bookSourceUrl, s]));
        for (const s of list) {
          if (!s.bookSourceUrl) continue;
          if (!map.has(s.bookSourceUrl)) {
            map.set(s.bookSourceUrl, normalizeSource(s));
            added++;
          }
        }
        set({ sources: Array.from(map.values()) });
        return added;
      },

      bumpSourceHits: (ids) =>
        set((st) => {
          if (!ids.length) return {};
          const next = { ...st.sourceHits };
          for (const id of ids) {
            // 封顶，避免老站永远压在新站前面
            next[id] = Math.min(999, (next[id] || 0) + 1);
          }
          return { sourceHits: next };
        }),

      addToShelf: (b) =>
        set((st) => {
          const exists = st.shelf.find(
            (x) => x.bookUrl === b.bookUrl && x.sourceId === b.sourceId
          );
          if (exists) {
            return {
              shelf: st.shelf.map((x) =>
                x.bookUrl === b.bookUrl && x.sourceId === b.sourceId
                  ? { ...x, lastReadAt: Date.now() }
                  : x
              ),
            };
          }
          const item: ShelfBook = {
            bookUrl: b.bookUrl,
            sourceId: b.sourceId,
            name: b.name,
            author: b.author,
            coverUrl: b.coverUrl,
            intro: b.intro,
            lastChapter: b.lastChapter,
            addedAt: Date.now(),
            lastReadAt: Date.now(),
            lastChapterIndex: 0,
            lastReadPos: 0,
          };
          return { shelf: [item, ...st.shelf] };
        }),

      removeFromShelf: (bookUrl, sourceId) =>
        set((st) => {
          const k = bookKey(bookUrl, sourceId);
          return { shelf: st.shelf.filter((x) => bookKey(x.bookUrl, x.sourceId) !== k) };
        }),

      updateProgress: (bookUrl, sourceId, chapterIndex, pos) =>
        set((st) => {
          const k = bookKey(bookUrl, sourceId);
          return {
            shelf: st.shelf.map((x) =>
              bookKey(x.bookUrl, x.sourceId) === k
                ? {
                    ...x,
                    lastChapterIndex: chapterIndex,
                    lastReadPos: pos,
                    lastReadAt: Date.now(),
                  }
                : x
            ),
          };
        }),

      cacheChapters: (bookUrl, sourceId, ch) =>
        set((st) => {
          const k = bookKey(bookUrl, sourceId);
          return {
            shelf: st.shelf.map((x) =>
              bookKey(x.bookUrl, x.sourceId) === k
                ? { ...x, cachedChapters: ch, cachedAt: Date.now() }
                : x
            ),
          };
        }),

      updateSettings: (patch) =>
        set((st) => ({ settings: { ...st.settings, ...patch } })),
    }),
    {
      name: 'yuan-reader-store',
      storage: createJSONStorage(() => AsyncStorage),
      version: 2,
      // 目录缓存不写进主 store：书架十本两千章能到几 MB，
      // 而 persist 每次 set（连翻页存进度）都要序列化整份数据，太大就写不进去，
      // 冷启动后缓存就没了 —— 表现为"每次打开都要重新解析目录"。
      // 目录改由 store/tocCache.ts 按书单独存。
      partialize: (st) =>
        ({
          ...st,
          shelf: st.shelf.map(({ cachedChapters, ...rest }) => rest),
        }) as State,
      // v1 时期段间距的默认值是「空 1 行」，在 22 号字下视觉上太空，
      // 已经在用户手机上存下来了，这里统一收回「紧贴」。
      migrate: (persisted: any, ver: number) => {
        if (ver < 2 && persisted && persisted.settings) {
          if (persisted.settings.paraGap === 1) persisted.settings.paraGap = 0;
        }
        return persisted as any;
      },
    }
  )
);
