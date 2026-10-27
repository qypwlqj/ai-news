/**
 * 三来源采集适配器（Hacker News / ArXiv cs.AI / 机器之心）。
 *
 * 纯解析 + 可注入 fetch：端点、关键词与条数上限全部配置化，不读取环境变量、不含任何凭据。
 * publishedAt 统一输出 UTC 的 Date，由编排层决定入库字段。
 */

export const NEWS_SOURCE_IDS = ['hacker_news', 'arxiv_cs_ai', 'jiqizhixin'] as const;
export type NewsSourceId = (typeof NEWS_SOURCE_IDS)[number];

export interface RawNewsItem {
  source: NewsSourceId;
  title: string;
  originalTitle: string | null;
  url: string;
  externalId: string | null;
  publishedAt: Date;
  rawExcerpt: string | null;
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type SourceFetcher = (
  input: string,
  init?: { headers?: Record<string, string> },
) => Promise<FetchResponseLike>;

export interface SourceConfig {
  hackerNews: { endpoint: string; query: string; keywords: string[]; hitsPerPage: number };
  arxiv: { endpoint: string; maxResults: number };
  jiqizhixin: { feedUrl: string; maxItems: number };
}

/** 原文摘录/失败原因入参前截断上限（约 2000 字）。 */
export const MAX_EXCERPT_CHARS = 2000;

/** 「AI 相关」判定口径（需求待确认，先按标题关键词配置化实现，按单词边界匹配避免误命中）。 */
export const DEFAULT_AI_KEYWORDS = [
  'ai',
  'artificial intelligence',
  'llm',
  'gpt',
  'model',
  'agent',
  'openai',
  'anthropic',
  'deepmind',
  'diffusion',
  'transformer',
];

export const DEFAULT_SOURCE_CONFIG: SourceConfig = {
  hackerNews: {
    endpoint: 'https://hn.algolia.com/api/v1/search_by_date',
    query: 'AI',
    keywords: DEFAULT_AI_KEYWORDS,
    hitsPerPage: 50,
  },
  arxiv: {
    endpoint:
      'http://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=50',
    maxResults: 50,
  },
  jiqizhixin: {
    // 待确认项：具体 feed 地址由配置提供，此默认值仅作兜底。
    feedUrl: 'https://www.jiqizhixin.com/rss',
    maxItems: 40,
  },
};

export class SourceFetchError extends Error {
  constructor(
    readonly source: NewsSourceId,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SourceFetchError';
  }
}

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
};

function decodeEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(?:amp|lt|gt|quot|apos|#39|#\d+);/g, (entity) => {
      if (entity.startsWith('&#')) {
        const code = Number(entity.slice(2, -1));
        return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
      }
      return ENTITY_MAP[entity] ?? entity;
    });
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function firstTag(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  const text = match ? stripTags(match[1] ?? '') : '';
  return text.length > 0 ? text : null;
}

function splitEntries(xml: string, tag: 'item' | 'entry'): string[] {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  return [...xml.matchAll(pattern)].map((match) => match[1] ?? '');
}

function entryLink(entry: string): string | null {
  const href = /<link[^>]*href="([^"]+)"[^>]*>/i.exec(entry);
  if (href) return decodeEntities(href[1] ?? '').trim();
  const text = firstTag(entry, 'link');
  return text && /^https?:\/\//i.test(text) ? text : null;
}

function parseDate(value: unknown, now?: Date): Date {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  if (date && !Number.isNaN(date.getTime())) return date;
  return now ?? new Date();
}

function clampText(value: string | null): string | null {
  if (!value) return null;
  return value.length > MAX_EXCERPT_CHARS ? value.slice(0, MAX_EXCERPT_CHARS) : value;
}

function matchesKeyword(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
}

/** 解析 HN Algolia search_by_date 响应；仅保留命中关键词的 story。 */
export function parseHackerNews(
  payload: unknown,
  options: { keywords?: readonly string[]; maxItems?: number; now?: Date } = {},
): RawNewsItem[] {
  const hits = (payload as { hits?: unknown } | null | undefined)?.hits;
  if (!Array.isArray(hits)) return [];
  const keywords = options.keywords ?? DEFAULT_AI_KEYWORDS;
  const limit = options.maxItems ?? 50;
  const items: RawNewsItem[] = [];
  for (const hit of hits) {
    if (!hit || typeof hit !== 'object') continue;
    const row = hit as Record<string, unknown>;
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    if (!title || !keywords.some((keyword) => matchesKeyword(title, keyword))) continue;
    const id = typeof row.objectID === 'string' && row.objectID ? row.objectID : null;
    const url = typeof row.url === 'string' && /^https?:\/\//i.test(row.url)
      ? row.url
      : id
        ? `https://news.ycombinator.com/item?id=${id}`
        : null;
    if (!url) continue;
    items.push({
      source: 'hacker_news',
      title,
      originalTitle: title,
      url,
      externalId: id,
      publishedAt: parseDate(row.created_at, options.now),
      rawExcerpt: null,
    });
    if (items.length >= limit) break;
  }
  return items;
}

