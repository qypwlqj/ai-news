import { fetchJson } from '../http';
import type { RawNewsItem, SourceFetchOptions } from './index';
import { sortByPublishedAtDesc, stripTags, toFetchOptions, toIsoDate, truncate } from './parse';

/** HN 无 AI 板块：走 Algolia 按时间检索，再用关键词做一次「AI 相关」判定。 */
export const HACKER_NEWS_API = 'https://hn.algolia.com/api/v1/search_by_date';
export const HACKER_NEWS_PAGE_SIZE = 200;

export const HACKER_NEWS_AI_KEYWORDS: readonly string[] = [
  'ai',
  'agi',
  'llm',
  'gpt',
  'chatgpt',
  'openai',
  'anthropic',
  'claude',
  'gemini',
  'deepmind',
  'machine learning',
  'deep learning',
  'neural',
  'transformer',
  'diffusion',
  'embedding',
  'inference',
  'fine-tuning',
  'multimodal',
  'agent',
  'rag',
  'mistral',
  'llama',
];

export interface HackerNewsFetchOptions extends SourceFetchOptions {
  /** Algolia 检索词，默认 `AI` */
  query?: string;
  /** 覆盖默认 AI 关键词表 */
  keywords?: readonly string[];
}

interface AlgoliaHit {
  objectID?: string | number | null;
  title?: string | null;
  url?: string | null;
  story_url?: string | null;
  created_at?: string | null;
  story_text?: string | null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 词边界匹配，避免 storage 命中 rag、chair 命中 ai 之类的误判。 */
export function isAiRelated(
  text: string,
  keywords: readonly string[] = HACKER_NEWS_AI_KEYWORDS,
): boolean {
  return keywords.some((keyword) =>
    new RegExp(`(^|[^a-z0-9])${escapeRegExp(keyword)}([^a-z0-9]|$)`, 'i').test(text),
  );
}

export function parseHackerNews(
  payload: unknown,
  options: HackerNewsFetchOptions = {},
): RawNewsItem[] {
  const keywords = options.keywords ?? HACKER_NEWS_AI_KEYWORDS;
  const limit = options.limit ?? 60;
  const now = options.now ?? new Date();
  const hits = (payload as { hits?: unknown } | null)?.hits;
  if (!Array.isArray(hits)) return [];

  const items: RawNewsItem[] = [];
  for (const raw of hits) {
    const hit = raw as AlgoliaHit;
    const title = stripTags(hit.title ?? '');
    const objectId = hit.objectID === null || hit.objectID === undefined ? '' : String(hit.objectID);
    const url =
      (hit.url ?? hit.story_url ?? '').trim() ||
      (objectId ? `https://news.ycombinator.com/item?id=${objectId}` : '');
    if (!title || !url) continue;
    const excerpt = stripTags(hit.story_text ?? '');
    if (!isAiRelated(`${title} ${excerpt}`, keywords)) continue;
    items.push({
      source: 'hacker_news',
      externalId: objectId || null,
      title,
      url,
      publishedAt: toIsoDate(hit.created_at ?? undefined, now),
      excerpt: excerpt ? truncate(excerpt) : null,
    });
  }
  return sortByPublishedAtDesc(items).slice(0, limit);
}

export async function fetchHackerNews(
  options: HackerNewsFetchOptions = {},
): Promise<RawNewsItem[]> {
  const query = options.query ?? 'AI';
  const url = `${HACKER_NEWS_API}?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${HACKER_NEWS_PAGE_SIZE}`;
  const payload = await fetchJson<unknown>(url, toFetchOptions(options, { accept: 'application/json' }));
  return parseHackerNews(payload, options);
}
