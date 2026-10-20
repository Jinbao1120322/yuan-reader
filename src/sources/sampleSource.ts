import { BookSource } from '../engine/types';

// 内置示例书源（飘天小说网，GBK 编码）。
// 注意：这是演示用的样例，站点结构可能随版本变化而失效；
// 推荐从社区导入成熟书源（App 内「书源管理 → 导入」粘贴 JSON 或 URL）。
// 字段命名与 Legado 官方一致，可直接替换为任意社区书源。
export const SAMPLE_SOURCE: BookSource = {
  bookSourceName: '示例·飘天小说(GBK演示)',
  bookSourceUrl: 'https://www.piaotian.com',
  bookSourceGroup: '演示',
  bookSourceType: 0,
  bookSourceComment: '示例书源，可能失效，请导入社区成熟书源',
  enabled: true,
  ruleSearch: {
    searchUrl: 'https://www.piaotian.com/modules/article/search.php?searchkey={{key}}',
    bookList: 'tr.odd, tr.even',
    name: 'td:eq(0) a@text',
    bookUrl: 'td:eq(0) a@href',
    author: 'td:eq(1)@text',
    kind: 'td:eq(2)@text',
    wordCount: 'td:eq(3)@text',
    lastChapter: 'td:eq(4)@text',
  },
  ruleBookInfo: {
    name: 'h1@text',
    author: 'div#info@text',
    intro: 'div#intro@text',
    tocUrl: 'a#chapterlist@href',
  },
  ruleToc: {
    chapterList: 'div#chapterlist a',
    chapterName: 'a@text',
    chapterUrl: 'a@href',
  },
  ruleContent: {
    content: 'div#chaptercontent@html',
  },
};
