import { getNewsRepository } from '../../../../lib/db/repository';
import { errorResponse, jsonResponse } from '../../../../lib/runtime';

export const dynamic = 'force-dynamic';

const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asDay(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  return '';
}

function asIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return asText(value);
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function totalsOf(run: Record<string, unknown>) {
  const totals = asRecord(run.totals);
  return {
    fetched: asNumber(totals.fetched),
    inserted: asNumber(totals.inserted),
    duplicates: asNumber(totals.duplicates),
    summaryOk: asNumber(totals.summaryOk),
    summaryFailed: asNumber(totals.summaryFailed),
  };
}

function toSourceItem(value: unknown) {
  const row = asRecord(value);
  const error = asRecord(row.error);
  const code = asText(row.errorCode) ?? asText(error.code);
  const message = asText(row.errorMessage) ?? asText(error.message);
  return {
    source: asText(row.source) ?? 'unknown',
    status: asText(row.status) ?? 'failed',
    fetched: asNumber(row.fetched),
    inserted: asNumber(row.inserted),
    duplicates: asNumber(row.duplicates),
    failed: asNumber(row.failed),
    durationMs: asNumber(row.durationMs),
    attempts: asNumber(row.attempts, 1),
    ...(code || message ? { error: { code: code ?? 'UNKNOWN', message: message ?? '' } } : {}),
  };
}

/** GET /api/collect-runs/{runId}：批次汇总 + 逐源明细（脱敏后的失败原因）。 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const params = await context.params;
  const runId = typeof params?.runId === 'string' ? params.runId.trim() : '';
  if (!RUN_ID_PATTERN.test(runId)) {
    return errorResponse('INVALID_RUN_ID', 'runId must be a non-empty identifier', 400);
  }

  let raw: unknown;
  try {
    const repository = getNewsRepository() as unknown as { getRun?: (id: string) => Promise<unknown> };
    raw = typeof repository.getRun === 'function' ? await repository.getRun(runId) : null;
  } catch {
    return errorResponse('INTERNAL_ERROR', 'failed to load collect run', 500);
  }
  if (!raw) return errorResponse('RUN_NOT_FOUND', 'collect run not found', 404);

  const outer = asRecord(raw);
  const run = asRecord(outer.run ?? raw);
  const rawSources = Array.isArray(outer.sources)
    ? outer.sources
    : Array.isArray(run.sources)
      ? run.sources
      : [];

  return jsonResponse({
    runId: asText(run.runId) ?? asText(run.id) ?? runId,
    trigger: asText(run.trigger) ?? asText(run.triggerType) ?? 'api',
    date: asDay(run.date ?? run.runDate),
    status: asText(run.status) ?? 'failed',
    startedAt: asIso(run.startedAt),
    finishedAt: asIso(run.finishedAt),
    durationMs: run.durationMs === null || run.durationMs === undefined ? null : asNumber(run.durationMs),
    totals: totalsOf(run),
    sources: rawSources.map(toSourceItem),
  });
}
