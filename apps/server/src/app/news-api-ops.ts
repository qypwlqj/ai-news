import { RUN_STATUS_VALUES, SOURCE_VALUES } from './news-types';

/** 路由层只负责把 { status, body } 序列化为 Response，便于直接单测。 */
export type OpsResponse = { status: number; body: unknown };

export type RunTotals = {
  fetched: number;
  inserted: number;
  duplicates: number;
  summaryOk: number;
  summaryFailed: number;
};

export type RunSourceView = {
  source: string;
  status: string;
  fetched: number;
  inserted: number;
  duplicates: number;
  failed: number;
  durationMs: number;
  attempts: number;
  error?: { code: string; message: string };
};

export type CollectRunView = {
  runId: string;
  trigger: string;
  date: string;
  status: string;
  startedAt: string;
  finishedAt?: string | null;
  durationMs?: number | null;
  totals?: Partial<RunTotals>;
  sources?: RunSourceView[];
  /** 编排层给出的对外状态码，不进入响应体。 */
  httpStatus?: number;
};

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;

const defaultRequestId = (): string => `req_${Math.random().toString(36).slice(2, 10)}`;

export function serializeTotals(totals: Partial<RunTotals> = {}): RunTotals {
  return {
    fetched: count(totals.fetched),
    inserted: count(totals.inserted),
    duplicates: count(totals.duplicates),
    summaryOk: count(totals.summaryOk),
    summaryFailed: count(totals.summaryFailed),
  };
}

export function serializeSource(source: RunSourceView): Record<string, unknown> {
  const view: Record<string, unknown> = {
    source: source.source,
    status: source.status,
    fetched: count(source.fetched),
    inserted: count(source.inserted),
    duplicates: count(source.duplicates),
    failed: count(source.failed),
    durationMs: count(source.durationMs),
    attempts: count(source.attempts),
  };
  if (source.error) view.error = { code: source.error.code, message: source.error.message };
  return view;
}

/** 只输出契约字段：额外字段（含令牌、连接串、环境变量）一律不进入响应体。 */
export function serializeRun(run: CollectRunView): Record<string, unknown> {
  return {
    runId: run.runId,
    trigger: run.trigger,
    date: run.date,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt ?? null,
    durationMs: typeof run.durationMs === 'number' ? run.durationMs : null,
    totals: serializeTotals(run.totals ?? {}),
    sources: (run.sources ?? []).map(serializeSource),
  };
}

/** 批次列表行：契约中不含逐源明细。 */
export function serializeRunSummary(run: CollectRunView): Record<string, unknown> {
  const body = serializeRun(run);
  delete body.sources;
  return body;
}

const fail = (status: number, code: string, message: string, requestId: string): OpsResponse => ({
  status,
  body: { error: { code, message, requestId } },
});

export type AuthVerdict = 'ok' | 'unauthorized' | 'forbidden';

/** 缺失或格式错误 → 401；不匹配或服务端未配置 → 403；不回显任何令牌明文。 */
export function verifyBearer(
  header: string | null | undefined,
  secret: string | null | undefined,
): AuthVerdict {
  if (!secret) return 'forbidden';
  const matched = /^Bearer\s+(\S+)$/i.exec((header ?? '').trim());
  if (!matched) return 'unauthorized';
  const given = matched[1];
  if (given.length !== secret.length) return 'forbidden';
  let diff = 0;
  for (let i = 0; i < secret.length; i += 1) diff |= given.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0 ? 'ok' : 'forbidden';
}

const SHANGHAI_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export const shanghaiDateToday = (now: Date = new Date()): string => SHANGHAI_DATE.format(now);

export const isIsoDateString = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; code: string; message: string };

export type CollectRequest = {
  date: string;
  sources: string[];
  force: boolean;
  trigger: 'api' | 'cron';
};

/** 空 body 合法；date 缺省为当日上海日期，sources 缺省为全部来源，非法元素一律 400。 */
export function parseCollectBody(body: unknown, today: string): ParseResult<CollectRequest> {
  const raw = body === undefined || body === null ? {} : body;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 400, code: 'INVALID_BODY', message: '请求体必须为 JSON 对象' };
  }
  const record = raw as Record<string, unknown>;
  const date = record.date === undefined ? today : record.date;
  if (!isIsoDateString(date)) {
    return { ok: false, status: 400, code: 'INVALID_DATE', message: 'date 必须为 YYYY-MM-DD' };
  }
  const sourcesInput = record.sources === undefined ? [...SOURCE_VALUES] : record.sources;
  if (!Array.isArray(sourcesInput) || sourcesInput.length === 0) {
    return { ok: false, status: 400, code: 'INVALID_SOURCE', message: 'sources 必须为非空来源枚举数组' };
  }
  const sources: string[] = [];
  for (const item of sourcesInput) {
    if (typeof item !== 'string' || !(SOURCE_VALUES as readonly string[]).includes(item)) {
      return { ok: false, status: 400, code: 'INVALID_SOURCE', message: 'sources 含未知来源' };
    }
    sources.push(item);
  }
  if (record.force !== undefined && typeof record.force !== 'boolean') {
    return { ok: false, status: 400, code: 'INVALID_BODY', message: 'force 必须为布尔值' };
  }
  return { ok: true, value: { date, sources, force: record.force === true, trigger: 'api' } };
}

