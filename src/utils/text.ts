/*
 * 文本判空
 * ===========================================================================
 * 为什么不用 `s.trim() === ''`：
 *   String.prototype.trim() 按 Unicode WhiteSpace 定义，**不包含零宽字符**
 *   （U+200B 零宽空格、U+200C/U+200D 连接符）、也不包含 U+200E/U+200F 方向标记。
 *   网络小说正文里这些字符非常常见（站点排版残留、HTML 实体转换产物）。
 *
 *   一页如果全是这类字符：
 *     '\u200b\u200b\u200b'.trim().length === 3   ← 非 0，被认为是"有内容的页"
 *   但它渲染出来什么都看不见 —— 表现就是「页脚显示 4/15，正文整页空白」。
 *
 * 所以判空必须自己扫一遍"视觉上是否真的什么都没有"。
 */

const INVISIBLE =
  /[\s\u00a0\u1680\u2000-\u200f\u2028\u2029\u202f\u205f\u3000\ufeff\u180e]/g;

/** 这一串文本在屏幕上一个可见字符都不会显示 → true */
export function isBlankText(text: string | null | undefined): boolean {
  if (!text) return true;
  return String(text).replace(INVISIBLE, '').length === 0;
}

/** 反过来：有可见内容 */
export function hasVisibleText(text: string | null | undefined): boolean {
  return !isBlankText(text);
}

/** 清掉零宽字符（用于净化正文，避免它们把一行"撑"成非空） */
export function stripInvisible(text: string): string {
  return String(text || '').replace(/[\u200b-\u200f\ufeff\u180e]/g, '');
}
