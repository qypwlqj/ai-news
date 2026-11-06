/**
 * 进程内仓储实现：供单元测试与无数据库环境使用，语义对齐 docs/data-model.md 的仓储约定。
 * - 硬去重：规范化 URL 唯一冲突 → reason=normalized_url；(source, external_id) 幂等 → reason=external_id
 * - 软去重：近 7 天窗口内标题相似度 > 0.9 判为重复 → reason=title_similarity
 * - 分页：published_at DESC, id DESC 稳定排序，默认 limit=20、上限 100
 * - summary_status=failed 的条目照常出现在列表结果中，不得过滤
 * - 批次日志：collect_runs + collect_run_sources（同批次同来源仅一行，重试只更新计数与 attempts）
 */
import type { CollectRunRecord, CollectRunTotals } from './db/repository';
import type { Category, NewsItemRecord, RunStatus, Source, SourceRunStatus } from './types';

/** 标题相似度判重阈值（> 0.9 视为重复）。 */
export const TITLE_SIMILARITY_THRESHOLD = 0.9;
/** 标题相似度判重的候选窗口（天）。 */
export const TITLE_WINDOW_DAYS = 7;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

const DAY_MS = 24 * 60 * 60 * 1000;
const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|spm$|ref$|ref_src$)/i;

export interface SourceRunInput {
  runId: string;
  source: Source;
  status: SourceRunStatus;
  fetched: number;
  inserted: number;
  duplicates: number;
  failed: number;
  durationMs: number;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface SourceRunRecord extends SourceRunInput {
  id: string;
}

export interface InsertNewsResult {
  inserted: boolean;
  item: NewsItemRecord | null;
  reason?: 'normalized_url' | 'external_id' | 'title_similarity';
}

export interface SummaryPatch {
  summary: string | null;
  category: Category;
  summaryStatus: NewsItemRecord['summaryStatus'];
}

export interface ListNewsOptions {
  date?: string;
  category?: Category;
  source?: Source;
  page?: number;
  limit?: number;
}

export interface ListNewsResult {
  items: NewsItemRecord[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  date: string | null;
}

export interface FinishRunPatch {
  status: RunStatus;
  finishedAt: Date;
  durationMs: number;
  totals: CollectRunTotals;
}

export interface ListRunsOptions {
  date?: string;
  status?: RunStatus;
  page?: number;
  limit?: number;
}

export interface ListRunsResult {
  items: CollectRunRecord[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface RunDetail {
  run: CollectRunRecord;
  sources: SourceRunRecord[];
}

/** 规范化 URL：去 #片段与追踪参数、协议与主机小写、去尾斜杠，用于硬去重键。 */
export function canonicalUrl(raw: string): string {
  const value = raw.trim();
  try {
    const url = new URL(value);
    const params: Array<[string, string]> = [];
    url.searchParams.forEach((paramValue, key) => {
      if (!TRACKING_PARAM.test(key)) params.push([key, paramValue]);
    });
    params.sort((left, right) => (left[0] === right[0] ? (left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0) : left[0] < right[0] ? -1 : 1));
    const search = params
      .map(([key, paramValue]) => `${encodeURIComponent(key)}=${encodeURIComponent(paramValue)}`)
      .join('&');
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${url.host}${path}${search ? `?${search}` : ''}`;
  } catch {
    return value;
  }
}

/** 标题归一化：小写并去除空白、标点与全半角差异。 */
export function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^0-9a-z\u4e00-\u9fff]+/g, '');
}

function bigramCounts(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let index = 0; index < value.length - 1; index += 1) {
    const gram = value.slice(index, index + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

/** 标题相似度（Dice 系数，按字符 bigram 计算），> 0.9 判为重复。 */
export function titleSimilarity(left: string, right: string): number {
  if (!left || !right) return left === right ? 1 : 0;
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const leftCounts = bigramCounts(left);
  const rightCounts = bigramCounts(right);
  let overlap = 0;
  for (const [gram, count] of leftCounts) overlap += Math.min(count, rightCounts.get(gram) ?? 0);
  const leftTotal = left.length - 1;
  const rightTotal = right.length - 1;
  // Dice 系数在「短标题是长标题前缀 + 少量后缀」时恰好卡在 0.9，补充包含度以覆盖该边界。
  const dice = (2 * overlap) / (leftTotal + rightTotal);
  const containment = overlap / Math.min(leftTotal, rightTotal);
  return Math.max(dice, containment);
}

function normalizePage(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return 1;
  return Math.trunc(value);
}

function normalizeLimit(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.trunc(value));
}

/** date=YYYY-MM-DD 按 Asia/Shanghai 自然日换算为 [startUtc, endUtc) 毫秒区间。 */
function shanghaiDayRange(date: string): { start: number; end: number } {
  const start = Date.parse(`${date}T00:00:00.000+08:00`);
  return { start, end: start + DAY_MS };
}

function compareNews(left: NewsItemRecord, right: NewsItemRecord): number {
  const delta = right.publishedAt.getTime() - left.publishedAt.getTime();
  if (delta !== 0) return delta;
  if (left.id === right.id) return 0;
  return left.id < right.id ? 1 : -1;
}

export interface MemoryNewsStore {
  insertNews(record: NewsItemRecord): InsertNewsResult;
  saveSummary(id: string, patch: SummaryPatch): NewsItemRecord | null;
  getNewsById(id: string): NewsItemRecord | null;
  listNews(options?: ListNewsOptions): ListNewsResult;
  createRun(record: CollectRunRecord): CollectRunRecord;
  finishRun(runId: string, patch: FinishRunPatch): CollectRunRecord | null;
  saveSourceRun(input: SourceRunInput): SourceRunRecord;
  getRun(runId: string): RunDetail | null;
  listRuns(options?: ListRunsOptions): ListRunsResult;
  findSuccessfulRun(runDate: string): CollectRunRecord | null;
  count(): number;
}

/** 创建进程内仓储；重复条目不计入 inserted，失败摘要条目仍可查询。 */
export function createMemoryNewsStore(): MemoryNewsStore {
  const items = new Map<string, NewsItemRecord>();
  const byUrl = new Map<string, NewsItemRecord>();
  const byExternalId = new Map<string, NewsItemRecord>();
  const runs = new Map<string, CollectRunRecord>();
  const sourceRuns = new Map<string, SourceRunRecord>();

  return {
    insertNews(record) {
      const url = canonicalUrl(record.url);
      const sameUrl = byUrl.get(url);
      if (sameUrl) return { inserted: false, item: sameUrl, reason: 'normalized_url' };

      if (record.externalId) {
        const externalKey = `${record.source}:${record.externalId}`;
        const sameExternal = byExternalId.get(externalKey);
        if (sameExternal) return { inserted: false, item: sameExternal, reason: 'external_id' };
      }

      const key = titleKey(record.title);
      if (key) {
        const publishedAt = record.publishedAt.getTime();
        const windowStart = publishedAt - TITLE_WINDOW_DAYS * DAY_MS;
        const windowEnd = publishedAt + TITLE_WINDOW_DAYS * DAY_MS;
        for (const candidate of items.values()) {
          const candidateAt = candidate.publishedAt.getTime();
          if (candidateAt < windowStart || candidateAt > windowEnd) continue;
          if (titleSimilarity(key, titleKey(candidate.title)) > TITLE_SIMILARITY_THRESHOLD) {
            return { inserted: false, item: candidate, reason: 'title_similarity' };
          }
        }
      }

      items.set(record.id, record);
      byUrl.set(url, record);
      if (record.externalId) byExternalId.set(`${record.source}:${record.externalId}`, record);
      return { inserted: true, item: record };
    },

    saveSummary(id, patch) {
      const existing = items.get(id);
      if (!existing) return null;
      existing.summary = patch.summary;
      existing.category = patch.category;
      existing.summaryStatus = patch.summaryStatus;
      return existing;
    },

    getNewsById(id) {
      return items.get(id) ?? null;
    },

    listNews(options = {}) {
      const page = normalizePage(options.page);
      const limit = normalizeLimit(options.limit);
      let rows = [...items.values()];
      if (options.category) rows = rows.filter((row) => row.category === options.category);
      if (options.source) rows = rows.filter((row) => row.source === options.source);
      if (options.date) {
        const { start, end } = shanghaiDayRange(options.date);
        rows = rows.filter((row) => {
          const at = row.publishedAt.getTime();
          return at >= start && at < end;
        });
      }
      rows.sort(compareNews);
      const total = rows.length;
      const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
      return {
        items: rows.slice((page - 1) * limit, page * limit),
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        date: options.date ?? null,
      };
    },

    createRun(record) {
      runs.set(record.id, record);
      return record;
    },

    finishRun(runId, patch) {
      const existing = runs.get(runId);
      if (!existing) return null;
      existing.status = patch.status;
      existing.finishedAt = patch.finishedAt;
      existing.durationMs = patch.durationMs;
      existing.totals = patch.totals;
      return existing;
    },

    saveSourceRun(input) {
      const key = `${input.runId}:${input.source}`;
      const existing = sourceRuns.get(key);
      if (existing) {
        Object.assign(existing, input, { id: key });
        return existing;
      }
      const record: SourceRunRecord = { ...input, id: key };
      sourceRuns.set(key, record);
      return record;
    },

    getRun(runId) {
      const run = runs.get(runId);
      if (!run) return null;
      const sources = [...sourceRuns.values()].filter((entry) => entry.runId === runId);
      return { run, sources };
    },

    listRuns(options = {}) {
      const page = normalizePage(options.page);
      const limit = normalizeLimit(options.limit);
      let rows = [...runs.values()];
      if (options.date) rows = rows.filter((run) => run.runDate === options.date);
      if (options.status) rows = rows.filter((run) => run.status === options.status);
      rows.sort((left, right) => {
        const delta = right.startedAt.getTime() - left.startedAt.getTime();
        if (delta !== 0) return delta;
        if (left.id === right.id) return 0;
        return left.id < right.id ? 1 : -1;
      });
      const total = rows.length;
      const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
      return { items: rows.slice((page - 1) * limit, page * limit), page, limit, total, totalPages };
    },

    findSuccessfulRun(runDate) {
      const matches = [...runs.values()].filter(
        (run) => run.runDate === runDate && (run.status === 'success' || run.status === 'partial_failure'),
      );
      if (matches.length === 0) return null;
      matches.sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime());
      return matches[0] ?? null;
    },

    count() {
      return items.size;
    },
  };
}
