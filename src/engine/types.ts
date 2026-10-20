// Legado / 开源阅读 书源数据结构（精简可运行子集）
// 字段命名尽量与官方保持一致，便于直接导入社区书源 JSON

export type BookSourceType = 0 | 1 | 2 | 3; // 0 图文 / 1 音频 / 2 图片 / 3 文件

export interface RuleSearch {
  bookList?: string;
  name?: string;
  author?: string;
  bookUrl?: string;
  coverUrl?: string;
  intro?: string;
  kind?: string;
  lastChapter?: string;
  wordCount?: string;
  searchUrl?: string; // 支持 {{key}} {{page}} 占位符
}

export interface RuleBookInfo {
  author?: string;
  coverUrl?: string;
  intro?: string;
  name?: string;
  tocUrl?: string; // 目录页地址（可留空，沿用 bookUrl）
  tocUrlNext?: string;
  wordCount?: string;
  kind?: string;
  lastChapter?: string;
}

export interface RuleToc {
  chapterList?: string;
  chapterName?: string;
  chapterUrl?: string;
  updateTime?: string;
  nextTocUrl?: string;
}

export interface RuleContent {
  content?: string; // 支持 ## 正则净化
  nextContentUrl?: string;
  replaceRegex?: string;
  imageStyle?: string;
}

export interface BookSource {
  bookSourceName: string;
  bookSourceUrl: string; // 唯一标识
  bookSourceGroup?: string;
  bookSourceType?: BookSourceType;
  bookSourceComment?: string;
  enabled?: boolean;
  customOrder?: number;
  loginUrl?: string;
  bookUrlPattern?: string;
  header?: string; // JSON 字符串: {"User-Agent":"..."}
  searchUrl?: string;
  ruleSearch?: RuleSearch;
  ruleBookInfo?: RuleBookInfo;
  ruleToc?: RuleToc;
  ruleContent?: RuleContent;
  // 本地扩展字段（非 Legado 标准，用于本 App 内部管理）
  _id?: string;
  _enabled?: boolean;
}

export interface SearchBook {
  name: string;
  author: string;
  bookUrl: string; // 相对或绝对，解析后存绝对地址
  coverUrl?: string;
  intro?: string;
  kind?: string;
  lastChapter?: string;
  wordCount?: string;
  sourceId: string; // bookSourceUrl
  sourceName: string;
}

export interface BookChapter {
  name: string;
  url: string; // 绝对地址
  index: number;
}

export interface BookInfo {
  name: string;
  author: string;
  coverUrl?: string;
  intro?: string;
  kind?: string;
  lastChapter?: string;
  wordCount?: string;
  bookUrl: string;
  tocUrl?: string;
  sourceId: string;
  sourceName: string;
}

export interface ChapterContent {
  content: string; // 已分段（按空行）
  nextContentUrl?: string;
}
