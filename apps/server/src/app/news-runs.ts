import { sanitizeMessage } from './news-errors';
import type { SqlRunner } from './news-persist';

export type RunTrigger = 'cron' | 'api';
export type RunStatus = 'success' | 'partial_failure' | 'failed';
export type SourceRunStatus = 'success' | 'failed' | 'skipped';

export interface RunTotals {
  fetched: number;
  inserted: number;
  duplicates: number;
  summaryOk: number;
  summaryFailed: number;
}

export interface CreateRunInput {
  runId: string;
  trigger: RunTrigger;
  runDate: string;
  startedAt: Date;
}

export interface FinishRunInput {
  runId: string;
  status: RunStatus;
  finishedAt: Date;
  durationMs: number;
  totals: RunTotals;
}

export interface SourceRunInput {
  id: string;
  runId: string;
  source: string;
  status: SourceRunStatus;
  fetched: number;
  inserted: number;
  duplicates: number;
  failed: number;
  durationMs: number;
  attempts: number;
  errorCode?: string | null;
  errorMessage?: string | null;
}

const CREATE_RUN_SQL = [
  'INSERT INTO collect_runs (id, trigger_type, run_date, status, started_at)',
  " VALUES ($1, $2, $3, 'failed', $4)",
  ' ON CONFLICT (id) DO NOTHING',
].join('');

const FINISH_RUN_SQL = [
  'UPDATE collect_runs SET status = $2, finished_at = $3, duration_ms = $4, fetched = $5,',
  ' inserted = $6, duplicates = $7, summary_ok = $8, summary_failed = $9 WHERE id = $1',
].join('');

const SOURCE_RUN_SQL = [
  'INSERT INTO collect_run_sources (id, run_id, source, status, fetched, inserted, duplicates,',
  ' failed, duration_ms, attempts, error_code, error_message)',
  ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
  ' ON CONFLICT (run_id, source) DO UPDATE SET status = EXCLUDED.status,',
  ' fetched = EXCLUDED.fetched, inserted = EXCLUDED.inserted, duplicates = EXCLUDED.duplicates,',
  ' failed = EXCLUDED.failed, duration_ms = EXCLUDED.duration_ms, attempts = EXCLUDED.attempts,',
  ' error_code = EXCLUDED.error_code, error_message = EXCLUDED.error_message',
].join('');

/** 批次占位行：先落库保证失败/中断批次同样可查，终态由 finishCollectRun 覆盖。 */
export async function createCollectRun(runner: SqlRunner, input: CreateRunInput): Promise<void> {
  await runner.query(CREATE_RUN_SQL, [input.runId, input.trigger, input.runDate, input.startedAt]);
}

/** 回填批次终态：status、finished_at、duration_ms 与五项汇总计数。 */
export async function finishCollectRun(runner: SqlRunner, input: FinishRunInput): Promise<void> {
  await runner.query(FINISH_RUN_SQL, [
    input.runId,
    input.status,
    input.finishedAt,
    input.durationMs,
    input.totals.fetched,
    input.totals.inserted,
    input.totals.duplicates,
    input.totals.summaryOk,
    input.totals.summaryFailed,
  ]);
}

/** 逐源明细 upsert：唯一键 (run_id, source)，重试只更新计数与 attempts。 */
export async function saveSourceRun(runner: SqlRunner, input: SourceRunInput): Promise<void> {
  const errorMessage = input.errorMessage ? sanitizeMessage(input.errorMessage) : null;
  await runner.query(SOURCE_RUN_SQL, [
    input.id,
    input.runId,
    input.source,
    input.status,
    input.fetched,
    input.inserted,
    input.duplicates,
    input.failed,
    input.durationMs,
    input.attempts,
    input.errorCode ?? null,
    errorMessage,
  ]);
}
