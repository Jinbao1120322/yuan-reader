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
/*
 * 正文下留白。刻意留得比上边宽很多（34pt ≈ 一个行高）：
 * 页脚那行「4/15 · 全书 x%」是**不透明底色**，正文只要溢出到底部就会被它盖住，
 * 看起来就是「最后几个字显示不出来」。宁可少排一行，也要保证正文永远到不了页脚。
 * 之前压到 6pt 追求"排满"，但 onTextLayout 报的行高比实际略小，
 * 几十行累积下来最后一行会顶出可排印区、被容器裁掉半截。
 * 与其精算到极限，不如让底部松半行 —— 视觉上完全看不出来，
 * 但保证每一行的下半截都完整。
 */
export const PAGE_PAD_BOTTOM = 6;

/*
 * 每页固定行数（用户 2026-10-21 明确要求）。
 * 之前是「按可用高度动态算能放几行」，但实测行高始终有零点几点的误差，
 * 累积到页尾就会把最后一行挤出可排印区、被页脚的不透明底色盖住。
 * 与其和误差较劲，不如直接钉死 18 行 —— 一行都不会多，一行也不会被遮。
 * 字号特别大导致 18 行放不下时，仍会被可用高度兜住（取两者较小值）。
 */
export const PAGE_FIXED_LINES = 18;

/** 可排印宽度：容器宽减去左右内边距 */
export function pageTextWidth(areaW: number): number {
  return Math.max(1, areaW - PAGE_PAD_H * 2);
}

/**
 * 可排印高度：容器高减去页眉、页脚和上下留白。
 * 页眉页脚可以关掉（showMeta = false），关掉时传 0 —— 正文就能一直排到边上。
 */
export function pageTextHeight(
  areaH: number,
  headerH: number = PAGE_HEADER_H,
  footerH: number = PAGE_FOOTER_H
): number {
  return Math.max(1, areaH - headerH - footerH - PAGE_PAD_TOP - PAGE_PAD_BOTTOM);
}
