/**
 * 采集编排服务（一期）。
 *
 * 串行链路：抢锁 → 当日幂等短路 → 三来源采集 → 去重入库 + 摘要加工（由 ingest 端口完成）→ 批次汇总。
 * 锁、仓储、抓取、加工、时钟、ID 全部由端口注入：本模块不建连接、不读环境变量、不发网络请求，
 * 因此可在单测中完全离线验证互斥、幂等、重试与部分失败语义。
 */

export const COLLECT_SOURCES = ['hacker_news', 'arxiv_cs_ai', 'jiqizhixin'] as const;
export type CollectSource = (typeof COLLECT_SOURCES)[number];

export type CollectTrigger = 'cron' | 'api';
export type CollectRunStatus = 'success' | 'partial_failure' | 'failed';
export type SourceRunStatus = 'success' | 'failed' | 'skipped';
export type CollectErrorCode = 'COLLECT_IN_PROGRESS' | 'ALL_SOURCES_FAILED';

/** 单来源失败自动重试上限：attempts ≤ 3。 */
export const COLLECT_MAX_ATTEMPTS = 3;
/** error.message 出参截断长度（与落库口径一致，≤ 2000 字）。 */
export const COLLECT_ERROR_MESSAGE_MAX_CHARS = 2000;

export interface SourceCounts {
  fetched: number;
  inserted: number;
  duplicates: number;
  summaryOk: number;
  summaryFailed: number;
}

export interface RunTotals extends SourceCounts {
  failed: number;
}

export interface SourceRunRecord {
  source: CollectSource;
  status: SourceRunStatus;
  fetched: number;
  inserted: number;
  duplicates: number;
  failed: number;
  durationMs: number;
  attempts: number;
  error?: { code: string; message: string };
}

export interface CollectRunBody {
  runId: string;
  status: CollectRunStatus;
  trigger: CollectTrigger;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  date: string;
  totals: RunTotals;
  sources: SourceRunRecord[];
}

export interface CollectRequest {
  trigger: CollectTrigger;
  /** Asia/Shanghai 自然日（YYYY-MM-DD），由调用方校验后传入。 */
  date: string;
  /** 缺省为全部 3 个来源。 */
  sources?: readonly CollectSource[];
  /** true 时忽略当日已成功批次的幂等短路。 */
  force?: boolean;
}

export interface CollectPorts<TRaw> {
  /** pg_try_advisory_lock(hashtext('news_collect:' || run_date))，由注入方实现。 */
  tryLock(runDate: string): Promise<boolean>;
  unlock(runDate: string): Promise<void>;
  /** 当日已有 success/partial_failure 批次时返回其 runId，用于幂等短路。 */
  findSuccessfulRun(runDate: string): Promise<string | null>;
  createRun(input: { runId: string; trigger: CollectTrigger; runDate: string; startedAt: Date }): Promise<void>;
  finishRun(input: {
    runId: string;
    status: CollectRunStatus;
    finishedAt: Date;
    durationMs: number;
    totals: RunTotals;
  }): Promise<void>;
  saveSourceRun(input: { runId: string; record: SourceRunRecord }): Promise<void>;
  fetchSource(source: CollectSource): Promise<readonly TRaw[]>;
  /** 去重入库 + 摘要加工，返回逐源计数；重复条目已剔除。 */
  ingestSource(source: CollectSource, items: readonly TRaw[]): Promise<SourceCounts>;
  now(): Date;
  createId(): string;
}

export interface CollectServiceResult {
  /** 200 至少一源成功（可 partial_failure）；409 互斥冲突；502 全源失败（响应体结构不变）。 */
  httpStatus: 200 | 409 | 502;
  error?: { code: CollectErrorCode; message: string };
  body?: CollectRunBody;
}

interface SourceOutcome {
  record: SourceRunRecord;
  counts: SourceCounts;
}

const ZERO_COUNTS: SourceCounts = { fetched: 0, inserted: 0, duplicates: 0, summaryOk: 0, summaryFailed: 0 };

/** 批次 totals = 逐源计数求和（failed 取逐源记录）。 */
export function sumTotals(outcomes: readonly SourceOutcome[]): RunTotals {
  const totals: RunTotals = { ...ZERO_COUNTS, failed: 0 };
  for (const { record, counts } of outcomes) {
    totals.fetched += counts.fetched;
    totals.inserted += counts.inserted;
    totals.duplicates += counts.duplicates;
    totals.summaryOk += counts.summaryOk;
    totals.summaryFailed += counts.summaryFailed;
    totals.failed += record.failed;
  }
  return totals;
}

/** 执行一轮采集：互斥互锁 → 幂等短路 → 逐源采集 → 批次汇总。 */
export async function runCollect<TRaw>(
  request: CollectRequest,
  ports: CollectPorts<TRaw>,
): Promise<CollectServiceResult> {
  const wanted: CollectSource[] =
    request.sources && request.sources.length > 0 ? [...request.sources] : [...COLLECT_SOURCES];

  const locked = await ports.tryLock(request.date);
  if (!locked) {
    return {
      httpStatus: 409,
      error: { code: 'COLLECT_IN_PROGRESS', message: '当日采集批次正在执行，请稍后重试' },
    };
  }

  const startedAt = ports.now();
  try {
    return await executeBatch(request, wanted, ports, startedAt);
  } finally {
    await ports.unlock(request.date);
  }
}

