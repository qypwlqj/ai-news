import { CATEGORIES } from './news-constants';
import { isIsoDate } from './news-date';
import {
  NEWS_SOURCE_VALUES as SOURCE_VALUES,
  buildPageMeta,
  parseNewsListQuery,
  parsePaging,
  readQueryParam,
  serializeNewsItem,
  serializeNewsList,
} from './news-query';

/**
 * 框架无关的接口处理函数：Route Handler 只做「取值 → 调用 → 转 Response」的薄壳。
 * 校验、统一错误信封 { error: { code, message, requestId } } 与 400/401/404/409/502/503 语义集中在此，便于单测。
 */

const RUN_STATUS_VALUES = ['success', 'partial_failure', 'failed'] as const;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type Source = (typeof SOURCE_VALUES)[number];
export type RunStatus = (typeof RUN_STATUS_VALUES)[number];

export interface Totals {
  fetched: number;
  inserted: number;
  duplicates: number;
  summaryOk: number;
  summaryFailed: number;
}

export interface NewsRow {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary: string | null;
  summaryStatus: string;
  category: string;
  createdAt?: string | null;
  originalTitle?: string | null;
  rawExcerpt?: string | null;
  titleFingerprint?: string;
  updatedAt?: string | null;
}

export interface SourceRunRow {
  source: string;
  status: string;
  fetched: number;
  inserted: number;
  duplicates: number;
  failed: number;
  durationMs: number;
  attempts: number;
  error?: { code: string; message: string };
}

export interface RunRow {
  runId: string;
  trigger: string;
  date: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  totals: Totals;
}

export interface CollectResult {
  runId: string;
  status: RunStatus;
  /** 并发保护命中时由服务层置 true，对外映射 409 COLLECT_IN_PROGRESS。 */
  inProgress?: boolean;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  date: string;
  totals: Totals;
  sources: SourceRunRow[];
}

export interface NewsApiDeps {
  repository: {
    listNews(query: {
      startUtc: Date | null;
      endUtc: Date | null;
      category: string | null;
      source: string | null;
      page: number;
      limit: number;
    }): Promise<{ items: NewsRow[]; total: number }>;
    getNewsById(id: string): Promise<NewsRow | null>;
    listRuns(query: {
      date: string | null;
      status: string | null;
      page: number;
      limit: number;
    }): Promise<{ items: RunRow[]; total: number }>;
    getRun(runId: string): Promise<{ run: RunRow; sources: SourceRunRow[] } | null>;
  };
  collect(input: { date: string; sources: Source[]; force: boolean }): Promise<CollectResult>;
  checkDatabase?: () => Promise<boolean>;
  now?: () => Date;
  /** 由 Route Handler 从环境变量注入，本模块不读取环境变量。 */
  cronSecret?: string;
  requestId?: () => string;
}

export type ApiResult = { status: number; body: Record<string, unknown> };
export type SearchParams = Record<string, string | string[] | undefined> | URLSearchParams;

export function errorResult(code: string, message: string, status: number, requestId = ''): ApiResult {
  return { status, body: { error: { code, message, requestId } } };
}

function okResult(body: Record<string, unknown>): ApiResult {
  return { status: 200, body };
}

function requestIdOf(deps: NewsApiDeps): string {
  return typeof deps.requestId === 'function' ? deps.requestId() : '';
}

