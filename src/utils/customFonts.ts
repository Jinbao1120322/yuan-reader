import * as FileSystem from 'expo-file-system';
import * as Font from 'expo-font';
import { CustomFont } from '../store/useStore';
import { resolveFontUri, withFileName } from './fontPath';

/*
 * 自定义字体：导入 / 注册 / 删除
 * ===========================================================================
 * iOS 上运行时加载字体的标准路径是 CGFontCreateWithDataProvider +
 * CTFontManagerRegisterGraphicsFont（爱阅书香就是这么干的，反汇编里能看到这两个符号）。
 * expo-font 的 loadAsync 在 iOS 走的是同一套（CTFontManagerRegisterFontsForURL），
 * 并且它内部把「你给的 key」记成 alias，再 swizzle UIFont._expo_fontNames(forFamilyName:)，
 * 所以样式里直接写 fontFamily: alias 就能用 —— 不需要去解析字体文件里的真实 family 名。
 *
 * 字体文件必须复制到 App 沙盒：DocumentPicker 给的是临时缓存路径，重启就没了。
 * 但**只存文件名，不存绝对路径** —— iOS 每次更新 App，沙盒容器路径里的 UUID 会变，
 * 存绝对路径就会"更新一次字体就失效"（文件还在新容器里，老路径找不到）。
 */

const DIR = `${FileSystem.documentDirectory || ''}fonts/`;

export const FONT_ALIAS_PREFIX = 'YuanReaderFont';

/** 支持的类型（对应 iOS 的 CTFontManager，ttc 是字体集合） */
export const FONT_EXTS = ['ttf', 'otf', 'ttc', 'otc'] as const;

export function fontAlias(id: string): string {
  return `${FONT_ALIAS_PREFIX}_${id}`;
}

/** 字体文件的当前真实路径：永远按当前 documentDirectory 现拼 */
export function fontUri(f: CustomFont): string {
  return resolveFontUri(DIR, f);
}

export { withFileName };

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
  }
}

/**
 * 把用户选中的字体文件复制进沙盒并注册。
 * @param srcUri DocumentPicker 返回的临时地址
 * @param fileName 原始文件名，用来取扩展名和显示名
 */
export async function importFontFile(
  srcUri: string,
  fileName: string
): Promise<CustomFont> {
  const rawExt = (fileName.split('.').pop() || 'ttf').toLowerCase();
  const ext = (FONT_EXTS as readonly string[]).includes(rawExt) ? rawExt : 'ttf';

  await ensureDir();
  const id = `f${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const uri = `${DIR}${id}.${ext}`;
  await FileSystem.copyAsync({ from: srcUri, to: uri });

  const alias = fontAlias(id);
  try {
    await Font.loadAsync({ [alias]: { uri } });
  } catch (e) {
    // 注册失败就别留下垃圾文件
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    throw e;
  }

  return {
    id,
    alias,
    label: fileName.replace(/\.[^.]+$/, '') || '自定义字体',
    uri,
    file: `${id}.${ext}`,
  };
}

/** 重启 / 更新 App 后重新注册（字体注册只在本次进程内有效） */
export async function registerFont(f: CustomFont): Promise<void> {
  const uri = fontUri(withFileName(f));
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) throw new Error(`字体文件不存在：${f.label}`);
  await Font.loadAsync({ [f.alias]: { uri } });
}

export async function deleteFontFile(f: CustomFont): Promise<void> {
  await FileSystem.deleteAsync(fontUri(f), { idempotent: true }).catch(() => {});
}

/** 由 settings.fontId 找到当前该用的 fontFamily；没选或找不到就返回 null（跟随系统） */
export function currentFontFamily(
  fonts: CustomFont[],
  fontId?: string | null
): string | null {
  if (!fontId) return null;
  const f = fonts.find((x) => x.id === fontId);
  return f ? f.alias : null;
}
