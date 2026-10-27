import { getNewsRepository } from './db/repository';
import type { CollectRunRecord, CollectRunTotals, NewsRepository } from './db/repository';
import type { Category, NewsItemRecord, RunStatus, Source, SourceRunStatus } from './types';

/** 单源最多尝试次数（含首次），对应契约 sources[].attempts ≤ 3。 */
export const MAX_ATTEMPTS = 3;
export const MAX_ERROR_MESSAGE_LENGTH = 2000;
export const SUMMARY_MAX_LENGTH = 200;
export const DEFAULT_CATEGORY: Category = 'industry_news';
export const ALL_SOURCES: readonly Source[] = ['hacker_news', 'arxiv_cs_ai', 'jiqizhixin'];
export const CATEGORIES: readonly Category[] = [
  'model_release',
  'research_paper',
  'product_application',
  'industry_news',
  'policy_funding',
];
const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';

export class CollectError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CollectError';
  }
}

export interface RawItem {
  title: string;
  url: string;
  source: Source;
  publishedAt: Date;
  externalId?: string | null;
  rawExcerpt?: string | null;
}

export type SourceFetcher = (source: Source) => Promise<RawItem[]>;

export interface SummaryOutcome {
  summary: string;
  category: Category;
}

export type Summarizer = (item: RawItem) => Promise<SummaryOutcome | null>;

/** 依赖注入点：来源抓取与 LLM 加工由运行时装配，编排层不直接依赖网络与模型。 */
export interface CollectDeps {
  repository?: NewsRepository;
  fetcher: SourceFetcher;
  summarizer?: Summarizer;
  now?: () => Date;
}

export interface CollectOptions {
  date?: string;
  sources?: Source[];
  force?: boolean;
  trigger?: 'cron' | 'api';
}

export interface CollectSourceResult {
  source: Source;
  status: SourceRunStatus;
  fetched: number;
  inserted: number;
  duplicates: number;
  failed: number;
  durationMs: number;
  attempts: number;
  error?: { code: string; message: string };
}

export interface CollectResult {
  runId: string;
  status: RunStatus;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  date: string;
  totals: CollectRunTotals;
  sources: CollectSourceResult[];
}

interface SourceOutcome extends CollectSourceResult {
  summaryOk: number;
  summaryFailed: number;
}

interface RunContext {
  repository: NewsRepository;
  date: string;
  sources: Source[];
  trigger: 'cron' | 'api';
  force: boolean;
  now: () => Date;
  deps: CollectDeps;
}

const activeDates = new Set<string>();

/** 当日 Asia/Shanghai 自然日（YYYY-MM-DD）。 */
export function shanghaiDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(new Date(`${date}T00:00:00.000+08:00`).getTime());
}

function emptyTotals(): CollectRunTotals {
  return { fetched: 0, inserted: 0, duplicates: 0, summaryOk: 0, summaryFailed: 0 };
}

function newId(): string {
  const cryptoLike = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof cryptoLike?.randomUUID === 'function') return cryptoLike.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function truncate(value: string): string {
  return value.length > MAX_ERROR_MESSAGE_LENGTH ? value.slice(0, MAX_ERROR_MESSAGE_LENGTH) : value;
}

function toError(cause: unknown): { code: string; message: string } {
  if (cause instanceof CollectError) return { code: cause.code, message: truncate(cause.message) };
  const message = cause instanceof Error ? cause.message : String(cause);
  return { code: 'FETCH_FAILED', message: truncate(message) };
}

function toPublic(outcome: SourceOutcome): CollectSourceResult {
  return {
    source: outcome.source,
    status: outcome.status,
    fetched: outcome.fetched,
    inserted: outcome.inserted,
    duplicates: outcome.duplicates,
    failed: outcome.failed,
    durationMs: outcome.durationMs,
    attempts: outcome.attempts,
    ...(outcome.error ? { error: outcome.error } : {}),
  };
}

/** 执行一轮采集：抢锁 → 幂等短路 → 逐源抓取/去重/入库/摘要 → 回填批次汇总。 */
export async function runCollect(options: CollectOptions, deps: CollectDeps): Promise<CollectResult> {
  const repository = deps.repository ?? getNewsRepository();
  const now = deps.now ?? (() => new Date());
  const date = options.date ?? shanghaiDate(now());
  if (!isValidDate(date)) throw new CollectError('INVALID_DATE', `invalid date: ${date}`);
  const sources = options.sources && options.sources.length > 0 ? [...new Set(options.sources)] : [...ALL_SOURCES];
  const unknown = sources.filter((source) => !ALL_SOURCES.includes(source));
  if (unknown.length > 0) throw new CollectError('INVALID_SOURCE', `unknown source: ${unknown.join(',')}`);
  if (activeDates.has(date)) throw new CollectError('COLLECT_IN_PROGRESS', `collect already running for ${date}`);

  activeDates.add(date);
  try {
    return await executeRun({
      repository,
      date,
      sources,
      trigger: options.trigger ?? 'api',
      force: options.force === true,
      now,
      deps,
    });
  } finally {
    activeDates.delete(date);
  }
}

