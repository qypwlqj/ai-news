import { normalizeUrl, titleFingerprint, titleSimilarity, TITLE_SIMILARITY_THRESHOLD } from '../dedup';
import type { Category, NewsItemRecord, RunStatus, Source, SourceRunStatus, SummaryStatus } from '../types';

const DAY_MS = 86_400_000;
const DUPLICATE_WINDOW_MS = 7 * DAY_MS;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface NewsQuery {
  date?: string | null;
  category?: Category | null;
  source?: Source | null;
  page?: number;
  limit?: number;
}

export interface NewsListResult {
  items: NewsItemRecord[];
  total: number;
  page: number;
  limit: number;
}

export type DuplicateReason = 'normalized_url' | 'external_id' | 'title_similarity';

export interface InsertNewsResult {
  inserted: boolean;
  existingId?: string;
  reason?: DuplicateReason;
}

export interface SummaryPatch {
  summary: string | null;
  category: Category;
  summaryStatus: SummaryStatus;
}

export interface CollectRunTotals {
  fetched: number;
  inserted: number;
  duplicates: number;
  summaryOk: number;
  summaryFailed: number;
}

export interface CollectRunRecord {
  id: string;
  trigger: 'cron' | 'api';
  runDate: string;
  status: RunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  totals: CollectRunTotals;
}

