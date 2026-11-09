import { normalizeUrl, titleFingerprint, titleSimilarity, TITLE_SIMILARITY_THRESHOLD } from '../dedup';
import type { Category, NewsItemRecord, RunStatus, Source, SourceRunStatus, SummaryStatus } from '../types';
import type { Database } from './postgres';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  dedupTitleOf,
  shanghaiDayRange,
  type CollectRunQuery,
  type CollectRunRecord,
  type CollectRunSourceRecord,
  type FinishRunPatch,
  type InsertNewsResult,
  type NewsListResult,
  type NewsQuery,
  type NewsRepository,
  type SummaryPatch,
} from './repository';

const DAY_MS = 86_400_000;
const DUPLICATE_WINDOW_MS = 7 * DAY_MS;

function resolvePaging(page?: number, limit?: number): { page: number; limit: number } {
  const safePage = Number.isInteger(page) && (page as number) >= 1 ? (page as number) : 1;
  const safeLimit = Number.isInteger(limit) && (limit as number) >= 1 ? (limit as number) : DEFAULT_PAGE_SIZE;
  return { page: safePage, limit: Math.min(safeLimit, MAX_PAGE_SIZE) };
}

function mapNewsRow(row: Record<string, unknown>): NewsItemRecord {
  return {
    id: String(row.id),
    title: String(row.title),
    originalTitle: (row.original_title as string | null) ?? null,
    url: String(row.url),
    normalizedUrl: String(row.normalized_url),
    titleFingerprint: String(row.title_fingerprint),
    source: row.source as Source,
    externalId: (row.external_id as string | null) ?? null,
    publishedAt: new Date(String(row.published_at)),
    summary: (row.summary as string | null) ?? null,
    summaryStatus: row.summary_status as SummaryStatus,
    category: row.category as Category,
    rawExcerpt: (row.raw_excerpt as string | null) ?? null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.created_at ? new Date(String(row.created_at)) : undefined,
    updatedAt: row.updated_at ? new Date(String(row.updated_at)) : undefined,
  };
}

function mapRunRow(row: Record<string, unknown>): CollectRunRecord {
  return {
    id: String(row.id),
    trigger: row.trigger_type === 'cron' ? 'cron' : 'api',
    runDate: String(row.run_date).slice(0, 10),
    status: row.status as RunStatus,
    startedAt: new Date(String(row.started_at)),
    finishedAt: row.finished_at ? new Date(String(row.finished_at)) : null,
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    totals: {
      fetched: Number(row.fetched ?? 0),
      inserted: Number(row.inserted ?? 0),
      duplicates: Number(row.duplicates ?? 0),
      summaryOk: Number(row.summary_ok ?? 0),
      summaryFailed: Number(row.summary_failed ?? 0),
    },
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === '23505');
}

export class PostgresNewsRepository implements NewsRepository {
  constructor(private readonly db: Database) {}

  async ping(): Promise<void> {
    await this.db.query('SELECT 1 AS ok');
  }

