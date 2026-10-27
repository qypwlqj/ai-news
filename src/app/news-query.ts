import { CATEGORIES } from './news-constants';
import { isIsoDate, shanghaiDayRangeUtc } from './news-date';

/**
 * 查询层纯函数：HTTP 查询参数 → 仓储查询条件 → 契约响应体。
 * 无 IO、无环境变量；非法参数返回稳定错误码（不静默忽略、不做模糊匹配）。
 */

export const NEWS_SOURCE_VALUES = ['hacker_news', 'arxiv_cs_ai', 'jiqizhixin'] as const;
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export type NewsSource = (typeof NEWS_SOURCE_VALUES)[number];
export type QueryParams = Record<string, string | string[] | undefined> | URLSearchParams;
export type QueryErrorCode =
  | 'INVALID_DATE'
  | 'INVALID_CATEGORY'
  | 'INVALID_SOURCE'
  | 'INVALID_PAGINATION';

export interface NewsListQuery {
  /** 回显生效的日期过滤（未传为 null）。 */
  date: string | null;
  /** Asia/Shanghai 自然日换算出的 UTC 半开区间 [startUtc, endUtc)，未传日期为 null。 */
  startUtc: Date | null;
  endUtc: Date | null;
  category: string | null;
  source: string | null;
  page: number;
  limit: number;
}

export type NewsListQueryResult =
  | { ok: true; query: NewsListQuery }
  | { ok: false; code: QueryErrorCode; message: string };

/** 列表/详情响应所需的最小行结构（与 GET /api/news 字段集合一致）。 */
export interface NewsRowLike {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary: string | null;
  summaryStatus: string;
  category: string;
  createdAt?: string | null;
}

export function readQueryParam(params: QueryParams, key: string): string | null {
  if (params instanceof URLSearchParams) {
    const value = params.get(key);
    return value && value.trim().length > 0 ? value.trim() : null;
  }
  const raw = params[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function toPositiveInt(value: string | null, fallback: number): number | null {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

/** page ≥ 1（默认 1）、limit 1..100（默认 20）；非法返回 null。 */
export function parsePaging(params: QueryParams): { page: number; limit: number } | null {
  const page = toPositiveInt(readQueryParam(params, 'page'), 1);
  const limit = toPositiveInt(readQueryParam(params, 'limit'), DEFAULT_PAGE_LIMIT);
  if (page === null || limit === null || limit > MAX_PAGE_LIMIT) return null;
  return { page, limit };
}

/** GET /api/news 的参数解析：任一非法值即整体判失败，由调用方映射 400。 */
export function parseNewsListQuery(params: QueryParams = {}): NewsListQueryResult {
  const paging = parsePaging(params);
  if (!paging) {
    return {
      ok: false,
      code: 'INVALID_PAGINATION',
      message: 'page must be >= 1 and limit within 1..100',
    };
  }
  const date = readQueryParam(params, 'date');
  if (date !== null && !isIsoDate(date)) {
    return { ok: false, code: 'INVALID_DATE', message: 'date must be YYYY-MM-DD' };
  }
  const category = readQueryParam(params, 'category');
  if (category !== null && !CATEGORIES.some((item) => item.value === category)) {
    return { ok: false, code: 'INVALID_CATEGORY', message: 'unknown category' };
  }
  const source = readQueryParam(params, 'source');
  if (source !== null && !NEWS_SOURCE_VALUES.includes(source as NewsSource)) {
    return { ok: false, code: 'INVALID_SOURCE', message: 'unknown source' };
  }

  const range = date === null ? null : shanghaiDayRangeUtc(date);
  return {
    ok: true,
    query: {
      date,
      startUtc: range ? range.startUtc : null,
      endUtc: range ? range.endUtc : null,
      category,
      source,
      page: paging.page,
      limit: paging.limit,
    },
  };
}

export function buildPageMeta(
  total: number,
  page: number,
  limit: number,
): { totalPages: number; hasNext: boolean } {
  const totalPages = Math.max(0, Math.ceil(total / limit));
  return { totalPages, hasNext: page < totalPages };
}

/** summaryStatus=failed 的条目照常返回，仅把 summary 降级为 null（不隐藏条目）。 */
export function serializeNewsItem(row: NewsRowLike): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    source: row.source,
    publishedAt: row.publishedAt,
    summary: row.summaryStatus === 'failed' ? null : row.summary,
    category: row.category,
    summaryStatus: row.summaryStatus,
    createdAt: row.createdAt ?? null,
  };
}

export function serializeNewsList(input: {
  items: NewsRowLike[];
  total: number;
  page: number;
  limit: number;
  date: string | null;
}): Record<string, unknown> {
  const { totalPages, hasNext } = buildPageMeta(input.total, input.page, input.limit);
  return {
    items: input.items.map(serializeNewsItem),
    page: input.page,
    limit: input.limit,
    total: input.total,
    totalPages,
    hasNext,
    date: input.date,
  };
}
