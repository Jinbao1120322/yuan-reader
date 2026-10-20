import { Buffer } from 'buffer';

// iconv-lite 运行期懒加载：避免它在模块加载期抛错拖垮 App 启动
type IconvModule = { decode: (buf: any, enc: string) => string };
let _iconv: IconvModule | null = null;
function iconvLib(): IconvModule {
  if (!_iconv) {
    const m: any = require('iconv-lite');
    _iconv = (m && m.decode ? m : (m && m.default) || m) as IconvModule;
  }
  return _iconv as IconvModule;
}

export const LOCAL_SOURCE_ID = '__local__';

export interface LocalBook {
  bookUrl: string; // 即文件 uri
  sourceId: string;
  name: string;
  author: string;
  intro?: string;
  chapters: { name: string; index: number }[];
}

// 章节切分正则：匹配「第xx章/回/卷/节」「卷xx」「序章」「引子」等常见标题
const CHAPTER_RE =
  /(?:\n|^)\s*(第[一二三四五六七八九十百千0-9]+[章回卷节部集幕]|序章|序言|引子|楔子|后记|番外|终章)\s*[^\n]*/g;

// 文件内容缓存（按 uri），避免重复读取大文件
const textCache = new Map<string, string>();
// 章节文本缓存（按 uri），key=uri
const chapterCache = new Map<string, string[]>();

// expo-file-system 懒加载（只在 fetch 读不了 file:// 时才用到）
function fsLib(): any {
  const m: any = require('expo-file-system');
  return m && m.default ? { ...m.default, ...m } : m;
}

// 读出文件原始字节。
// 优先 fetch（DocumentPicker 的 file:// 在多数环境下可用）；失败再退到
// expo-file-system 以 base64 读，兼容 fetch 不支持 file:// 的情况。
async function readBytes(uri: string): Promise<Buffer> {
  try {
    const resp = await fetch(uri);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const ab = await resp.arrayBuffer();
    return Buffer.from(ab);
  } catch (e) {
    const FS = fsLib();
    const b64: string = await FS.readAsStringAsync(uri, {
      encoding: FS.EncodingType.Base64,
    });
    return Buffer.from(b64, 'base64');
  }
}

export async function readLocalText(uri: string): Promise<string> {
  if (textCache.has(uri)) return textCache.get(uri)!;
  const bytes = await readBytes(uri);
  // 先按 utf-8 解码，若出现大量替换符则尝试 gbk
  let text = iconvLib().decode(bytes, 'utf-8');
  const bad = (text.match(/\ufffd/g) || []).length;
  if (bad > 20) {
    try {
      text = iconvLib().decode(bytes, 'gbk');
    } catch {
      /* keep utf-8 */
    }
  }
  textCache.set(uri, text);
  return text;
}

export function parseChapters(text: string): string[] {
  const matches = [...text.matchAll(CHAPTER_RE)];
  if (matches.length < 2) {
    // 没有清晰分章，退化为整本一段
    return [text.trim()];
  }
  const chapters: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index!;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const body = text.slice(start, end).trim();
    if (body) chapters.push(body);
  }
  return chapters;
}

export async function importLocalTxt(
  uri: string,
  fileName: string
): Promise<LocalBook> {
  const text = await readLocalText(uri);
  const chaptersText = parseChapters(text);
  chapterCache.set(uri, chaptersText);
  const name = fileName.replace(/\.txt$/i, '');
  return {
    bookUrl: uri,
    sourceId: LOCAL_SOURCE_ID,
    name,
    author: '本地',
    intro: `本地导入 · 共 ${chaptersText.length} 章`,
    chapters: chaptersText.map((_, i) => ({
      name: chapterTitle(chaptersText[i], i),
      index: i,
    })),
  };
}

export async function getLocalChapters(uri: string) {
  if (!chapterCache.has(uri)) {
    const text = await readLocalText(uri);
    const arr = parseChapters(text);
    chapterCache.set(uri, arr);
    return arr.map((_, i) => ({ name: chapterTitle(arr[i], i), index: i }));
  }
  const arr = chapterCache.get(uri)!;
  return arr.map((_, i) => ({ name: chapterTitle(arr[i], i), index: i }));
}

export async function getLocalChapterText(
  uri: string,
  index: number
): Promise<string> {
  let arr = chapterCache.get(uri);
  if (!arr) {
    const text = await readLocalText(uri);
    arr = parseChapters(text);
    chapterCache.set(uri, arr);
  }
  return arr[index] || '';
}

function chapterTitle(chunk: string, idx: number): string {
  const firstLine = chunk.split('\n')[0].trim();
  return firstLine.length > 0 ? firstLine.slice(0, 40) : `第 ${idx + 1} 段`;
}