  async insertNews(record: NewsItemRecord): Promise<InsertNewsResult> {
    const normalizedUrl = normalizeUrl(record.url);
    const fingerprint = titleFingerprint(record.title);
    const existingUrl = await this.db.query(
      'SELECT id FROM news_items WHERE normalized_url = $1 LIMIT 1',
      [normalizedUrl],
    );
    if (existingUrl.rows[0]) {
      return { inserted: false, existingId: String(existingUrl.rows[0].id), reason: 'normalized_url' };
    }
    if (record.externalId) {
      const existingExt = await this.db.query(
        'SELECT id FROM news_items WHERE source = $1 AND external_id = $2 LIMIT 1',
        [record.source, record.externalId],
      );
      if (existingExt.rows[0]) {
        return { inserted: false, existingId: String(existingExt.rows[0].id), reason: 'external_id' };
      }
    }
    const windowStart = new Date(record.publishedAt.getTime() - DUPLICATE_WINDOW_MS);
    const windowEnd = new Date(record.publishedAt.getTime() + DUPLICATE_WINDOW_MS);
    const candidates = await this.db.query(
      `SELECT id, COALESCE(original_title, title) AS title FROM news_items
       WHERE published_at >= $1 AND published_at <= $2
       ORDER BY published_at DESC
       LIMIT 200`,
      [windowStart.toISOString(), windowEnd.toISOString()],
    );
    for (const row of candidates.rows) {
      if (titleSimilarity(String(row.title), dedupTitleOf(record)) > TITLE_SIMILARITY_THRESHOLD) {
        return { inserted: false, existingId: String(row.id), reason: 'title_similarity' };
      }
    }

    const now = new Date();
    try {
      await this.db.query(
        `INSERT INTO news_items (
          id, title, original_title, url, normalized_url, title_fingerprint, source, external_id,
          published_at, summary, summary_status, category, raw_excerpt, metadata, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,
          $9,$10,$11,$12,$13,$14,$15,$16
        )`,
        [
          record.id,
          record.title,
          record.originalTitle ?? null,
          record.url,
          normalizedUrl,
          fingerprint,
          record.source,
          record.externalId ?? null,
          record.publishedAt.toISOString(),
          record.summary,
          record.summaryStatus,
          record.category,
          record.rawExcerpt ?? null,
          record.metadata ? JSON.stringify(record.metadata) : null,
          (record.createdAt ?? now).toISOString(),
          (record.updatedAt ?? now).toISOString(),
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { inserted: false, reason: 'normalized_url' };
      }
      throw error;
    }
    return { inserted: true };
  }

  async listNews(query: NewsQuery): Promise<NewsListResult> {
    const { page, limit } = resolvePaging(query.page, query.limit);
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(`${sql} $${params.length}`);
    };
    if (query.q) {
      params.push(`%${query.q.toLocaleLowerCase()}%`);
      where.push(
        `(LOWER(title) LIKE $${params.length} OR LOWER(COALESCE(original_title, '')) LIKE $${params.length} OR LOWER(COALESCE(summary, '')) LIKE $${params.length})`,
      );
    }
    if (query.category) add('category =', query.category);
    if (query.source) add('source =', query.source);
    if (query.date) {
      const range = shanghaiDayRange(query.date);
      if (!range) return { items: [], total: 0, page, limit };
      add('published_at >=', range.start.toISOString());
      add('published_at <', range.end.toISOString());
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalResult = await this.db.query(`SELECT COUNT(*)::int AS total FROM news_items ${whereSql}`, params);
    const total = Number(totalResult.rows[0]?.total ?? 0);
    const offset = (page - 1) * limit;
    params.push(limit, offset);
    const rows = await this.db.query(
      `SELECT * FROM news_items ${whereSql}
       ORDER BY published_at DESC, id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rows.rows.map(mapNewsRow), total, page, limit };
  }

  async getNewsById(id: string): Promise<NewsItemRecord | null> {
    const result = await this.db.query('SELECT * FROM news_items WHERE id = $1 LIMIT 1', [id]);
    return result.rows[0] ? mapNewsRow(result.rows[0]) : null;
  }

  async saveSummary(id: string, patch: SummaryPatch): Promise<NewsItemRecord | null> {
    const result = await this.db.query(
      `UPDATE news_items
       SET summary = $2, category = $3, summary_status = $4,
           title = COALESCE($5, title), original_title = COALESCE($6, original_title), updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, patch.summary, patch.category, patch.summaryStatus, patch.title ?? null, patch.originalTitle ?? null],
    );
    return result.rows[0] ? mapNewsRow(result.rows[0]) : null;
  }

