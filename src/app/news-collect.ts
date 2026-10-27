/**
 * 三来源采集器（Hacker News / ArXiv cs.AI / 机器之心）与采集编排。
 *
 * - 依赖可注入（fetcher / 时钟 / 仓储 / 加工器）：测试不触网、不连库。
 * - 无硬编码凭据：机器之心 feed 地址、关键词等全部来自调用方配置。
 * - 逐源失败最多重试 MAX_ATTEMPTS 次（attempts 记录实际次数）；全部来源失败时 httpStatus=502。
 */

export const SOURCE_NAMES = ['hacker_news', 'arxiv_cs_ai', 'jiqizhixin'] as const;

export type SourceName = (typeof SOURCE_NAMES)[number];
export type RunTrigger = 'cron' | 'api';
export type RunStatus = 'success' | 'partial_failure' | 'failed';
export type SourceRunStatus = 'success' | 'failed' | 'skipped';

export const MAX_ATTEMPTS = 3;
export const MAX_ERROR_LENGTH = 2000;
const DEFAULT_TIMEOUT_MS = 20_000;
const ALL_SOURCES_FAILED_STATUS = 502;

export interface RawNewsItem {
  externalId: string | null;
  title: string;
  url: string;
  publishedAt: string;
  rawExcerpt?: string | null;
}

export type Fetcher = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export interface CollectConfig {
  hackerNews: { apiBase: string; keywords: string[]; limit: number };
  arxiv: { apiBase: string; category: string; maxResults: number };
  jiqizhixin: { feedUrl: string };
}

/** 默认配置不含任何凭据；机器之心 feed 地址由调用方（环境变量注入侧）补齐。 */
export const DEFAULT_COLLECT_CONFIG: CollectConfig = {
  hackerNews: {
    apiBase: 'https://hn.algolia.com/api/v1/search_by_date',
    keywords: ['AI', 'LLM', 'GPT', 'machine learning'],
    limit: 50,
  },
  arxiv: { apiBase: 'http://export.arxiv.org/api/query', category: 'cs.AI', maxResults: 50 },
  jiqizhixin: { feedUrl: '' },
};

export interface IngestResult {
  inserted: number;
  duplicates: number;
  summaryOk: number;
  summaryFailed: number;
}

export interface Totals {
  fetched: number;
  inserted: number;
  duplicates: number;
  summaryOk: number;
  summaryFailed: number;
}

