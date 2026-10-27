import { getNewsRepository } from '../../../lib/db/repository';
import { isIsoDate } from '../../../lib/query';
import { errorResponse, jsonResponse } from '../../../lib/runtime';

export const dynamic = 'force-dynamic';

const RUN_STATUS_VALUES = ['success', 'partial_failure', 'failed'];
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

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

function parseInteger(raw: string | null): number | null {
  const value = raw?.trim() ?? '';
  if (value === '') return null;
  if (!/^\d+$/.test(value)) return Number.NaN;
  return Number.parseInt(value, 10);
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

function toRunItem(value: unknown) {
  const run = asRecord(value);
  return {
    runId: asText(run.runId) ?? asText(run.id) ?? '',
    trigger: asText(run.trigger) ?? asText(run.triggerType) ?? 'api',
    date: asDay(run.date ?? run.runDate),
    status: asText(run.status) ?? 'failed',
    startedAt: asIso(run.startedAt),
    finishedAt: asIso(run.finishedAt),
    durationMs: run.durationMs === null || run.durationMs === undefined ? null : asNumber(run.durationMs),
    totals: totalsOf(run),
  };
}

/** GET /api/collect-runs：批次列表，默认 limit=20，按 startedAt 倒序（由仓储负责）。 */
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);

  const date = searchParams.get('date');
  if (date !== null && date !== '' && !isIsoDate(date)) {
    return errorResponse('INVALID_DATE', 'date must be YYYY-MM-DD', 400);
  }

  const status = searchParams.get('status');
  if (status !== null && status !== '' && !RUN_STATUS_VALUES.includes(status)) {
    return errorResponse('INVALID_STATUS', 'status must be one of success|partial_failure|failed', 400);
  }

  const pageParam = parseInteger(searchParams.get('page'));
  if (Number.isNaN(pageParam) || (pageParam !== null && pageParam < 1)) {
    return errorResponse('INVALID_PAGINATION', 'page must be an integer >= 1', 400);
  }

  const limitParam = parseInteger(searchParams.get('limit'));
  if (Number.isNaN(limitParam) || (limitParam !== null && (limitParam < 1 || limitParam > MAX_LIMIT))) {
    return errorResponse('INVALID_PAGINATION', `limit must be an integer between 1 and ${MAX_LIMIT}`, 400);
  }

  const page = pageParam ?? 1;
  const limit = limitParam ?? DEFAULT_LIMIT;
  const filter: Record<string, unknown> = { page, limit, offset: (page - 1) * limit };
  if (date) filter.date = date;
  if (status) filter.status = status;

  let raw: unknown;
  try {
    const repository = getNewsRepository() as unknown as {
      listRuns?: (input: Record<string, unknown>) => Promise<unknown>;
    };
    raw = typeof repository.listRuns === 'function' ? await repository.listRuns(filter) : [];
  } catch {
    return errorResponse('INTERNAL_ERROR', 'failed to load collect runs', 500);
  }

  const rawRecord = asRecord(raw);
  const rawItems = Array.isArray(raw)
    ? raw
    : Array.isArray(rawRecord.items)
      ? rawRecord.items
      : Array.isArray(rawRecord.runs)
        ? rawRecord.runs
        : [];
  const items = rawItems.map(toRunItem);
  const total = Array.isArray(raw) ? items.length : asNumber(rawRecord.total, items.length);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return jsonResponse({ items, page, limit, total, totalPages });
}
