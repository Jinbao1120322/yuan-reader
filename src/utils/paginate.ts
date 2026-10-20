/*
 * 分页：把一章正文切成若干页（仿真 / 滑动翻页用）
 * ===========================================================================
 * 这里做的是**按行装填**，不是按字符数硬切。
 *
 * 之前的写法是「先估算每页能放多少字，再按这个字数把字符串切一刀」，两个毛病：
 *   1. 切口落在行中间 → 那一页最后一行只有半句，页面底部再空一块
 *   2. 估算字宽偏小（以为每行能多放一个字）→ 真正渲染时挤爆，最后一个字
 *      被容器裁掉半个
 *
 * 现在先算出「每行几个字」「每页几行」，再逐行填：
 *   - 每行固定 charsPerLine 个字，用 '\n' 强制换行，渲染时不会再自行折行
 *   - 每页固定 linesPerPage 行，装满了才换页
 * 于是每页的行数、每行的字数都是确定的，既不会溢出被裁，也不会底部留白。
 */

export interface PaginateOpts {
  fontSize: number;
  lineHeight: number;
  width: number; // 可排印区宽度（已扣左右内边距）
  height: number; // 可排印区高度（已扣上下留白）
}

/**
 * 中文字宽相对字号的系数。
 * 全角汉字的 advance 实测约 0.94×fontSize（苹方/思源都是），
 * 取 0.95 留一点余量 —— 宁可一行少排一个字，也不能多排一个被裁掉。
 */
const CHAR_W_RATIO = 0.95;

export function paginate(text: string, opts: PaginateOpts): string[] {
  const { fontSize, lineHeight, width, height } = opts;
  if (!text || width <= 0 || height <= 0 || fontSize <= 0) return [''];

  const charW = fontSize * CHAR_W_RATIO;
  const charsPerLine = Math.max(1, Math.floor(width / charW));
  const lineH = fontSize * lineHeight;
  const linesPerPage = Math.max(1, Math.floor(height / lineH));

  // 按换行拆段，去掉行尾空白（段首空白保留，有些源用它做缩进）
  const paras = text.split(/\r?\n/).map((p) => p.replace(/\s+$/, ''));

  const pages: string[] = [];
  let lines: string[] = [];

  const flush = () => {
    if (lines.length) {
      pages.push(lines.join('\n'));
      lines = [];
    }
  };

  for (const p of paras) {
    if (!p) continue;
    // 一段先折成若干行，再逐行往当前页里塞
    for (let i = 0; i < p.length; i += charsPerLine) {
      if (lines.length >= linesPerPage) flush();
      lines.push(p.slice(i, i + charsPerLine));
    }
  }
  flush();

  return pages.length ? pages : [''];
}