function todayInShanghai(now: Date): string {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

/** GET /api/news：date / category / source / page / limit 严格校验，非法值一律 400。 */
export async function handleNewsList(deps: NewsApiDeps, params: SearchParams = {}): Promise<ApiResult> {
  const requestId = requestIdOf(deps);
  const parsed = parseNewsListQuery(params);
  if (!parsed.ok) {
    return errorResult(parsed.code, parsed.message, 400, requestId);
  }
  const { query } = parsed;
  try {
    const result = await deps.repository.listNews({
      startUtc: query.startUtc,
      endUtc: query.endUtc,
      category: query.category,
      source: query.source,
      page: query.page,
      limit: query.limit,
    });
    return okResult(
      serializeNewsList({
        items: result.items,
        total: result.total,
        page: query.page,
        limit: query.limit,
        date: query.date,
      }),
    );
  } catch {
    return errorResult('INTERNAL_ERROR', 'failed to load news', 500, requestId);
  }
}

/** GET /api/news/{id}：主键单点查询，400 与 404 严格区分。 */
export async function handleNewsDetail(deps: NewsApiDeps, id: string): Promise<ApiResult> {
  const requestId = requestIdOf(deps);
  const newsId = typeof id === 'string' ? id.trim() : '';
  if (!ID_PATTERN.test(newsId)) {
    return errorResult('INVALID_ID', 'id must be a non-empty identifier', 400, requestId);
  }
  try {
    const row = await deps.repository.getNewsById(newsId);
    if (!row) return errorResult('NEWS_NOT_FOUND', 'news item not found', 404, requestId);
    return okResult({
      ...serializeNewsItem(row),
      originalTitle: row.originalTitle ?? null,
      rawExcerpt: row.rawExcerpt ?? null,
      titleFingerprint: row.titleFingerprint ?? '',
      updatedAt: row.updatedAt ?? null,
    });
  } catch {
    return errorResult('INTERNAL_ERROR', 'failed to load news item', 500, requestId);
  }
}

/** GET /api/categories：固定 5 项 value/label/order，顺序稳定。 */
export function handleCategories(): ApiResult {
  return okResult({
    items: CATEGORIES.map((item) => ({ value: item.value, label: item.label, order: item.order })),
  });
}

/** GET /api/health：数据库不可用时返回 503 且 status=degraded，响应体结构不变。 */
export async function handleHealth(deps: NewsApiDeps): Promise<ApiResult> {
  const now = deps.now ? deps.now() : new Date();
  let database: 'ok' | 'error' = 'ok';
  if (typeof deps.checkDatabase === 'function') {
    try {
      database = (await deps.checkDatabase()) ? 'ok' : 'error';
    } catch {
      database = 'error';
    }
  }
  const degraded = database !== 'ok';
  return {
    status: degraded ? 503 : 200,
    body: { status: degraded ? 'degraded' : 'ok', time: now.toISOString(), checks: { database } },
  };
}

/** POST /api/cron/collect：Bearer 鉴权 → 参数校验 → 采集 → 200/502 映射。 */
export async function handleCollect(
  deps: NewsApiDeps,
  input: { authorization?: string | null; body?: unknown } = {},
): Promise<ApiResult> {
  const requestId = requestIdOf(deps);
  const authorization = typeof input.authorization === 'string' ? input.authorization : '';
  if (!deps.cronSecret || authorization !== `Bearer ${deps.cronSecret}`) {
    return errorResult('UNAUTHORIZED', 'missing or invalid bearer token', 401, requestId);
  }

  const body =
    input.body !== null && typeof input.body === 'object' ? (input.body as Record<string, unknown>) : {};
  const rawDate = body.date;
  const date =
    rawDate === undefined || rawDate === null || rawDate === ''
      ? todayInShanghai(deps.now ? deps.now() : new Date())
      : String(rawDate);
  if (!isIsoDate(date)) {
    return errorResult('INVALID_DATE', 'date must be YYYY-MM-DD', 400, requestId);
  }

  let sources: Source[] = [...SOURCE_VALUES];
  if (body.sources !== undefined) {
    if (!Array.isArray(body.sources)) {
      return errorResult('INVALID_SOURCE', 'sources must be an array of source values', 400, requestId);
    }
    const picked: Source[] = [];
    for (const value of body.sources) {
      if (typeof value !== 'string' || !SOURCE_VALUES.includes(value as Source)) {
        return errorResult('INVALID_SOURCE', 'unknown source', 400, requestId);
      }
      picked.push(value as Source);
    }
    sources = picked;
  }
  const force = body.force === true;

  try {
    const result = await deps.collect({ date, sources, force });
    if (result.inProgress) {
      return errorResult('COLLECT_IN_PROGRESS', 'another collect batch is running', 409, requestId);
    }
    return {
      status: result.status === 'failed' ? 502 : 200,
      body: {
        runId: result.runId,
        status: result.status,
        trigger: 'api',
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        durationMs: result.durationMs,
        date: result.date,
        totals: result.totals,
        sources: result.sources,
      },
    };
  } catch {
    return errorResult('INTERNAL_ERROR', 'collect batch failed', 500, requestId);
  }
}

/** GET /api/collect-runs：批次日志列表，默认按 startedAt DESC（排序由仓储负责）。 */
export async function handleCollectRuns(
  deps: NewsApiDeps,
  params: SearchParams = {},
): Promise<ApiResult> {
  const requestId = requestIdOf(deps);
  const paging = parsePaging(params);
  if (!paging) {
    return errorResult('INVALID_PAGINATION', 'page must be >= 1 and limit within 1..100', 400, requestId);
  }
  const date = readQueryParam(params, 'date');
  if (date !== null && !isIsoDate(date)) {
    return errorResult('INVALID_DATE', 'date must be YYYY-MM-DD', 400, requestId);
  }
  const status = readQueryParam(params, 'status');
  if (status !== null && !RUN_STATUS_VALUES.includes(status as RunStatus)) {
    return errorResult('INVALID_STATUS', 'unknown run status', 400, requestId);
  }

  try {
    const result = await deps.repository.listRuns({
      date,
      status,
      page: paging.page,
      limit: paging.limit,
    });
    const { totalPages } = buildPageMeta(result.total, paging.page, paging.limit);
    return okResult({
      items: result.items,
      page: paging.page,
      limit: paging.limit,
      total: result.total,
      totalPages,
    });
  } catch {
    return errorResult('INTERNAL_ERROR', 'failed to load collect runs', 500, requestId);
  }
}

/** GET /api/collect-runs/{runId}：批次汇总 + 逐源明细（错误信息已脱敏截断）。 */
export async function handleCollectRunDetail(deps: NewsApiDeps, runId: string): Promise<ApiResult> {
  const requestId = requestIdOf(deps);
  const id = typeof runId === 'string' ? runId.trim() : '';
  if (!ID_PATTERN.test(id)) {
    return errorResult('INVALID_RUN_ID', 'runId must be a non-empty identifier', 400, requestId);
  }
  try {
    const result = await deps.repository.getRun(id);
    if (!result) return errorResult('RUN_NOT_FOUND', 'collect run not found', 404, requestId);
    return okResult({ ...result.run, runId: result.run.runId || id, sources: result.sources });
  } catch {
    return errorResult('INTERNAL_ERROR', 'failed to load collect run', 500, requestId);
  }
}