  async createRun(run: CollectRunRecord): Promise<CollectRunRecord> {
    await this.db.query(
      `INSERT INTO collect_runs (
        id, trigger_type, run_date, status, started_at, finished_at, duration_ms,
        fetched, inserted, duplicates, summary_ok, summary_failed
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        run.id,
        run.trigger,
        run.runDate,
        run.status,
        run.startedAt.toISOString(),
        run.finishedAt ? run.finishedAt.toISOString() : null,
        run.durationMs,
        run.totals.fetched,
        run.totals.inserted,
        run.totals.duplicates,
        run.totals.summaryOk,
        run.totals.summaryFailed,
      ],
    );
    return run;
  }

  async finishRun(id: string, patch: FinishRunPatch): Promise<CollectRunRecord | null> {
    const result = await this.db.query(
      `UPDATE collect_runs SET
        status = $2,
        finished_at = $3,
        duration_ms = $4,
        fetched = $5,
        inserted = $6,
        duplicates = $7,
        summary_ok = $8,
        summary_failed = $9
       WHERE id = $1
       RETURNING *`,
      [
        id,
        patch.status,
        patch.finishedAt.toISOString(),
        patch.durationMs,
        patch.totals.fetched,
        patch.totals.inserted,
        patch.totals.duplicates,
        patch.totals.summaryOk,
        patch.totals.summaryFailed,
      ],
    );
    return result.rows[0] ? mapRunRow(result.rows[0]) : null;
  }

  async saveSourceRun(record: CollectRunSourceRecord): Promise<CollectRunSourceRecord> {
    const id = `${record.runId}:${record.source}`;
    await this.db.query(
      `INSERT INTO collect_run_sources (
        id, run_id, source, status, fetched, inserted, duplicates, failed, duration_ms, attempts, error_code, error_message
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (run_id, source) DO UPDATE SET
        status = EXCLUDED.status,
        fetched = EXCLUDED.fetched,
        inserted = EXCLUDED.inserted,
        duplicates = EXCLUDED.duplicates,
        failed = EXCLUDED.failed,
        duration_ms = EXCLUDED.duration_ms,
        attempts = EXCLUDED.attempts,
        error_code = EXCLUDED.error_code,
        error_message = EXCLUDED.error_message`,
      [
        id,
        record.runId,
        record.source,
        record.status,
        record.fetched,
        record.inserted,
        record.duplicates,
        record.failed,
        record.durationMs,
        record.attempts,
        record.errorCode ?? null,
        record.errorMessage ?? null,
      ],
    );
    return record;
  }

  async getRun(id: string): Promise<{ run: CollectRunRecord; sources: CollectRunSourceRecord[] } | null> {
    const runResult = await this.db.query('SELECT * FROM collect_runs WHERE id = $1 LIMIT 1', [id]);
    if (!runResult.rows[0]) return null;
    const sourcesResult = await this.db.query(
      'SELECT * FROM collect_run_sources WHERE run_id = $1 ORDER BY source ASC',
      [id],
    );
    return {
      run: mapRunRow(runResult.rows[0]),
      sources: sourcesResult.rows.map((row) => ({
        runId: String(row.run_id),
        source: row.source as Source,
        status: row.status as SourceRunStatus,
        fetched: Number(row.fetched ?? 0),
        inserted: Number(row.inserted ?? 0),
        duplicates: Number(row.duplicates ?? 0),
        failed: Number(row.failed ?? 0),
        durationMs: Number(row.duration_ms ?? 0),
        attempts: Number(row.attempts ?? 1),
        errorCode: (row.error_code as string | null) ?? null,
        errorMessage: (row.error_message as string | null) ?? null,
      })),
    };
  }

  async listRuns(query: CollectRunQuery) {
    const { page, limit } = resolvePaging(query.page, query.limit);
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.date) {
      params.push(query.date);
      where.push(`run_date = $${params.length}`);
    }
    if (query.status) {
      params.push(query.status);
      where.push(`status = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalResult = await this.db.query(`SELECT COUNT(*)::int AS total FROM collect_runs ${whereSql}`, params);
    const total = Number(totalResult.rows[0]?.total ?? 0);
    params.push(limit, (page - 1) * limit);
    const rows = await this.db.query(
      `SELECT * FROM collect_runs ${whereSql}
       ORDER BY started_at DESC, id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rows.rows.map(mapRunRow), total, page, limit };
  }

  async findSuccessfulRun(date: string): Promise<CollectRunRecord | null> {
    const result = await this.db.query(
      `SELECT * FROM collect_runs
       WHERE run_date = $1
         AND finished_at IS NOT NULL
         AND status IN ('success', 'partial_failure')
       ORDER BY started_at DESC
       LIMIT 1`,
      [date],
    );
    return result.rows[0] ? mapRunRow(result.rows[0]) : null;
  }
}
