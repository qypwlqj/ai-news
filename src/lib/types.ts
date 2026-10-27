export const SOURCE_VALUES = ['hacker_news', 'arxiv_cs_ai', 'jiqizhixin'] as const;
export type Source = (typeof SOURCE_VALUES)[number];

export const CATEGORIES = [
  { value: 'model_release', label: '模型发布', order: 1 },
  { value: 'research_paper', label: '研究论文', order: 2 },
  { value: 'product_application', label: '产品应用', order: 3 },
  { value: 'industry_news', label: '行业动态', order: 4 },
  { value: 'policy_funding', label: '政策融资', order: 5 },
] as const;
export type Category = (typeof CATEGORIES)[number]['value'];

export const SUMMARY_STATUS_VALUES = ['ok', 'failed', 'pending'] as const;
export type SummaryStatus = (typeof SUMMARY_STATUS_VALUES)[number];
export type RunStatus = 'success' | 'partial_failure' | 'failed';
export type SourceRunStatus = 'success' | 'failed' | 'skipped';
export type RunTrigger = 'cron' | 'api';

export interface RawNewsItem {
  source: Source;
  title: string;
  url: string;
  publishedAt: string;
  externalId?: string | null;
  originalTitle?: string | null;
  rawExcerpt?: string | null;
}

export interface NewsItemDto {
  id: string;
  title: string;
  url: string;
  source: Source;
  publishedAt: string;
  summary: string | null;
  category: Category;
  summaryStatus: SummaryStatus;
}

export interface NewsItemRecord {
  id: string;
  title: string;
  originalTitle?: string | null;
  url: string;
  normalizedUrl: string;
  titleFingerprint: string;
  source: Source;
  externalId?: string | null;
  publishedAt: Date;
  summary: string | null;
  summaryStatus: SummaryStatus;
  category: Category;
  rawExcerpt?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export function isCategory(value: string): value is Category {
  return CATEGORIES.some((item) => item.value === value);
}

export function isSource(value: string): value is Source {
  return SOURCE_VALUES.some((item) => item === value);
}

export function fallbackCategory(value: string | null | undefined): Category {
  return value && isCategory(value) ? value : 'industry_news';
}

export const RUN_STATUS_VALUES = ['success', 'partial_failure', 'failed'] as const;
export const SOURCE_RUN_STATUS_VALUES = ['success', 'failed', 'skipped'] as const;
export const RUN_TRIGGER_VALUES = ['cron', 'api'] as const;

/** 错误码为稳定机器可读常量，重命名视为破坏性兼容变更。 */
export const API_ERROR_CODES = [
  'INVALID_DATE',
  'INVALID_CATEGORY',
  'INVALID_SOURCE',
  'INVALID_STATUS',
  'INVALID_PAGINATION',
  'INVALID_ID',
  'INVALID_RUN_ID',
  'INVALID_BODY',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NEWS_NOT_FOUND',
  'RUN_NOT_FOUND',
  'COLLECT_IN_PROGRESS',
  'ALL_SOURCES_FAILED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** 统一错误信封：所有非 2xx 响应体。 */
export interface ApiErrorEnvelope {
  error: { code: ApiErrorCode; message: string; requestId: string };
}

export function isSummaryStatus(value: string): value is SummaryStatus {
  return SUMMARY_STATUS_VALUES.some((item) => item === value);
}

export function isRunStatus(value: string): value is RunStatus {
  return RUN_STATUS_VALUES.some((item) => item === value);
}
