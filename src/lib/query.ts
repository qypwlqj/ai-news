import type { Category, NewsItemRecord, Source } from './types';
import { DEFAULT_PAGE_SIZE, getNewsRepository, MAX_PAGE_SIZE, type NewsListResult } from './db/repository';

/** 与 category_enum / source_enum 一一对应的查询白名单；落库层枚举为唯一真源。 */
export const CATEGORY_VALUES = [
  'model_release',
  'research_paper',
  'product_application',
  'industry_news',
  'policy_funding',
] as const;

export const SOURCE_VALUES = ['hacker_news', 'arxiv_cs_ai', 'jiqizhixin'] as const;

export interface NewsQueryInput {
  date: string | null;
  category: Category | null;
  source: Source | null;
  page: number;
  limit: number;
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
    value: { date, category: category as Category | null, source: source as Source | null, page, limit },
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
    createdAt: item.createdAt.toISOString(),
  };
}

export function toNewsListResponse(result: NewsListResult, date: string | null): NewsListResponse {
  const totalPages = Math.ceil(result.total / result.limit);
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
  const { date, category, source, page, limit } = parsed.value;
  try {
    const result = await getNewsRepository().listNews({ date, category, source, page, limit });
    return { ok: true, value: toNewsListResponse(result, date) };
  } catch {
    return fail('INTERNAL_ERROR', 'failed to load news');
  }
}
