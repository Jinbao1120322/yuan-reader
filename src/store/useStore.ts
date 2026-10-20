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
  // 书源
  addSource: (s: BookSource) => void;
  removeSource: (id: string) => void;
  toggleSource: (id: string) => void;
  importSources: (list: BookSource[]) => number;
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
