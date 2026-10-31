import { fetchText } from '../http';
import type { RawNewsItem, SourceFetchOptions } from './index';
import {
  firstTag,
  sortByPublishedAtDesc,
  splitBlocks,
  stripTags,
  toFetchOptions,
  toIsoDate,
  truncate,
} from './parse';

export const ARXIV_API = 'https://export.arxiv.org/api/query';
export const ARXIV_AI_QUERY = 'cat:cs.AI';
export const ARXIV_MAX_RESULTS = 100;

export interface ArxivFetchOptions extends SourceFetchOptions {
  /** 覆盖默认检索式（默认只取 cs.AI 分类） */
  searchQuery?: string;
}

const ARXIV_ABS_PREFIX = /^https?:\/\/(?:www\.|export\.)?arxiv\.org\/abs\//i;

/** 解析 Atom feed；externalId 取不含版本号的 arXiv id，保证同一论文多次提交幂等。 */
export function parseArxivFeed(xml: string, options: ArxivFetchOptions = {}): RawNewsItem[] {
  const limit = options.limit ?? 60;
  const now = options.now ?? new Date();
  const items: RawNewsItem[] = [];

  for (const entry of splitBlocks(xml, 'entry')) {
    const rawId = stripTags(firstTag(entry, 'id'));
    const title = stripTags(firstTag(entry, 'title'));
    if (!rawId || !title) continue;
    const id = rawId.replace(ARXIV_ABS_PREFIX, '').replace(/v\d+$/i, '').trim();
    if (!id) continue;
    const excerpt = stripTags(firstTag(entry, 'summary'));
    const published = stripTags(firstTag(entry, 'published')) || stripTags(firstTag(entry, 'updated'));
    items.push({
      source: 'arxiv_cs_ai',
      externalId: id,
      title,
      url: `https://arxiv.org/abs/${id}`,
      publishedAt: toIsoDate(published, now),
      excerpt: excerpt ? truncate(excerpt) : null,
    });
  }
  return sortByPublishedAtDesc(items).slice(0, limit);
}

export async function fetchArxiv(options: ArxivFetchOptions = {}): Promise<RawNewsItem[]> {
  const searchQuery = options.searchQuery ?? ARXIV_AI_QUERY;
  const url =
    `${ARXIV_API}?search_query=${encodeURIComponent(searchQuery)}` +
    `&start=0&max_results=${ARXIV_MAX_RESULTS}&sortBy=submittedDate&sortOrder=descending`;
  const xml = await fetchText(
    url,
    toFetchOptions(options, { accept: 'application/atom+xml, application/xml;q=0.9' }),
  );
  return parseArxivFeed(xml, options);
}
