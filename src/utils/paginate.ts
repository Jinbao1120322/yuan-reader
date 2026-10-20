// 按可用排版区尺寸，把一章正文估算切分成多页（用于仿真/滑动翻页）
// 这是「估算分页」：以中文字约等宽为前提，按每行字数 × 每页行数切分，
// 保留段落完整，必要时整段顺延到下一页。

export interface PaginateOpts {
  fontSize: number;
  lineHeight: number;
  width: number; // 可排印区宽度（已扣除左右 padding）
  height: number; // 可排印区高度（已扣除上下 padding）
}

export function paginate(text: string, opts: PaginateOpts): string[] {
  const { fontSize, lineHeight, width, height } = opts;
  if (!text || width <= 0 || height <= 0) return [''];

  const lineH = fontSize * lineHeight;
  // 中文近似等宽，按 0.95 字宽留一点余量，避免末行溢出
  const charsPerLine = Math.max(1, Math.floor(width / (fontSize * 0.95)));
  const linesPerPage = Math.max(1, Math.floor(height / lineH));
  // 整体再留 6% 余量，防止行高/字宽估算偏差导致溢出到下一页区域
  const cap = Math.floor(charsPerLine * linesPerPage * 0.94);

  // 按空行/换行拆分段落
  const paras = text.split(/\n+/).map((p) => p.replace(/\s+$/g, ''));
  const pages: string[] = [];
  let buf = '';
  let count = 0;

  for (const p of paras) {
    if (!p) continue;
    if (count === 0) {
      buf = p;
      count = p.length;
    } else if (count + 1 + p.length <= cap) {
      buf += '\n' + p;
      count += 1 + p.length;
    } else {
      pages.push(buf);
      buf = p;
      count = p.length;
    }
    // 超长单段：按 cap 截断多页
    while (buf.length > cap) {
      pages.push(buf.slice(0, cap));
      buf = buf.slice(cap);
      count = buf.length;
    }
  }
  if (buf) pages.push(buf);

  return pages.length ? pages : [''];
}
