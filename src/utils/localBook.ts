import iconv from 'iconv-lite';

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

export async function readLocalText(uri: string): Promise<string> {
  if (textCache.has(uri)) return textCache.get(uri)!;
  const resp = await fetch(uri);
  const buf = await resp.arrayBuffer();
  // 先按 utf-8 解码，若出现大量替换符则尝试 gbk
  let text = iconv.decode(Buffer.from(buf), 'utf-8');
  const bad = (text.match(/\ufffd/g) || []).length;
  if (bad > 20) {
    try {
      text = iconv.decode(Buffer.from(buf), 'gbk');
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