async function executeRun(ctx: RunContext): Promise<CollectResult> {
  const startedAt = ctx.now();
  const runId = newId();
  const successRun = ctx.force ? null : await ctx.repository.findSuccessfulRun(ctx.date);
  const placeholder: CollectRunRecord = {
    id: runId,
    trigger: ctx.trigger,
    runDate: ctx.date,
    status: 'failed',
    startedAt,
    finishedAt: null,
    durationMs: null,
    totals: emptyTotals(),
  };
  await ctx.repository.createRun(placeholder);

  if (successRun) {
    const skipped: CollectSourceResult[] = [];
    for (const source of ctx.sources) {
      await ctx.repository.saveSourceRun({
        runId,
        source,
        status: 'skipped',
        fetched: 0,
        inserted: 0,
        duplicates: 0,
        failed: 0,
        durationMs: 0,
        attempts: 1,
        errorCode: null,
        errorMessage: null,
      });
      skipped.push({ source, status: 'skipped', fetched: 0, inserted: 0, duplicates: 0, failed: 0, durationMs: 0, attempts: 1 });
    }
    const finishedAt = ctx.now();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    const totals = emptyTotals();
    await ctx.repository.finishRun(runId, { status: 'success', finishedAt, durationMs, totals });
    return { runId, status: 'success', startedAt, finishedAt, durationMs, date: ctx.date, totals, sources: skipped };
  }

  const totals = emptyTotals();
  const outcomes: SourceOutcome[] = [];
  for (const source of ctx.sources) {
    const outcome = await collectSource(ctx, source);
    outcomes.push(outcome);
    totals.fetched += outcome.fetched;
    totals.inserted += outcome.inserted;
    totals.duplicates += outcome.duplicates;
    totals.summaryOk += outcome.summaryOk;
    totals.summaryFailed += outcome.summaryFailed;
    await ctx.repository.saveSourceRun({
      runId,
      source,
      status: outcome.status,
      fetched: outcome.fetched,
      inserted: outcome.inserted,
      duplicates: outcome.duplicates,
      failed: outcome.failed,
      durationMs: outcome.durationMs,
      attempts: outcome.attempts,
      errorCode: outcome.error?.code ?? null,
      errorMessage: outcome.error?.message ?? null,
    });
  }

  const succeeded = outcomes.filter((outcome) => outcome.status === 'success').length;
  const status: RunStatus = succeeded === 0 ? 'failed' : succeeded === outcomes.length ? 'success' : 'partial_failure';
  const finishedAt = ctx.now();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  await ctx.repository.finishRun(runId, { status, finishedAt, durationMs, totals });
  return { runId, status, startedAt, finishedAt, durationMs, date: ctx.date, totals, sources: outcomes.map(toPublic) };
}

async function collectSource(ctx: RunContext, source: Source): Promise<SourceOutcome> {
  const startedAt = ctx.now();
  let attempts = 0;
  let items: RawItem[] = [];
  let error: { code: string; message: string } | undefined;
  while (attempts < MAX_ATTEMPTS) {
    attempts += 1;
    try {
      items = await ctx.deps.fetcher(source);
      error = undefined;
      break;
    } catch (cause) {
      error = toError(cause);
    }
  }

  const outcome: SourceOutcome = {
    source,
    status: error ? 'failed' : 'success',
    fetched: items.length,
    inserted: 0,
    duplicates: 0,
    failed: 0,
    durationMs: 0,
    attempts,
    summaryOk: 0,
    summaryFailed: 0,
    ...(error ? { error } : {}),
  };

  for (const item of items) {
    const persisted = await persistItem(ctx, item);
    if (!persisted.inserted) {
      outcome.duplicates += 1;
      continue;
    }
    outcome.inserted += 1;
    if (persisted.summarized) {
      outcome.summaryOk += 1;
    } else {
      outcome.summaryFailed += 1;
      outcome.failed += 1;
    }
  }

  outcome.durationMs = Math.max(0, ctx.now().getTime() - startedAt.getTime());
  return outcome;
}

async function persistItem(ctx: RunContext, item: RawItem): Promise<{ inserted: boolean; summarized: boolean }> {
  const record: NewsItemRecord = {
    id: newId(),
    title: item.title,
    url: item.url,
    source: item.source,
    externalId: item.externalId ?? null,
    publishedAt: item.publishedAt,
    summary: null,
    summaryStatus: 'pending',
    category: DEFAULT_CATEGORY,
    rawExcerpt: item.rawExcerpt ? truncate(item.rawExcerpt) : null,
  };
  const result = await ctx.repository.insertNews(record);
  if (!result.inserted) return { inserted: false, summarized: false };
  return { inserted: true, summarized: await summarizeItem(ctx, record) };
}

/** LLM 失败降级：条目保留、summary_status=failed、分类兜底 industry_news，不阻塞批次。 */
async function summarizeItem(ctx: RunContext, record: NewsItemRecord): Promise<boolean> {
  try {
    const outcome = ctx.deps.summarizer ? await ctx.deps.summarizer(record) : null;
    if (!outcome || !outcome.summary || outcome.summary.trim().length === 0) throw new Error('empty summary');
    const category = CATEGORIES.includes(outcome.category) ? outcome.category : DEFAULT_CATEGORY;
    await ctx.repository.saveSummary(record.id, {
      summary: outcome.summary.slice(0, SUMMARY_MAX_LENGTH),
      category,
      summaryStatus: 'ok',
    });
    return true;
  } catch {
    await ctx.repository.saveSummary(record.id, {
      summary: null,
      category: record.category,
      summaryStatus: 'failed',
    });
    return false;
  }
}
