/**
 * 领域枚举与 DTO：与 docs/api.md、docs/data-model.md 的枚举一一对应（只加不删不改名）。
 * 纯常量与类型，无 IO，可单测。
 */

export const SOURCE_VALUES = ['hacker_news', 'arxiv_cs_ai', 'jiqizhixin'] as const;
export type NewsSource = (typeof SOURCE_VALUES)[number];

export const CATEGORY_VALUES = [
  'model_release',
  'research_paper',
  'product_application',
  'industry_news',
  'policy_funding',
] as const;
export type NewsCategory = (typeof CATEGORY_VALUES)[number];

export const SUMMARY_STATUS_VALUES = ['ok', 'failed', 'pending'] as const;
export type SummaryStatus = (typeof SUMMARY_STATUS_VALUES)[number];

export const RUN_TRIGGER_VALUES = ['cron', 'api'] as const;
export type RunTrigger = (typeof RUN_TRIGGER_VALUES)[number];

export const RUN_STATUS_VALUES = ['success', 'partial_failure', 'failed'] as const;
export type RunStatus = (typeof RUN_STATUS_VALUES)[number];

export const SOURCE_RUN_STATUS_VALUES = ['success', 'failed', 'skipped'] as const;
export type SourceRunStatus = (typeof SOURCE_RUN_STATUS_VALUES)[number];

export const API_ERROR_CODES = [
  'INVALID_DATE',
  'INVALID_CATEGORY',
  'INVALID_SOURCE',
  'INVALID_PAGINATION',
  'INVALID_ID',
  'INVALID_RUN_ID',
  'INVALID_STATUS',
  'NEWS_NOT_FOUND',
  'RUN_NOT_FOUND',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'COLLECT_IN_PROGRESS',
  'ALL_SOURCES_FAILED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

export function isNewsSource(value: unknown): value is NewsSource {
  return oneOf(SOURCE_VALUES, value);
}

export function isNewsCategory(value: unknown): value is NewsCategory {
  return oneOf(CATEGORY_VALUES, value);
}

export function isSummaryStatus(value: unknown): value is SummaryStatus {
  return oneOf(SUMMARY_STATUS_VALUES, value);
}

export function isRunStatus(value: unknown): value is RunStatus {
  return oneOf(RUN_STATUS_VALUES, value);
}

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return oneOf(API_ERROR_CODES, value);
}

/** 分类字典项：value/label/order，前端不得硬编码 label 与顺序。 */
export interface CategoryOption {
  value: NewsCategory;
  label: string;
  order: number;
}

/** 统一错误信封 { error: { code, message, requestId } }。 */
export interface ApiErrorEnvelope {
  error: { code: ApiErrorCode; message: string; requestId: string };
}

/** 列表条目：字段与 GET /api/news 一致，二期小程序复用。 */
export interface NewsListItem {
  id: string;
  title: string;
  url: string;
  source: NewsSource;
  publishedAt: string;
  summary: string | null;
  category: NewsCategory;
  summaryStatus: SummaryStatus;
  createdAt: string;
}

/** 详情：GET /api/news/{id}，仅只读字段。 */
export interface NewsDetail extends NewsListItem {
  originalTitle: string | null;
  rawExcerpt: string | null;
  titleFingerprint: string;
  updatedAt: string;
}

/** GET /api/news 查询参数（已校验、归一化）。 */
export interface NewsListQuery {
  date: string | null;
  category: NewsCategory | null;
  source: NewsSource | null;
  page: number;
  limit: number;
}

/** GET /api/news 响应体。 */
export interface NewsListResponse {
  items: NewsListItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  date: string | null;
}

/** 采集入库前的原始条目（来源适配器统一输出）。 */
export interface RawNewsItem {
  title: string;
  url: string;
  source: NewsSource;
  publishedAt: Date;
  externalId: string | null;
  originalTitle: string | null;
  rawExcerpt: string | null;
}
