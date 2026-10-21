/*
 * 正文排版格式化
 * ===========================================================================
 * 这一步只做「文本层面」的事：首行缩进、段落之间留空。
 * 关键在于**测量层和渲染层必须用同一份结果** —— 否则分页按一种文本算、
 * 显示另一种，页尾就会错位。
 *
 * 首行缩进用两个全角空格（U+3000）。RN 的 Text 不支持 text-indent，
 * 用前缀空格是最稳的跨字体做法（全角空格在中文字体里都是整字宽）。
 */

import { isBlankText, stripInvisible } from './text';

export interface TypesetOpts {
  /** 段首缩进两字 */
  indent?: boolean;
  /** 段落之间空几行（0 = 紧贴，1 = 空一行） */
  paraGap?: number;
}

const INDENT = '\u3000\u3000';

export function typeset(text: string, opts: TypesetOpts = {}): string {
  const indent = opts.indent === false ? '' : INDENT;
  const gap = Math.max(0, Math.min(3, opts.paraGap ?? 1));

  // 用 isBlankText 而不是 p.length > 0：只有零宽字符的段落要剔掉，
  // 否则它会变成一个"看不见的段落"，进而撑出一整页空白。
  // 先把零宽字符清掉：它们不占视觉宽度，但会被排版引擎当成"一个字符"，
  // 撑出行宽偏差、也可能让一整页"看起来有内容其实是空白"。
  const paras = stripInvisible(String(text || ''))
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter((p) => !isBlankText(p));

  if (!paras.length) return '';

  const sep = '\n'.repeat(gap + 1);
  return paras.map((p) => indent + p).join(sep);
}

/**
 * 切页后清理：页首页尾如果正好落在段落之间的空行上，会多出几条空白，
 * 看起来像"页面底部又空了"。这里把首尾的空行去掉，页内空行保留。
 */
export function trimPageEdges(page: string): string {
  return String(page || '')
    .replace(/^(?:\s*\n)+/, '')
    .replace(/(?:\n\s*)+$/, '');
}
