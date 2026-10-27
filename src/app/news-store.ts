import {
  TITLE_SIMILARITY_THRESHOLD,
  normalizeUrl,
  titleFingerprint,
  titleSimilarity,
} from './news-dedup';

/**
 * 内存仓库：news_items / collect_runs / collect_run_sources 的等价实现。
 * 去重语义与索引一致：normalized_url 唯一 → (source, external_id) 唯一 → 近 7 天标题相似度 > 0.9。
 * 排序固定 publishedAt DESC, id DESC（稳定分页）；summary_status=failed 的条目照常返回。
 * 签名对齐未来 Prisma 仓储，可在运行时整体替换。
 */

export type SummaryStatus = 'ok' | 'failed' | 'pending';
export type RunStatus = 'success' | 'partial_failure' | 'failed';
export type SourceRunStatus = 'success' | 'failed' | 'skipped';
export type RunTrigger = 'cron' | 'api';
export type DuplicateReason = 'normalized_url' | 'external_id' | 'title_similarity';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
export const MAX_ATTEMPTS = 3;
export const TITLE_DEDUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TEXT = 2000;

export interface NewsItem {
  id: string;
  title: string;
  originalTitle: string | null;
  url: string;
  normalizedUrl: string;
  titleFingerprint: string;
  source: string;
  externalId: string | null;
  publishedAt: Date;
  summary: string | null;
  summaryStatus: SummaryStatus;
  category: string;
  rawExcerpt: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InsertNewsInput {
  title: string;
  url: string;
  source: string;
  category: string;
  publishedAt: Date;
  id?: string;
  originalTitle?: string | null;
  externalId?: string | null;
  summary?: string | null;
  summaryStatus?: SummaryStatus;
  rawExcerpt?: string | null;
}

export type InsertNewsResult =
  | { inserted: true; item: NewsItem }
  | { inserted: false; reason: DuplicateReason };

export interface ListNewsFilter {
  startUtc?: Date;
  endUtc?: Date;
  category?: string;
  source?: string;
  page?: number;
  limit?: number;
}

export interface RunTotals {
  fetched: number;
  inserted: number;
  duplicates: number;
  summaryOk: number;
  summaryFailed: number;
}

export interface CollectRun {
  id: string;
  trigger: RunTrigger;
  date: string;
  status: RunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  totals: RunTotals;
  createdAt: Date;
}

export interface SourceRun {
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
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
}

export interface SourceRunInput {
  runId: string;
  source: string;
  status: SourceRunStatus;
  fetched?: number;
  inserted?: number;
  duplicates?: number;
  failed?: number;
  durationMs?: number;
  attempts?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface FinishRunOptions {
  finishedAt?: Date;
  summaryOk?: number;
  summaryFailed?: number;
}

export interface RunDetail {
  run: CollectRun;
  sources: SourceRun[];
}

export interface ListResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface NewsStore {
  insertNews(input: InsertNewsInput): InsertNewsResult;
  listNews(filter?: ListNewsFilter): ListResult<NewsItem>;
  getNewsById(id: string): NewsItem | null;
  saveSummary(
    id: string,
    patch: { summary: string | null; summaryStatus: SummaryStatus; category?: string },
  ): NewsItem | null;
  createRun(input: { trigger: RunTrigger; date: string; id?: string; startedAt?: Date }): CollectRun;
  saveSourceRun(input: SourceRunInput): SourceRun;
  finishRun(id: string, status: RunStatus, options?: FinishRunOptions): RunDetail | null;
  getRun(id: string): RunDetail | null;
  listRuns(filter?: { date?: string; status?: RunStatus; page?: number; limit?: number }): ListResult<CollectRun>;
  findSuccessfulRun(date: string): CollectRun | null;
}

const emptyTotals = (): RunTotals => ({
  fetched: 0,
  inserted: 0,
  duplicates: 0,
  summaryOk: 0,
  summaryFailed: 0,
});

/** raw_excerpt / error_message 写入前截断（≤ 2000 字），不落任何凭据。 */
const truncate = (value?: string | null): string | null =>
  typeof value === 'string' && value.length > 0 ? value.slice(0, MAX_TEXT) : null;

const clampPaging = (page?: number, limit?: number): { page: number; limit: number } => ({
  page: Math.max(1, Math.trunc(page ?? 1)),
  limit: Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit ?? DEFAULT_LIMIT))),
});

const paginate = <T>(rows: T[], page?: number, limit?: number): ListResult<T> => {
  const paging = clampPaging(page, limit);
  const start = (paging.page - 1) * paging.limit;
  return {
    items: rows.slice(start, start + paging.limit),
    page: paging.page,
    limit: paging.limit,
    total: rows.length,
    totalPages: Math.max(1, Math.ceil(rows.length / paging.limit)),
  };
};

const compareNews = (a: NewsItem, b: NewsItem): number =>
  b.publishedAt.getTime() - a.publishedAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

const compareRuns = (a: CollectRun, b: CollectRun): number =>
  b.startedAt.getTime() - a.startedAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

const SUCCESS_STATUSES: RunStatus[] = ['success', 'partial_failure'];