export type CronCollectDeps = {
  secret: string | null;
  runCollect: (request: CollectRequest) => Promise<CollectRunView> | CollectRunView;
  today?: () => string;
  requestId?: () => string;
};

/** POST /api/cron/collect：401/403 → 400 校验 → 调用编排服务 → 200 或 502。 */
export async function handleCronCollect(
  input: { authorization?: string | null; body?: unknown },
  deps: CronCollectDeps,
): Promise<OpsResponse> {
  const requestId = (deps.requestId ?? defaultRequestId)();
  const verdict = verifyBearer(input.authorization, deps.secret);
  if (verdict === 'unauthorized') return fail(401, 'UNAUTHORIZED', '缺少 Authorization: Bearer 令牌', requestId);
  if (verdict === 'forbidden') return fail(403, 'FORBIDDEN', '令牌无效或服务端未配置令牌', requestId);
  const parsed = parseCollectBody(input.body, (deps.today ?? shanghaiDateToday)());
  if (!parsed.ok) return fail(parsed.status, parsed.code, parsed.message, requestId);
  try {
    const result = await deps.runCollect(parsed.value);
    const status = result.httpStatus ?? (result.status === 'failed' ? 502 : 200);
    return { status, body: serializeRun(result) };
  } catch {
    return fail(500, 'INTERNAL_ERROR', '采集执行失败', requestId);
  }
}

const singleValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const parsePositiveInt = (raw: string | undefined, fallback: number): number | null => {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return value >= 1 ? value : null;
};

export type CollectRunsQuery = { date?: string; status?: string; page: number; limit: number };

export function parseRunsQuery(
  query: Record<string, string | string[] | undefined>,
): ParseResult<CollectRunsQuery> {
  const date = singleValue(query.date);
  if (date !== undefined && !isIsoDateString(date)) {
    return { ok: false, status: 400, code: 'INVALID_DATE', message: 'date 必须为 YYYY-MM-DD' };
  }
  const status = singleValue(query.status);
  if (status !== undefined && !(RUN_STATUS_VALUES as readonly string[]).includes(status)) {
    return { ok: false, status: 400, code: 'INVALID_STATUS', message: 'status 非法' };
  }
  const page = parsePositiveInt(singleValue(query.page), 1);
  const limit = parsePositiveInt(singleValue(query.limit), 20);
  if (page === null || limit === null || limit > 100) {
    return { ok: false, status: 400, code: 'INVALID_PAGINATION', message: 'page 需 ≥1，limit 需在 1..100' };
  }
  return { ok: true, value: { date, status, page, limit } };
}

export type CollectRunsDeps = {
  listRuns: (query: CollectRunsQuery) => Promise<{ items: CollectRunView[]; total: number }>;
  requestId?: () => string;
};

/** GET /api/collect-runs：默认 page=1、limit=20，按 startedAt DESC 由仓储负责。 */
export async function handleListCollectRuns(
  input: { query?: Record<string, string | string[] | undefined> },
  deps: CollectRunsDeps,
): Promise<OpsResponse> {
  const requestId = (deps.requestId ?? defaultRequestId)();
  const parsed = parseRunsQuery(input.query ?? {});
  if (!parsed.ok) return fail(parsed.status, parsed.code, parsed.message, requestId);
  const { page, limit } = parsed.value;
  try {
    const result = await deps.listRuns(parsed.value);
    const total = count(result.total);
    return {
      status: 200,
      body: {
        items: (result.items ?? []).map(serializeRunSummary),
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  } catch {
    return fail(500, 'INTERNAL_ERROR', '批次日志读取失败', requestId);
  }
}

export type CollectRunDetailDeps = {
  getRun: (runId: string) => Promise<CollectRunView | null>;
  requestId?: () => string;
};

/** GET /api/collect-runs/{runId}：未结束批次 finishedAt/durationMs 为 null。 */
export async function handleGetCollectRun(
  input: { runId?: string | null },
  deps: CollectRunDetailDeps,
): Promise<OpsResponse> {
  const requestId = (deps.requestId ?? defaultRequestId)();
  const runId = (input.runId ?? '').trim();
  if (!runId || runId.length > 128) return fail(400, 'INVALID_RUN_ID', 'runId 非法', requestId);
  try {
    const run = await deps.getRun(runId);
    if (!run) return fail(404, 'RUN_NOT_FOUND', '批次不存在', requestId);
    return { status: 200, body: serializeRun(run) };
  } catch {
    return fail(500, 'INTERNAL_ERROR', '批次日志读取失败', requestId);
  }
}
