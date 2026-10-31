import type { FetchLike } from '../http';
import { fetchArxiv } from './arxiv';
import { fetchHackerNews } from './hackernews';
import { fetchJiqizhixin } from './jiqizhixin';

export type SourceId = 'hacker_news' | 'arxiv_cs_ai' | 'jiqizhixin';

/** 三个来源适配器的统一输出：编排层只依赖该结构，不感知各来源的解析细节。 */
export interface RawNewsItem {
  source: SourceId;
  /** 来源侧 ID（HN item id / arXiv id / RSS guid），用于来源内幂等；缺失时为 null */
  externalId: string | null;
  title: string;
  url: string;
  /** ISO8601 UTC */
  publishedAt: string;
  /** 正文/摘要原文片段，供 LLM 加工与排障，已截断 */
  excerpt: string | null;
}

export interface SourceFetchOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  retries?: number;
  /** 单来源本次最多返回条数，默认 60（≥ 验收要求的单日 20 条） */
  limit?: number;
  /** 固定「现在」，用于缺失发布时间兜底与测试 */
  now?: Date;
}

export type SourceFetcher = (options?: SourceFetchOptions) => Promise<RawNewsItem[]>;

export interface SourceAdapter {
  source: SourceId;
  label: string;
  fetchItems: SourceFetcher;
}

export const SOURCE_IDS: readonly SourceId[] = ['hacker_news', 'arxiv_cs_ai', 'jiqizhixin'];

export const SOURCE_LABELS: Readonly<Record<SourceId, string>> = {
  hacker_news: 'Hacker News',
  arxiv_cs_ai: 'ArXiv cs.AI',
  jiqizhixin: '机器之心',
};

export const DEFAULT_SOURCE_LIMIT = 60;

/** 来源注册表：新增来源只追加条目，不改动已有枚举值。 */
export const SOURCES: readonly SourceAdapter[] = [
  { source: 'hacker_news', label: SOURCE_LABELS.hacker_news, fetchItems: fetchHackerNews },
  { source: 'arxiv_cs_ai', label: SOURCE_LABELS.arxiv_cs_ai, fetchItems: fetchArxiv },
  { source: 'jiqizhixin', label: SOURCE_LABELS.jiqizhixin, fetchItems: fetchJiqizhixin },
];

export function isSourceId(value: string): value is SourceId {
  return (SOURCE_IDS as readonly string[]).includes(value);
}

export function getSourceAdapter(source: SourceId): SourceAdapter {
  const adapter = SOURCES.find((item) => item.source === source);
  if (!adapter) throw new Error(`unknown source: ${source}`);
  return adapter;
}

export async function fetchSource(
  source: SourceId,
  options: SourceFetchOptions = {},
): Promise<RawNewsItem[]> {
  return getSourceAdapter(source).fetchItems(options);
}

export async function fetchAllSources(
  options: SourceFetchOptions = {},
  sources: readonly SourceId[] = SOURCE_IDS,
): Promise<RawNewsItem[]> {
  const batches = await Promise.all(sources.map((source) => fetchSource(source, options)));
  return batches.flat();
}

export { fetchArxiv } from './arxiv';
export { fetchHackerNews } from './hackernews';
export { fetchJiqizhixin } from './jiqizhixin';