export function createNewsStore(): NewsStore {
  let seq = 0;
  const nextId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}${(seq += 1).toString(36)}`;
  const items = new Map<string, NewsItem>();
  const runs = new Map<string, CollectRun>();
  const sourceRuns = new Map<string, SourceRun>();
  const sourceKey = (runId: string, source: string): string => `${runId}::${source}`;
  const sourcesOf = (runId: string): SourceRun[] =>
    [...sourceRuns.values()].filter((row) => row.runId === runId);

  return {
    insertNews(input) {
      const normalizedUrl = normalizeUrl(input.url);
      for (const item of items.values()) {
        if (item.normalizedUrl === normalizedUrl) return { inserted: false, reason: 'normalized_url' };
      }
      if (input.externalId) {
        for (const item of items.values()) {
          if (item.source === input.source && item.externalId === input.externalId) {
            return { inserted: false, reason: 'external_id' };
          }
        }
      }
      for (const item of items.values()) {
        const gap = Math.abs(item.publishedAt.getTime() - input.publishedAt.getTime());
        if (gap <= TITLE_DEDUP_WINDOW_MS && titleSimilarity(item.title, input.title) > TITLE_SIMILARITY_THRESHOLD) {
          return { inserted: false, reason: 'title_similarity' };
        }
      }
      const now = new Date();
      const item: NewsItem = {
        id: input.id ?? nextId('news'),
        title: input.title,
        originalTitle: input.originalTitle ?? null,
        url: input.url,
        normalizedUrl,
        titleFingerprint: titleFingerprint(input.title),
        source: input.source,
        externalId: input.externalId ?? null,
        publishedAt: input.publishedAt,
        summary: input.summary ?? null,
        summaryStatus: input.summaryStatus ?? 'pending',
        category: input.category,
        rawExcerpt: truncate(input.rawExcerpt),
        createdAt: now,
        updatedAt: now,
      };
      items.set(item.id, item);
      return { inserted: true, item };
    },

    listNews(filter = {}) {
      const rows = [...items.values()]
        .filter((item) => {
          if (filter.category && item.category !== filter.category) return false;
          if (filter.source && item.source !== filter.source) return false;
          if (filter.startUtc && item.publishedAt.getTime() < filter.startUtc.getTime()) return false;
          if (filter.endUtc && item.publishedAt.getTime() >= filter.endUtc.getTime()) return false;
          return true;
        })
        .sort(compareNews);
      return paginate(rows, filter.page, filter.limit);
    },

    getNewsById(id) {
      return items.get(id) ?? null;
    },

    saveSummary(id, patch) {
      const current = items.get(id);
      if (!current) return null;
      const updated: NewsItem = {
        ...current,
        summary: patch.summary,
        summaryStatus: patch.summaryStatus,
        category: patch.category ?? current.category,
        updatedAt: new Date(),
      };
      items.set(id, updated);
      return updated;
    },

    createRun(input) {
      const startedAt = input.startedAt ?? new Date();
      const run: CollectRun = {
        id: input.id ?? nextId('run'),
        trigger: input.trigger,
        date: input.date,
        // 占位状态：结束前不视为成功批次，finishRun 回填终态。
        status: 'failed',
        startedAt,
        finishedAt: null,
        durationMs: null,
        totals: emptyTotals(),
        createdAt: startedAt,
      };
      runs.set(run.id, run);
      return run;
    },

    saveSourceRun(input) {
      const key = sourceKey(input.runId, input.source);
      const prev = sourceRuns.get(key);
      // 唯一键 (run_id, source)：重试只更新 attempts 与计数，不新增行。
      const attempts = Math.min(MAX_ATTEMPTS, input.attempts ?? (prev ? prev.attempts + 1 : 1));
      const row: SourceRun = {
        id: prev?.id ?? nextId('src'),
        runId: input.runId,
        source: input.source,
        status: input.status,
        fetched: input.fetched ?? prev?.fetched ?? 0,
        inserted: input.inserted ?? prev?.inserted ?? 0,
        duplicates: input.duplicates ?? prev?.duplicates ?? 0,
        failed: input.failed ?? prev?.failed ?? 0,
        durationMs: input.durationMs ?? prev?.durationMs ?? 0,
        attempts,
        errorCode: input.errorCode ?? null,
        errorMessage: truncate(input.errorMessage),
        createdAt: prev?.createdAt ?? new Date(),
      };
      sourceRuns.set(key, row);
      return row;
    },

    finishRun(id, status, options = {}) {
      const run = runs.get(id);
      if (!run) return null;
      const sources = sourcesOf(id);
      const finishedAt = options.finishedAt ?? new Date();
      const totals = emptyTotals();
      for (const row of sources) {
        totals.fetched += row.fetched;
        totals.inserted += row.inserted;
        totals.duplicates += row.duplicates;
      }
      totals.summaryOk = options.summaryOk ?? 0;
      totals.summaryFailed = options.summaryFailed ?? 0;
      const updated: CollectRun = {
        ...run,
        status,
        finishedAt,
        durationMs: Math.max(0, finishedAt.getTime() - run.startedAt.getTime()),
        totals,
      };
      runs.set(id, updated);
      return { run: updated, sources };
    },

    getRun(id) {
      const run = runs.get(id);
      return run ? { run, sources: sourcesOf(id) } : null;
    },

    listRuns(filter = {}) {
      const rows = [...runs.values()]
        .filter((run) => {
          if (filter.date && run.date !== filter.date) return false;
          if (filter.status && run.status !== filter.status) return false;
          return true;
        })
        .sort(compareRuns);
      return paginate(rows, filter.page, filter.limit);
    },

    findSuccessfulRun(date) {
      const rows = [...runs.values()]
        .filter((run) => run.date === date && SUCCESS_STATUSES.includes(run.status))
        .sort(compareRuns);
      return rows[0] ?? null;
    },
  };
}

export const newsStore: NewsStore = createNewsStore();
