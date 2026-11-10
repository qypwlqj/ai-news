import { NEWS_EXCERPT_MAX_CHARS, type NewsAuthor } from '@ai-news/contracts';
import type { Category, NewsItemRecord, Source } from './types';
import { CATEGORIES, SOURCE_VALUES } from './types';
import { DEFAULT_PAGE_SIZE, getNewsRepository, MAX_PAGE_SIZE, type NewsListResult } from './db/repository';

/** 与 category_enum / source_enum 一一对应的查询白名单；落库层枚举为唯一真源。 */
export const CATEGORY_VALUES = CATEGORIES.map(category => category.value);
export { SOURCE_VALUES };

export interface NewsQueryInput {
  date: string | null;
  category: Category | null;
  source: Source | null;
  page: number;
  limit: number;
  q?: string;
}

export interface NewsItemDto {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary: string | null;
  summaryStatus: string;
  category: string;
  titleFingerprint?: string;
  createdAt: string;
  originalTitle: string | null;
  excerpt: string | null;
  author: NewsAuthor | null;
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text : null;
}

/** 列表摘录：去首尾空白，超过 200 字按码点截断并加省略号；空白视为无原文。 */
export function excerptOf(raw: string | null | undefined): string | null {
  const text = nonEmpty(raw);
  if (!text) return null;
  const chars = Array.from(text);
  return chars.length > NEWS_EXCERPT_MAX_CHARS ? chars.slice(0, NEWS_EXCERPT_MAX_CHARS).join('') + '…' : text;
}

/** 作者只从入库 metadata 读取（X 采集写入 authorDisplayName/authorHandle），不臆造。 */
export function authorOf(metadata: Record<string, unknown> | null | undefined): NewsAuthor | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const handle = nonEmpty(metadata.authorHandle)?.replace(/^@/, '') || null;
  const name = nonEmpty(metadata.authorDisplayName) ?? handle;
  return name ? { name, handle } : null;
}

export interface NewsListResponse {
  items: NewsItemDto[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  date: string | null;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

function fail<T>(code: string, message: string): ParseResult<T> {
  return { ok: false, code, message };
}

/** date=YYYY-MM-DD 严格校验（不接受 2025-02-30 这类溢出日期）。 */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + 'T00:00:00.000Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** 非法枚举/格式一律 400，不静默忽略；缺省值：page=1、limit=20、不做日期过滤。 */
export function parseNewsQuery(params: URLSearchParams): ParseResult<NewsQueryInput> {
  const q = params.get('q')?.trim();
  if (q && q.length > 120) return fail('INVALID_QUERY', 'search must be at most 120 characters');
  const date = params.get('date');
  if (date !== null && !isIsoDate(date)) return fail('INVALID_DATE', 'date must be YYYY-MM-DD');

  const category = params.get('category');
  if (category !== null && !(CATEGORY_VALUES as readonly string[]).includes(category)) {
    return fail('INVALID_CATEGORY', 'category must be one of the fixed enum values');
  }

  const source = params.get('source');
  if (source !== null && !(SOURCE_VALUES as readonly string[]).includes(source)) {
    return fail('INVALID_SOURCE', 'source must be one of the fixed enum values');
  }

  const pageRaw = params.get('page');
  const page = pageRaw === null ? 1 : Number(pageRaw);
  if (!Number.isInteger(page) || page < 1) return fail('INVALID_PAGINATION', 'page must be an integer >= 1');

  const limitRaw = params.get('limit');
  const limit = limitRaw === null ? DEFAULT_PAGE_SIZE : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    return fail('INVALID_PAGINATION', 'limit must be an integer between 1 and ' + MAX_PAGE_SIZE);
  }

  return {
    ok: true,
    value: { date, category: category as Category | null, source: source as Source | null, page, limit, ...(q ? { q } : {}) },
  };
}

/** summary_status=failed 的条目照常返回，summary 降级为 null，不得隐藏。 */
export function toNewsItemDto(item: NewsItemRecord): NewsItemDto {
  return {
    id: item.id,
    title: item.title,
    url: item.url,
    source: item.source,
    publishedAt: item.publishedAt.toISOString(),
    summary: item.summary ?? null,
    summaryStatus: item.summaryStatus,
    category: item.category,
    titleFingerprint: item.titleFingerprint,
    createdAt: (item.createdAt ?? item.publishedAt).toISOString(),
    originalTitle: nonEmpty(item.originalTitle),
    excerpt: excerptOf(item.rawExcerpt),
    author: authorOf(item.metadata),
  };
}

export function toNewsListResponse(result: NewsListResult, date: string | null): NewsListResponse {
  // 列表接口约定至少回显 1 页（空结果也返回 totalPages=1、hasNext=false），
  // 与仓储层「无数据 totalPages=0」的内部语义区分开。
  const totalPages = Math.max(1, Math.ceil(result.total / result.limit));
  return {
    items: result.items.map(toNewsItemDto),
    page: result.page,
    limit: result.limit,
    total: result.total,
    totalPages,
    hasNext: result.page < totalPages,
    date,
  };
}

export async function listNews(params: URLSearchParams): Promise<ParseResult<NewsListResponse>> {
  const parsed = parseNewsQuery(params);
  if (!parsed.ok) return parsed;
  const { date, category, source, page, limit, q } = parsed.value;
  try {
    const result = await getNewsRepository().listNews({ date, category, source, page, limit, ...(q ? { q } : {}) });
    return { ok: true, value: toNewsListResponse(result, date) };
  } catch {
    return fail('INTERNAL_ERROR', 'failed to load news');
  }
}
