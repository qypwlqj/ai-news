/**
 * ArXiv cs.AI（Atom）与机器之心（RSS）采集器。
 *
 * - 解析为纯函数，无 IO、无环境变量、不含任何凭据；
 * - feed 地址与条数上限全部来自配置对象（默认值可被注入覆盖）；
 * - 输出统一 Collector 结果 `{ items, skipped }`，非法/缺失字段逐条跳过并计数，
 *   单条异常不影响整源，抓取失败由编排层重试与兜底。
 */

export type CollectorSourceValue = 'hacker_news' | 'arxiv_cs_ai' | 'jiqizhixin';

export interface CollectorItem {
  source: CollectorSourceValue;
  externalId: string | null;
  title: string;
  url: string;
  publishedAt: Date;
  rawExcerpt: string | null;
}

export interface CollectorResult {
  items: CollectorItem[];
  skipped: number;
}

export type CollectorFetcher = (url: string) => Promise<string>;

export interface FeedCollectorConfig {
  feedUrl: string;
  maxItems: number;
}

export interface FeedCollector {
  source: CollectorSourceValue;
  fetchItems(fetcher: CollectorFetcher): Promise<CollectorResult>;
}

export const RAW_EXCERPT_MAX_CHARS = 2000;

export const DEFAULT_ARXIV_CONFIG: FeedCollectorConfig = {
  feedUrl: 'https://rss.arxiv.org/atom/cs.AI',
  maxItems: 50,
};

export const DEFAULT_JIQIZHIXIN_CONFIG: FeedCollectorConfig = {
  feedUrl: 'https://www.jiqizhixin.com/rss',
  maxItems: 50,
};

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** 解码常见 XML 实体与数字实体，未知实体原样保留。 */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, code: string) => {
    if (/^#x/i.test(code)) {
      const value = Number.parseInt(code.slice(2), 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    if (code.startsWith('#')) {
      const value = Number.parseInt(code.slice(1), 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/**
 * 去 CDATA、解码实体、去标签并压缩空白。
 * Atom 的 summary 常把 HTML 再转义一层（`&lt;p&gt;…&lt;/p&gt;`），
 * 因此先解码再剥离标签，并重复一轮以兼容双重转义。
 */
export function stripHtml(input: string): string {
  let text = input.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  for (let pass = 0; pass < 2; pass += 1) {
    text = decodeEntities(text).replace(/<[^>]*>/g, ' ');
  }
  return text.replace(/\s+/g, ' ').trim();
}

function readTag(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  return match ? match[1] : null;
}

function readLinkHref(block: string): string | null {
  const tags = block.match(/<link\b[^>]*>/gi) ?? [];
  let fallback: string | null = null;
  for (const tag of tags) {
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    if (/rel\s*=\s*["']alternate["']/i.test(tag)) return href;
    fallback ??= href;
  }
  return fallback;
}

function toHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

export function truncateExcerpt(text: string, max = RAW_EXCERPT_MAX_CHARS): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, Math.max(1, max));
}

function normalizeMaxItems(value: number, fallback: number): number {
  // 显式传入 0 表示不取任何条目；仅缺失/非法值才回退到默认上限。
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function arxivExternalId(url: string): string | null {
  const absIndex = url.indexOf('/abs/');
  const tail = absIndex >= 0 ? url.slice(absIndex + '/abs/'.length) : url.split('/').filter(Boolean).pop() ?? '';
  const id = tail.replace(/[?#].*$/, '').trim();
  return id || null;
}

function toArxivItem(entry: string): CollectorItem | null {
  const rawTitle = readTag(entry, 'title');
  const title = rawTitle ? stripHtml(rawTitle) : '';
  const url = toHttpUrl(readTag(entry, 'id') ?? readLinkHref(entry));
  const publishedAt = parseDate(readTag(entry, 'published') ?? readTag(entry, 'updated'));
  if (!title || !url || !publishedAt) return null;
  const summary = readTag(entry, 'summary');
  return {
    source: 'arxiv_cs_ai',
    externalId: arxivExternalId(url),
    title,
    url,
    publishedAt,
    rawExcerpt: summary ? truncateExcerpt(stripHtml(summary)) : null,
  };
}

function toRssItem(block: string): CollectorItem | null {
  const rawTitle = readTag(block, 'title');
  const title = rawTitle ? stripHtml(rawTitle) : '';
  const url = toHttpUrl(readTag(block, 'link') ?? readTag(block, 'guid'));
  const publishedAt = parseDate(readTag(block, 'pubDate') ?? readTag(block, 'dc:date'));
  if (!title || !url || !publishedAt) return null;
  const description = readTag(block, 'description') ?? readTag(block, 'summary');
  const guid = readTag(block, 'guid');
  return {
    source: 'jiqizhixin',
    externalId: guid ? stripHtml(guid) || null : null,
    title,
    url,
    publishedAt,
    rawExcerpt: description ? truncateExcerpt(stripHtml(description)) : null,
  };
}

function parseFeedBlocks(
  xml: string,
  pattern: RegExp,
  toItem: (block: string) => CollectorItem | null,
  maxItems: number,
): CollectorResult {
  const blocks = xml.match(pattern) ?? [];
  const limit = normalizeMaxItems(maxItems, 50);
  const items: CollectorItem[] = [];
  let skipped = 0;
  for (const block of blocks) {
    let item: CollectorItem | null = null;
    try {
      item = toItem(block);
    } catch {
      item = null;
    }
    if (!item) {
      skipped += 1;
      continue;
    }
    if (items.length < limit) items.push(item);
  }
  return { items, skipped };
}

/** 解析 ArXiv Atom feed；缺标题 / 非 http(s) 链接 / 非法时间的条目跳过并计入 skipped。 */
export function parseArxivFeed(xml: string, maxItems = DEFAULT_ARXIV_CONFIG.maxItems): CollectorResult {
  return parseFeedBlocks(xml, /<entry\b[\s\S]*?<\/entry>/gi, toArxivItem, maxItems);
}

/** 解析机器之心 RSS feed；规则同上，外部 ID 取 guid。 */
export function parseJiqizhixinFeed(xml: string, maxItems = DEFAULT_JIQIZHIXIN_CONFIG.maxItems): CollectorResult {
  return parseFeedBlocks(xml, /<item\b[\s\S]*?<\/item>/gi, toRssItem, maxItems);
}

/** ArXiv cs.AI 采集器：fetcher 注入，抓取失败向上抛出由编排层重试。 */
export function createArxivCollector(config: FeedCollectorConfig = DEFAULT_ARXIV_CONFIG): FeedCollector {
  return {
    source: 'arxiv_cs_ai',
    async fetchItems(fetcher: CollectorFetcher): Promise<CollectorResult> {
      const xml = await fetcher(config.feedUrl);
      return parseArxivFeed(xml, config.maxItems);
    },
  };
}

/** 机器之心采集器：feed 地址配置化（默认值可用配置覆盖）。 */
export function createJiqizhixinCollector(
  config: FeedCollectorConfig = DEFAULT_JIQIZHIXIN_CONFIG,
): FeedCollector {
  return {
    source: 'jiqizhixin',
    async fetchItems(fetcher: CollectorFetcher): Promise<CollectorResult> {
      const xml = await fetcher(config.feedUrl);
      return parseJiqizhixinFeed(xml, config.maxItems);
    },
  };
}
