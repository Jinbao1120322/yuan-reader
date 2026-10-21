/*
 * 字体文件路径
 * ===========================================================================
 * 单独放在这里是因为要给 customFonts.ts 和单测共用，不依赖 expo 模块。
 *
 * 关键背景：iOS 每次更新 App，沙盒容器的路径里有个 UUID 会变：
 *   /var/mobile/Containers/Data/Application/<UUID>/Documents/fonts/xxx.ttf
 * 如果把这个绝对路径存进本地，更新后就指向旧容器 —— 文件明明还在新容器里，
 * 却按老路径找不到，表现为「更新一次字体就失效，要重新导入」。
 *
 * 所以只存文件名，每次用「当前 documentDirectory + 文件名」现拼。
 */

export interface FontPathLike {
  uri?: string;
  file?: string;
}

/** 从字体记录里取出文件名（新数据用 file，老数据从绝对路径里截） */
export function fontFileName(f: FontPathLike): string {
  if (f.file) return f.file;
  const uri = String(f.uri || '');
  const tail = uri.split('/').pop() || '';
  return tail;
}

/** 用当前字体目录 + 文件名拼出真实路径 */
export function resolveFontUri(dir: string, f: FontPathLike): string {
  const name = fontFileName(f);
  if (!name) return String(f.uri || '');
  const base = dir.endsWith('/') ? dir : `${dir}/`;
  return `${base}${name}`;
}

/** 给老数据补上 file 字段 */
export function withFileName<T extends FontPathLike>(f: T): T {
  if (f.file) return f;
  const name = fontFileName(f);
  return name ? { ...f, file: name } : f;
}
