/*
 * 正文排版尺寸（唯一来源）
 * ===========================================================================
 * 这几个数字以前散在三处：ReaderScreen 的 styles.content、paginate 的入参、
 * PageCurlView 的 styles.page。任何一处改了另外两处没跟上，就会出「最后一行
 * 被裁掉半个字」或者「页面底部空一大块」——两种症状都是这么来的。
 * 以后改排版只改这里。
 */

export const PAGE_PAD_H = 18; // 左右内边距

/*
 * 页眉 / 页脚（阅读界面顶部那行「章节名 · 书名」和底部那行「进度 · 电量」）
 * 按目标机 iPhone Air（420×912pt）算：22pt 刚好放一行 10.5pt 的小字，不挤。
 */
export const PAGE_HEADER_H = 22;
export const PAGE_FOOTER_H = 22;
export const PAGE_PAD_TOP = 6; // 正文上留白（压到很小，让正文尽量贴近顶栏）
export const PAGE_PAD_BOTTOM = 6; // 正文下留白（同上，底部尽量贴近工具栏）

/** 可排印宽度：容器宽减去左右内边距 */
export function pageTextWidth(areaW: number): number {
  return Math.max(1, areaW - PAGE_PAD_H * 2);
}

/** 可排印高度：容器高减去页眉、页脚和上下留白 */
export function pageTextHeight(areaH: number): number {
  return Math.max(
    1,
    areaH - PAGE_HEADER_H - PAGE_FOOTER_H - PAGE_PAD_TOP - PAGE_PAD_BOTTOM
  );
}