export interface SourceRunRecord {
  source: SourceName;
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

export interface CollectRunPatch {
  status: RunStatus;
  finishedAt: string;
  durationMs: number;
  totals: Totals;
}

export interface CollectStore {
  findSuccessfulRun(date: string): Promise<{ runId: string } | null>;
  createRun(run: {
    runId: string;
    trigger: RunTrigger;
    date: string;
    status: RunStatus;
    startedAt: string;
  }): Promise<void>;
  saveSourceRun(runId: string, record: SourceRunRecord): Promise<void>;
  finishRun(runId: string, patch: CollectRunPatch): Promise<void>;
}

export interface CollectDeps {
  store: CollectStore;
  fetcher: Fetcher;
  ingest: (source: SourceName, items: RawNewsItem[]) => Promise<IngestResult>;
  config?: CollectConfig;
  now?: () => Date;
  newRunId?: () => string;
  timeoutMs?: number;
}

export interface CollectOptions {
  trigger: RunTrigger;
  date: string;
  sources?: readonly SourceName[];
  force?: boolean;
}

export interface CollectResult {
  runId: string;
  status: RunStatus;
  trigger: RunTrigger;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  date: string;
  totals: Totals;
  sources: SourceRunRecord[];
  httpStatus: number;
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function tagText(chunk: string, name: string): string {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(chunk);
  return match ? decodeXml(match[1]) : '';
}

function toIso(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

/** 失败原因入库/出参前脱敏并截断（≤ MAX_ERROR_LENGTH），绝不回显凭据。 */
export function sanitizeError(error: unknown): { code: string; message: string } {
  const raw = error instanceof Error ? error.message : String(error ?? 'UNKNOWN_ERROR');
  const masked = raw.replace(/((?:token|secret|password|api[_-]?key|authorization)\s*[=:]\s*)\S+/gi, '$1***');
  const message = masked.slice(0, MAX_ERROR_LENGTH);
  const matched = /^[A-Z][A-Z0-9_]{2,63}/.exec(message);
  return { code: matched ? matched[0] : 'SOURCE_ERROR', message };
}

function defaultRunId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return `run_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Hacker News（Algolia）JSON → 统一条目：仅保留标题命中所配置关键词、且有 http(s) 原文地址的 story。 */
export function parseHackerNews(json: string, keywords: string[], limit: number): RawNewsItem[] {
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    throw new Error('PARSE_ERROR_HACKER_NEWS');
  }
  const hits = (payload as { hits?: unknown }).hits;
  const lowered = keywords.map((keyword) => keyword.toLowerCase());
  const items: RawNewsItem[] = [];
  for (const raw of Array.isArray(hits) ? hits : []) {
    if (items.length >= limit) break;
    const hit = (raw ?? {}) as Record<string, unknown>;
    const title = typeof hit.title === 'string' ? hit.title.trim() : '';
    const url = typeof hit.url === 'string' ? hit.url.trim() : '';
    if (!title || !/^https?:\/\//i.test(url)) continue;
    const haystack = `${title} ${typeof hit.story_text === 'string' ? hit.story_text : ''}`.toLowerCase();
    if (lowered.length > 0 && !lowered.some((keyword) => haystack.includes(keyword))) continue;
    items.push({
      externalId: hit.objectID === undefined || hit.objectID === null ? null : String(hit.objectID),
      title,
      url,
      publishedAt: toIso(hit.created_at),
    });
  }
  return items;
}

/** ArXiv Atom XML → 统一条目（id 统一升级为 https）。 */
export function parseArxiv(xml: string, maxResults: number): RawNewsItem[] {
  const items: RawNewsItem[] = [];
  for (const chunk of xml.split(/<entry[\s>]/i).slice(1)) {
    if (items.length >= maxResults) break;
    const body = chunk.split(/<\/entry>/i)[0] ?? '';
    const title = tagText(body, 'title');
    const link = tagText(body, 'id').replace(/^http:/i, 'https:');
    if (!title || !/^https?:\/\//i.test(link)) continue;
    items.push({ externalId: link, title, url: link, publishedAt: toIso(tagText(body, 'published')) });
  }
  return items;
}

/** 机器之心 RSS → 统一条目（guid 缺失时用链接作外部 ID）。 */
export function parseJiqizhixin(xml: string): RawNewsItem[] {
  const items: RawNewsItem[] = [];
  for (const chunk of xml.split(/<item[\s>]/i).slice(1)) {
    const body = chunk.split(/<\/item>/i)[0] ?? '';
    const title = tagText(body, 'title');
    const link = tagText(body, 'link');
    if (!title || !/^https?:\/\//i.test(link)) continue;
    const guid = tagText(body, 'guid');
    const excerpt = tagText(body, 'description').slice(0, 500);
    items.push({
      externalId: guid || link,
      title,
      url: link,
      publishedAt: toIso(tagText(body, 'pubDate')),
      rawExcerpt: excerpt || null,
    });
  }
  return items;
}

async function loadText(fetcher: Fetcher, url: string, timeoutMs: number): Promise<string> {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetcher(url, controller ? { signal: controller.signal } : undefined);
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return await response.text();
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/** 按来源抓取并解析；配置缺失或抓取/解析失败直接抛错，由编排层计入 attempts。 */
export async function fetchSourceItems(
  source: SourceName,
  deps: Pick<CollectDeps, 'fetcher' | 'config' | 'timeoutMs'>,
): Promise<RawNewsItem[]> {
  const config = deps.config ?? DEFAULT_COLLECT_CONFIG;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (source === 'hacker_news') {
    const { apiBase, keywords, limit } = config.hackerNews;
    const query = encodeURIComponent(keywords[0] ?? 'AI');
    const url = `${apiBase}?query=${query}&tags=story&hitsPerPage=${Math.max(1, limit)}`;
    return parseHackerNews(await loadText(deps.fetcher, url, timeoutMs), keywords, limit);
  }
  if (source === 'arxiv_cs_ai') {
    const { apiBase, category, maxResults } = config.arxiv;
    const url =
      `${apiBase}?search_query=${encodeURIComponent(`cat:${category}`)}` +
      `&sortBy=submittedDate&sortOrder=descending&max_results=${Math.max(1, maxResults)}`;
    return parseArxiv(await loadText(deps.fetcher, url, timeoutMs), maxResults);
  }
  const { feedUrl } = config.jiqizhixin;
  if (!feedUrl) throw new Error('CONFIG_MISSING_FEED_URL');
  return parseJiqizhixin(await loadText(deps.fetcher, feedUrl, timeoutMs));
}

/** 执行一轮采集：幂等短路 → 逐源抓取（≤3 次重试）→ 入库加工 → 汇总批次；全源失败返回 502 语义。 */
export async function runCollect(deps: CollectDeps, options: CollectOptions): Promise<CollectResult> {
  const now = deps.now ?? (() => new Date());
  const newRunId = deps.newRunId ?? defaultRunId;
  const startedDate = now();
  const startedAt = startedDate.toISOString();
  const runId = newRunId();
  const selected =
    options.sources && options.sources.length > 0 ? [...options.sources] : [...SOURCE_NAMES];
  const totals: Totals = { fetched: 0, inserted: 0, duplicates: 0, summaryOk: 0, summaryFailed: 0 };

  const existing = options.force === true ? null : await deps.store.findSuccessfulRun(options.date);
  if (existing) {
    const finishedDate = now();
    const finishedAt = finishedDate.toISOString();
    const durationMs = Math.max(0, finishedDate.getTime() - startedDate.getTime());
    const sources: SourceRunRecord[] = selected.map((source) => ({
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
    }));
    await deps.store.createRun({ runId, trigger: options.trigger, date: options.date, status: 'success', startedAt });
    for (const record of sources) await deps.store.saveSourceRun(runId, record);
    await deps.store.finishRun(runId, { status: 'success', finishedAt, durationMs, totals: { ...totals } });
    return {
      runId,
      status: 'success',
      trigger: options.trigger,
      startedAt,
      finishedAt,
      durationMs,
      date: options.date,
      totals,
      sources,
      httpStatus: 200,
    };
  }

  await deps.store.createRun({ runId, trigger: options.trigger, date: options.date, status: 'failed', startedAt });
  const sources: SourceRunRecord[] = [];

  for (const source of selected) {
    const sourceStarted = now().getTime();
    let attempts = 0;
    let items: RawNewsItem[] | null = null;
    let lastError: unknown = null;
    while (attempts < MAX_ATTEMPTS && items === null) {
      attempts += 1;
      try {
        items = await fetchSourceItems(source, deps);
      } catch (error) {
        lastError = error;
      }
    }

    const base: SourceRunRecord = {
      source,
      status: 'success',
      fetched: 0,
      inserted: 0,
      duplicates: 0,
      failed: 0,
      durationMs: 0,
      attempts,
      errorCode: null,
      errorMessage: null,
    };

    let record: SourceRunRecord;
    if (items === null) {
      const error = sanitizeError(lastError);
      record = { ...base, status: 'failed', durationMs: Math.max(0, now().getTime() - sourceStarted), errorCode: error.code, errorMessage: error.message };
    } else {
      try {
        const ingested = await deps.ingest(source, items);
        record = {
          ...base,
          fetched: items.length,
          inserted: ingested.inserted,
          duplicates: ingested.duplicates,
          durationMs: Math.max(0, now().getTime() - sourceStarted),
        };
        totals.summaryOk += ingested.summaryOk;
        totals.summaryFailed += ingested.summaryFailed;
      } catch (error) {
        const sanitized = sanitizeError(error);
        record = {
          ...base,
          status: 'failed',
          fetched: items.length,
          failed: items.length,
          durationMs: Math.max(0, now().getTime() - sourceStarted),
          errorCode: sanitized.code,
          errorMessage: sanitized.message,
        };
      }
    }

    totals.fetched += record.fetched;
    totals.inserted += record.inserted;
    totals.duplicates += record.duplicates;
    await deps.store.saveSourceRun(runId, record);
    sources.push(record);
  }

  const failedCount = sources.filter((item) => item.status === 'failed').length;
  const status: RunStatus =
    failedCount === sources.length ? 'failed' : failedCount > 0 ? 'partial_failure' : 'success';
  const finishedDate = now();
  const finishedAt = finishedDate.toISOString();
  const durationMs = Math.max(0, finishedDate.getTime() - startedDate.getTime());
  await deps.store.finishRun(runId, { status, finishedAt, durationMs, totals });

  return {
    runId,
    status,
    trigger: options.trigger,
    startedAt,
    finishedAt,
    durationMs,
    date: options.date,
    totals,
    sources,
    httpStatus: status === 'failed' ? ALL_SOURCES_FAILED_STATUS : 200,
  };
}