export interface CollectRunSourceRecord {
  runId: string;
  source: Source;
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

export interface CollectRunQuery {
  date?: string | null;
  status?: RunStatus | null;
  page?: number;
  limit?: number;
}

export interface FinishRunPatch {
  status: RunStatus;
  finishedAt: Date;
  durationMs: number;
  totals: CollectRunTotals;
}

/** 唯一写入通道：采集编排与查询服务只依赖本接口，不直接拼 SQL。 */
export interface NewsRepository {
  insertNews(record: NewsItemRecord): Promise<InsertNewsResult>;
  listNews(query: NewsQuery): Promise<NewsListResult>;
  getNewsById(id: string): Promise<NewsItemRecord | null>;
  saveSummary(id: string, patch: SummaryPatch): Promise<NewsItemRecord | null>;
  createRun(run: CollectRunRecord): Promise<CollectRunRecord>;
  finishRun(id: string, patch: FinishRunPatch): Promise<CollectRunRecord | null>;
  saveSourceRun(record: CollectRunSourceRecord): Promise<CollectRunSourceRecord>;
  getRun(id: string): Promise<{ run: CollectRunRecord; sources: CollectRunSourceRecord[] } | null>;
  listRuns(query: CollectRunQuery): Promise<{ items: CollectRunRecord[]; total: number; page: number; limit: number }>;
  findSuccessfulRun(date: string): Promise<CollectRunRecord | null>;
}

/** date=YYYY-MM-DD 按 Asia/Shanghai 自然日换算为 UTC 半开区间 [start, end)。 */
export function shanghaiDayRange(date: string): { start: Date; end: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const start = new Date(`${date}T00:00:00.000+08:00`);
  if (Number.isNaN(start.getTime())) return null;
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

function resolvePaging(page?: number, limit?: number): { page: number; limit: number } {
  const safePage = Number.isInteger(page) && (page as number) >= 1 ? (page as number) : 1;
  const safeLimit = Number.isInteger(limit) && (limit as number) >= 1 ? (limit as number) : DEFAULT_PAGE_SIZE;
  return { page: safePage, limit: Math.min(safeLimit, MAX_PAGE_SIZE) };
}

function compareByPublishedAtDesc(a: NewsItemRecord, b: NewsItemRecord): number {
  const diff = b.publishedAt.getTime() - a.publishedAt.getTime();
  return diff !== 0 ? diff : b.id.localeCompare(a.id);
}

/** 内存实现，用于单测与无数据库环境；语义与 Postgres 适配器保持一致。 */
export class InMemoryNewsRepository implements NewsRepository {
  private readonly news = new Map<string, NewsItemRecord>();
  private readonly runs = new Map<string, CollectRunRecord>();
  private readonly runSources = new Map<string, CollectRunSourceRecord>();

  async insertNews(record: NewsItemRecord): Promise<InsertNewsResult> {
    const normalizedUrl = normalizeUrl(record.url);
    for (const existing of this.news.values()) {
      if (normalizeUrl(existing.url) === normalizedUrl) {
        return { inserted: false, existingId: existing.id, reason: 'normalized_url' };
      }
      if (record.externalId && existing.source === record.source && existing.externalId === record.externalId) {
        return { inserted: false, existingId: existing.id, reason: 'external_id' };
      }
      const nearInTime = Math.abs(existing.publishedAt.getTime() - record.publishedAt.getTime()) <= DUPLICATE_WINDOW_MS;
      if (nearInTime && titleSimilarity(existing.title, record.title) > TITLE_SIMILARITY_THRESHOLD) {
        return { inserted: false, existingId: existing.id, reason: 'title_similarity' };
      }
    }
    const now = new Date();
    this.news.set(record.id, {
      ...record,
      normalizedUrl,
      titleFingerprint: titleFingerprint(record.title),
      createdAt: record.createdAt ?? now,
      updatedAt: record.updatedAt ?? now,
    });
    return { inserted: true };
  }

  async listNews(query: NewsQuery): Promise<NewsListResult> {
    const { page, limit } = resolvePaging(query.page, query.limit);
    const range = query.date ? shanghaiDayRange(query.date) : null;
    const items = [...this.news.values()]
      .filter((item) => {
        if (query.category && item.category !== query.category) return false;
        if (query.source && item.source !== query.source) return false;
        if (query.date) {
          if (!range) return false;
          const time = item.publishedAt.getTime();
          if (time < range.start.getTime() || time >= range.end.getTime()) return false;
        }
        return true;
      })
      .sort(compareByPublishedAtDesc);
    return { items: items.slice((page - 1) * limit, page * limit), total: items.length, page, limit };
  }

  async getNewsById(id: string): Promise<NewsItemRecord | null> {
    return this.news.get(id) ?? null;
  }

  async saveSummary(id: string, patch: SummaryPatch): Promise<NewsItemRecord | null> {
    const current = this.news.get(id);
    if (!current) return null;
    const next: NewsItemRecord = {
      ...current,
      summary: patch.summary,
      category: patch.category,
      summaryStatus: patch.summaryStatus,
      updatedAt: new Date(),
    };
    this.news.set(id, next);
    return next;
  }

  async createRun(run: CollectRunRecord): Promise<CollectRunRecord> {
    const stored: CollectRunRecord = { ...run, totals: { ...run.totals } };
    this.runs.set(run.id, stored);
    return stored;
  }

  async finishRun(id: string, patch: FinishRunPatch): Promise<CollectRunRecord | null> {
    const current = this.runs.get(id);
    if (!current) return null;
    const next: CollectRunRecord = { ...current, ...patch, totals: { ...patch.totals } };
    this.runs.set(id, next);
    return next;
  }

  async saveSourceRun(record: CollectRunSourceRecord): Promise<CollectRunSourceRecord> {
    const stored: CollectRunSourceRecord = { ...record };
    this.runSources.set(`${record.runId}:${record.source}`, stored);
    return stored;
  }

  async getRun(id: string): Promise<{ run: CollectRunRecord; sources: CollectRunSourceRecord[] } | null> {
    const run = this.runs.get(id);
    if (!run) return null;
    const sources = [...this.runSources.values()].filter((item) => item.runId === id);
    return { run, sources };
  }

  async listRuns(query: CollectRunQuery) {
    const { page, limit } = resolvePaging(query.page, query.limit);
    const items = [...this.runs.values()]
      .filter((run) => (!query.date || run.runDate === query.date) && (!query.status || run.status === query.status))
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime() || b.id.localeCompare(a.id));
    return { items: items.slice((page - 1) * limit, page * limit), total: items.length, page, limit };
  }

  async findSuccessfulRun(date: string): Promise<CollectRunRecord | null> {
    const matched = [...this.runs.values()]
      .filter(
        (run) =>
          run.runDate === date &&
          run.finishedAt !== null &&
          (run.status === 'success' || run.status === 'partial_failure'),
      )
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    return matched[0] ?? null;
  }
}

export interface NewsListPage {
  items: NewsItemRecord[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  date: string | null;
}

/**
 * 服务端列表页与 GET /api/news 共用的读路径：读仓储 → 时间倒序 + 稳定分页元数据。
 * 默认 limit=20；summary_status=failed 的条目照常返回（不得因加工失败隐藏）。
 */
export async function loadNewsPage(
  repository: NewsRepository,
  query: NewsQuery = {},
): Promise<NewsListPage> {
  const result = await repository.listNews(query);
  const totalPages = result.total === 0 ? 0 : Math.ceil(result.total / result.limit);
  return {
    items: result.items,
    page: result.page,
    limit: result.limit,
    total: result.total,
    totalPages,
    hasNext: result.page * result.limit < result.total,
    date: query.date ?? null,
  };
}

let repository: NewsRepository | null = null;

/** 运行时由 src/lib/db/postgres.ts 注入 Postgres 适配器；未注入时降级为内存实现。 */
export function getNewsRepository(): NewsRepository {
  if (!repository) repository = new InMemoryNewsRepository();
  return repository;
}

export function setNewsRepository(next: NewsRepository | null): void {
  repository = next;
}
