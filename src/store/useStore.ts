import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BookSource, BookInfo, BookChapter } from '../engine/types';

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
}

export type ThemeKey = 'day' | 'night' | 'green' | 'paper';
export type PageMode = 'cover' | 'simulate' | 'slide' | 'scroll';

export interface ReplaceRule {
  pattern: string;
  replacement: string;
  isRegex: boolean;
}

export interface Settings {
  theme: ThemeKey;
  fontSize: number;
  lineHeight: number;
  bgColor?: string;
  pageMode: PageMode;
  replaceRules: ReplaceRule[];
  useSystemUA: boolean;
}

interface State {
  sources: BookSource[];
  shelf: ShelfBook[];
  settings: Settings;
  // 各书源历史命中次数：搜索时用来把「活着、能出结果」的源排到队首，
  // 用户不用先等几百个死站跑完才看到第一批结果
  sourceHits: Record<string, number>;
  // 书源
  addSource: (s: BookSource) => void;
  removeSource: (id: string) => void;
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
    _enabled: s.enabled !== false,
  };
}

const defaultSettings: Settings = {
  theme: 'day',
  fontSize: 18,
  lineHeight: 1.8,
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

      addSource: (s) =>
        set((st) => {
          const list = st.sources.filter((x) => x.bookSourceUrl !== s.bookSourceUrl);
          return { sources: [...list, normalizeSource(s)] };
        }),

      removeSource: (id) =>
        set((st) => ({ sources: st.sources.filter((x) => x._id !== id) })),

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
        set((st) => ({
          shelf: st.shelf.filter(
            (x) => !(x.bookUrl === bookUrl && x.sourceId === sourceId)
          ),
        })),

      updateProgress: (bookUrl, sourceId, chapterIndex, pos) =>
        set((st) => ({
          shelf: st.shelf.map((x) =>
            x.bookUrl === bookUrl && x.sourceId === sourceId
              ? {
                  ...x,
                  lastChapterIndex: chapterIndex,
                  lastReadPos: pos,
                  lastReadAt: Date.now(),
                }
              : x
          ),
        })),

      cacheChapters: (bookUrl, sourceId, ch) =>
        set((st) => ({
          shelf: st.shelf.map((x) =>
            x.bookUrl === bookUrl && x.sourceId === sourceId
              ? { ...x, cachedChapters: ch }
              : x
          ),
        })),

      updateSettings: (patch) =>
        set((st) => ({ settings: { ...st.settings, ...patch } })),
    }),
    {
      name: 'yuan-reader-store',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
    }
  )
);
