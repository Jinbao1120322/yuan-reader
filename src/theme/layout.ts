/*
 * 正文排版尺寸（唯一来源）
 * ===========================================================================
 * 这几个数字以前散在三处：ReaderScreen 的 styles.content、paginate 的入参、
 * PageCurlView 的 styles.page。任何一处改了另外两处没跟上，就会出「最后一行
 * 被裁掉半个字」或者「页面底部空一大块」——两种症状都是这么来的。
 * 以后改排版只改这里。
 */

export const PAGE_PAD_H = 20; // 左右内边距
export const PAGE_PAD_TOP = 6; // 正文上留白（压到很小，让正文尽量贴近顶栏）
export const PAGE_PAD_BOTTOM = 6; // 正文下留白（同上，底部尽量贴近工具栏）

/** 可排印宽度：容器宽减去左右内边距 */
export function pageTextWidth(areaW: number): number {
  return Math.max(1, areaW - PAGE_PAD_H * 2);
}

/** 可排印高度：容器高减去上下留白 */
export function pageTextHeight(areaH: number): number {
  return Math.max(1, areaH - PAGE_PAD_TOP - PAGE_PAD_BOTTOM);
}
