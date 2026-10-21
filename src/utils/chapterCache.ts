import * as FileSystem from 'expo-file-system';

/*
 * 章节正文缓存
 * ===========================================================================
 * 正文一部书下来几 MB，绝不能塞进 AsyncStorage（那是给小配置用的，
 * 而且主 store 每次 set 都要整体序列化，塞正文进去会直接卡死）。
 * 这里一章一个文件，放在 Documents/chapters/ 下，按「书的哈希 + 章号」命名。
 *
 * 命名用哈希是为了避开非法字符：bookKey 里带 http:// 和各种中文书名，
 * 直接拼进文件名会失败；哈希之后固定是 [0-9a-z]_[序号].txt。
 */

const DIR = `${FileSystem.documentDirectory || ''}chapters/`;

/** 字符串 → 稳定短哈希（djb2 变体，碰撞概率对几十本书完全够用） */
function hashKey(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function fileOf(bookKey: string, idx: number): string {
  return `${DIR}${hashKey(bookKey)}_${idx}.txt`;
}

async function ensureDir(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
    }
  } catch {
    /* ignore */
  }
}

export async function saveChapter(
  bookKey: string,
  idx: number,
  text: string
): Promise<void> {
  if (!text) return;
  await ensureDir();
  try {
    await FileSystem.writeAsStringAsync(fileOf(bookKey, idx), text);
  } catch {
    /* 存不下就算了，下次还能再拉 */
  }
}

export async function loadChapter(
  bookKey: string,
  idx: number
): Promise<string | null> {
  try {
    const uri = fileOf(bookKey, idx);
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    const txt = await FileSystem.readAsStringAsync(uri);
    return txt && txt.length > 20 ? txt : null;
  } catch {
    return null;
  }
}

export async function hasChapter(bookKey: string, idx: number): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(fileOf(bookKey, idx));
    return !!info.exists;
  } catch {
    return false;
  }
}

/** 统计这本书已经缓存了多少章（传章节总数，逐章探一下） */
export async function countCached(
  bookKey: string,
  total: number
): Promise<number> {
  let n = 0;
  for (let i = 0; i < total; i++) {
    if (await hasChapter(bookKey, i)) n++;
  }
  return n;
}

/** 清掉整本书的正文缓存 */
export async function clearBookChapters(
  bookKey: string,
  total: number
): Promise<void> {
  const prefix = `${hashKey(bookKey)}_`;
  try {
    await ensureDir();
    const files = await FileSystem.readDirectoryAsync(DIR);
    await Promise.all(
      files
        .filter((f) => f.startsWith(prefix))
        .map((f) => FileSystem.deleteAsync(DIR + f, { idempotent: true }).catch(() => {}))
    );
  } catch {
    /* ignore */
  }
  // total 参数保留给以后做「只删前 N 章」，现在整本删干净
  void total;
}