/** 解析 ArXiv cs.AI Atom feed。 */
export function parseArxivAtom(
  xml: string,
  options: { maxResults?: number; now?: Date } = {},
): RawNewsItem[] {
  return splitEntries(xml, 'entry')
    .slice(0, options.maxResults ?? 50)
    .flatMap<RawNewsItem>((entry) => {
      const title = firstTag(entry, 'title');
      const url = entryLink(entry);
      if (!title || !url) return [];
      return [
        {
          source: 'arxiv_cs_ai',
          title,
          originalTitle: title,
          url,
          externalId: firstTag(entry, 'id') ?? url,
          publishedAt: parseDate(firstTag(entry, 'published') ?? firstTag(entry, 'updated'), options.now),
          rawExcerpt: clampText(firstTag(entry, 'summary')),
        },
      ];
    });
}

/** 解析 RSS 2.0 或 Atom feed（机器之心）。 */
export function parseRssFeed(
  xml: string,
  options: { source?: NewsSourceId; maxItems?: number; now?: Date } = {},
): RawNewsItem[] {
  const source = options.source ?? 'jiqizhixin';
  const entries = [...splitEntries(xml, 'item'), ...splitEntries(xml, 'entry')];
  return entries.slice(0, options.maxItems ?? 40).flatMap<RawNewsItem>((entry) => {
    const title = firstTag(entry, 'title');
    const url = entryLink(entry);
    if (!title || !url) return [];
    return [
      {
        source,
        title,
        originalTitle: title,
        url,
        externalId: firstTag(entry, 'guid') ?? firstTag(entry, 'id') ?? url,
        publishedAt: parseDate(firstTag(entry, 'pubDate') ?? firstTag(entry, 'published'), options.now),
        rawExcerpt: clampText(
          firstTag(entry, 'description') ?? firstTag(entry, 'summary') ?? firstTag(entry, 'content:encoded'),
        ),
      },
    ];
  });
}

async function fetchText(fetcher: SourceFetcher, source: NewsSourceId, url: string): Promise<string> {
  const response = await fetcher(url, {
    headers: {
      accept: 'application/json, application/atom+xml, application/rss+xml, text/xml;q=0.9, */*;q=0.8',
    },
  });
  if (!response.ok) {
    throw new SourceFetchError(source, response.status, `${source} responded with ${response.status}`);
  }
  return response.text();
}

export async function collectHackerNews(
  fetcher: SourceFetcher,
  config: SourceConfig = DEFAULT_SOURCE_CONFIG,
): Promise<RawNewsItem[]> {
  const { endpoint, query, keywords, hitsPerPage } = config.hackerNews;
  const url = `${endpoint}?tags=story&query=${encodeURIComponent(query)}&hitsPerPage=${hitsPerPage}`;
  const body = await fetchText(fetcher, 'hacker_news', url);
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new SourceFetchError('hacker_news', 0, 'hacker_news returned invalid json');
  }
  return parseHackerNews(payload, { keywords, maxItems: hitsPerPage });
}

export async function collectArxiv(
  fetcher: SourceFetcher,
  config: SourceConfig = DEFAULT_SOURCE_CONFIG,
): Promise<RawNewsItem[]> {
  const { endpoint, maxResults } = config.arxiv;
  const body = await fetchText(fetcher, 'arxiv_cs_ai', endpoint);
  return parseArxivAtom(body, { maxResults });
}

export async function collectJiqizhixin(
  fetcher: SourceFetcher,
  config: SourceConfig = DEFAULT_SOURCE_CONFIG,
): Promise<RawNewsItem[]> {
  const { feedUrl, maxItems } = config.jiqizhixin;
  if (!feedUrl) {
    throw new SourceFetchError('jiqizhixin', 0, 'jiqizhixin feed url is not configured');
  }
  const body = await fetchText(fetcher, 'jiqizhixin', feedUrl);
  return parseRssFeed(body, { source: 'jiqizhixin', maxItems });
}

export type SourceCollector = () => Promise<RawNewsItem[]>;

/** 按来源装配采集器，供编排层逐源调用（重试与互斥由编排层负责）。 */
export function createSourceCollectors(
  fetcher: SourceFetcher,
  config: SourceConfig = DEFAULT_SOURCE_CONFIG,
): Record<NewsSourceId, SourceCollector> {
  return {
    hacker_news: () => collectHackerNews(fetcher, config),
    arxiv_cs_ai: () => collectArxiv(fetcher, config),
    jiqizhixin: () => collectJiqizhixin(fetcher, config),
  };
}

/** 默认 fetcher：直接使用运行时 fetch，便于测试注入替换。 */
export function createDefaultFetcher(): SourceFetcher {
  return (input, init) => globalThis.fetch(input, init);
}
