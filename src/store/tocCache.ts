import AsyncStorage from '@react-native-async-storage/async-storage';
import { BookChapter } from '../engine/types';

/*
 * 目录缓存（独立存储）
 * ===========================================================================
 * 为什么不放在主 store 里：
 * 书架里十本书、每本两千章，cachedChapters 加起来能到几 MB。而 zustand 的
 * persist 每次 set（翻页存进度都会 set）都要把**整个 store**（含全部书源规则）
 * 序列化写盘 —— 数据一大，写入就会失败或超时，冷启动后缓存就"不见了"，
 * 表现出来就是"每次打开 App 都要重新解析目录"。
 *
 * 所以目录按书单独存一个 key：读的时候只取当前这本书，写的时候只写这本书。
 */

const PREFIX = 'yuantoC:';
/** 缓存寿命：超过就重新拉，否则新章节永远看不到 */
export const TOC_TTL = 24 * 3600 * 1000;

export interface TocCacheEntry {
  at: number;
  chapters: BookChapter[];
}

export async function saveTocCache(key: string, chapters: BookChapter[]): Promise<void> {
  if (!key || !chapters || !chapters.length) return;
  try {
    const data: TocCacheEntry = { at: Date.now(), chapters };
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify(data));
  } catch {
    /* 存不下就算了，下次再拉一遍，不要影响阅读 */
  }
}

export async function loadTocCache(key: string): Promise<TocCacheEntry | null> {
  if (!key) return null;
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || !Array.isArray(o.chapters) || !o.chapters.length) return null;
    return { at: Number(o.at) || 0, chapters: o.chapters };
  } catch {
    return null;
  }
}

export async function clearTocCache(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}
