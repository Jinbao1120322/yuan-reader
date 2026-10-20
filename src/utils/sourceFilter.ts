import { BookSource } from '../engine/types';

/*
 * 书源列表筛选
 * ===========================================================================
 * 书源动辄上千个，靠翻是找不到的，所以支持按关键词过滤。
 * 关键词同时匹配 **名称 / 地址 / 分组** —— 用户可能记得「那个带 '69shu' 的源」，
 * 也可能只记得分组叫「女频」。
 */

export type SourceFilter = 'all' | 'on' | 'off';

export function matchSource(s: BookSource, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  return (
    (s.bookSourceName || '').toLowerCase().includes(q) ||
    (s.bookSourceUrl || '').toLowerCase().includes(q) ||
    (s.bookSourceGroup || '').toLowerCase().includes(q)
  );
}

export function filterSources(
  sources: BookSource[],
  filter: SourceFilter,
  query: string
): BookSource[] {
  let list = sources;
  if (filter === 'on') list = list.filter((s) => s._enabled);
  else if (filter === 'off') list = list.filter((s) => !s._enabled);

  const q = query.trim();
  if (!q) return list;
  return list.filter((s) => matchSource(s, q));
}