async function executeBatch<TRaw>(
  request: CollectRequest,
  wanted: readonly CollectSource[],
  ports: CollectPorts<TRaw>,
  startedAt: Date,
): Promise<CollectServiceResult> {
  if (!request.force) {
    const previousRunId = await ports.findSuccessfulRun(request.date);
    if (previousRunId) {
      const finishedAt = ports.now();
      const outcomes: SourceOutcome[] = wanted.map((source) => ({
        record: {
          source,
          status: 'skipped',
          fetched: 0,
          inserted: 0,
          duplicates: 0,
          failed: 0,
          durationMs: 0,
          attempts: 0,
        },
        counts: ZERO_COUNTS,
      }));
      return {
        httpStatus: 200,
        body: {
          runId: previousRunId,
          status: 'success',
          trigger: request.trigger,
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: elapsedSince(startedAt.getTime(), finishedAt),
          date: request.date,
          totals: sumTotals(outcomes),
          sources: outcomes.map((outcome) => outcome.record),
        },
      };
    }
  }

  const runId = ports.createId();
  await ports.createRun({ runId, trigger: request.trigger, runDate: request.date, startedAt });

  const outcomes: SourceOutcome[] = [];
  for (const source of wanted) {
    const outcome = await runSource(source, ports);
    outcomes.push(outcome);
    await ports.saveSourceRun({ runId, record: outcome.record });
  }

  const totals = sumTotals(outcomes);
  const sources = outcomes.map((outcome) => outcome.record);
  const succeeded = sources.filter((record) => record.status === 'success').length;
  const status: CollectRunStatus =
    sources.length > 0 && succeeded === sources.length
      ? 'success'
      : succeeded > 0
        ? 'partial_failure'
        : 'failed';

  const finishedAt = ports.now();
  const durationMs = elapsedSince(startedAt.getTime(), finishedAt);
  await ports.finishRun({ runId, status, finishedAt, durationMs, totals });

  const body: CollectRunBody = {
    runId,
    status,
    trigger: request.trigger,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs,
    date: request.date,
    totals,
    sources,
  };

  if (status === 'failed') {
    return {
      httpStatus: 502,
      error: { code: 'ALL_SOURCES_FAILED', message: '全部来源采集失败，请查看批次逐源明细' },
      body,
    };
  }
  return { httpStatus: 200, body };
}

/** 单源执行：失败重试，最多 COLLECT_MAX_ATTEMPTS 次，只累加 attempts 不新增行。 */
async function runSource<TRaw>(source: CollectSource, ports: CollectPorts<TRaw>): Promise<SourceOutcome> {
  const startedMs = ports.now().getTime();
  let attempts = 0;
  let failure: { code: string; message: string } | undefined;

  while (attempts < COLLECT_MAX_ATTEMPTS) {
    attempts += 1;
    try {
      const items = await ports.fetchSource(source);
      const counts = await ports.ingestSource(source, items);
      return {
        record: {
          source,
          status: 'success',
          fetched: counts.fetched,
          inserted: counts.inserted,
          duplicates: counts.duplicates,
          failed: 0,
          durationMs: elapsedSince(startedMs, ports.now()),
          attempts,
        },
        counts,
      };
    } catch (cause) {
      failure = toErrorInfo(cause);
    }
  }

  return {
    record: {
      source,
      status: 'failed',
      fetched: 0,
      inserted: 0,
      duplicates: 0,
      failed: 1,
      durationMs: elapsedSince(startedMs, ports.now()),
      attempts,
      error: failure ?? { code: 'SOURCE_FETCH_FAILED', message: '来源采集失败' },
    },
    counts: ZERO_COUNTS,
  };
}

function elapsedSince(startedMs: number, end: Date): number {
  return Math.max(0, end.getTime() - startedMs);
}

/** 失败原因：保留稳定 errorCode，message 脱敏（压平空白）并截断 ≤ 2000 字。 */
function toErrorInfo(cause: unknown): { code: string; message: string } {
  if (cause && typeof cause === 'object') {
    const candidate = cause as { code?: unknown; message?: unknown };
    const code = typeof candidate.code === 'string' && candidate.code ? candidate.code : 'SOURCE_FETCH_FAILED';
    const message = typeof candidate.message === 'string' ? sanitizeMessage(candidate.message) : '来源采集失败';
    return { code, message };
  }
  return { code: 'SOURCE_FETCH_FAILED', message: '来源采集失败' };
}

function sanitizeMessage(raw: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim();
  if (!flat) return '来源采集失败';
  return flat.length > COLLECT_ERROR_MESSAGE_MAX_CHARS
    ? `${flat.slice(0, COLLECT_ERROR_MESSAGE_MAX_CHARS)}…`
    : flat;
}
