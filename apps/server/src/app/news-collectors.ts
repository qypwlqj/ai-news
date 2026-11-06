/**
 * 采集器基础层（第一部分）：来源枚举映射、带超时与重试的 HTTP 抓取助手、Hacker News（AI 相关）采集。
 *
 * 约定：无全局状态、不读取环境变量、不直接发起网络请求——fetcher 由调用方注入，
 * 单测可用假 fetcher 覆盖成功 / HTTP 失败 / 超时 / 重试路径。
 * 失败信息统一经 sanitizeCollectError 脱敏并截断（≤ 200 字），绝不外泄令牌或连接串。
 */

export const COLLECTOR_SOURCE_VALUES = ['hacker_news', 'arxiv_cs_ai', 'jiqizhixin'] as const;
export type CollectorSource = (typeof COLLECTOR_SOURCE_VALUES)[number];

export const COLLECTOR_MAX_ATTEMPTS = 3;
export const COLLECTOR_FETCH_TIMEOUT_MS = 10_000;
export const RAW_EXCERPT_MAX_CHARS = 2_000;
export const COLLECT_ERROR_MAX_CHARS = 200;

export type FetchErrorCode =
  | 'FETCH_TIMEOUT'
  | 'FETCH_HTTP_ERROR'
  | 'FETCH_FAILED'
  | 'FETCH_INVALID_PAYLOAD';

export interface CollectedItem {
  source: CollectorSource;
  externalId: string | null;
  title: string;
  url: string;
  publishedAt: Date;
  rawExcerpt: string;
}

export interface FetcherResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type Fetcher = (url: string) => Promise<FetcherResponse>;

export type FetchTextResult =
  | { ok: true; body: string }
  | { ok: false; errorCode: FetchErrorCode; message: string };

export type CollectResult =
  | { ok: true; items: CollectedItem[] }
  | { ok: false; errorCode: FetchErrorCode; message: string };

/** 来源适配器统一契约：来源名固定，抓取逻辑接收注入的 fetcher。 */
export interface Collector {
  readonly source: CollectorSource;
  fetchItems(fetcher: Fetcher): Promise<CollectResult>;
}

const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/bearer\s+[A-Za-z0-9._~+/=-]{4,}/gi, 'Bearer [redacted]'],
  [/\b(?:postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/[^\s"']+/gi, '[redacted-connection-string]'],
  [/\b(secret|token|password|api[_-]?key|credential)\b\s*[:=]\s*[^\s,;&"']+/gi, '$1=[redacted]'],
];

function truncate(text: string, max: number): string {
  if (max <= 0) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, ' ');
}

/** 脱敏（令牌 / 连接串 / secret 类键值）+ 空白归一 + 截断，用于日志与 errorMessage。 */
export function sanitizeCollectError(input: unknown): string {
  const raw =
    input instanceof Error
      ? input.message
      : typeof input === 'string'
        ? input
        : input === null || input === undefined
          ? ''
          : String(input);
  let text = raw.replace(/\s+/g, ' ').trim();
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return truncate(text.length > 0 ? text : 'unknown error', COLLECT_ERROR_MAX_CHARS);
}

/** 原文摘录：去标签、空白归一、截断 ≤ 2000 字（落库前同样受此约束）。 */
export function truncateExcerpt(text: string): string {
  return truncate(stripTags(text).replace(/\s+/g, ' ').trim(), RAW_EXCERPT_MAX_CHARS);
}

class FetchTimeoutError extends Error {
  constructor() {
    super('fetch timeout');
    this.name = 'FetchTimeoutError';
  }
}

export interface FetchTextOptions {
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

function normalizeAttempts(value: number | undefined): number {
  const requested = value === undefined || !Number.isFinite(value) ? COLLECTOR_MAX_ATTEMPTS : Math.floor(value);
  return Math.min(Math.max(requested, 1), COLLECTOR_MAX_ATTEMPTS);
}

async function attemptFetch(fetcher: Fetcher, url: string, timeoutMs: number): Promise<FetchTextResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new FetchTimeoutError()), timeoutMs);
    });
    const response = await Promise.race([fetcher(url), timeout]);
    if (!response.ok) {
      return {
        ok: false,
        errorCode: 'FETCH_HTTP_ERROR',
        message: sanitizeCollectError(`HTTP ${response.status} for ${url}`),
      };
    }
    return { ok: true, body: await response.text() };
  } catch (error) {
    return {
      ok: false,
      errorCode: error instanceof FetchTimeoutError ? 'FETCH_TIMEOUT' : 'FETCH_FAILED',
      message: sanitizeCollectError(error),
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** 带超时与最多 3 次重试的抓取助手；失败返回脱敏 errorCode，不抛错。 */
export async function fetchText(
  fetcher: Fetcher,
  url: string,
  options: FetchTextOptions = {},
): Promise<FetchTextResult> {
  const timeoutMs = Math.max(Math.floor(options.timeoutMs ?? COLLECTOR_FETCH_TIMEOUT_MS), 1);
  const maxAttempts = normalizeAttempts(options.maxAttempts);
  const retryDelayMs = Math.max(Math.floor(options.retryDelayMs ?? 0), 0);
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let last: FetchTextResult = { ok: false, errorCode: 'FETCH_FAILED', message: 'fetch failed' };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    last = await attemptFetch(fetcher, url, timeoutMs);
    if (last.ok) return last;
    if (attempt < maxAttempts && retryDelayMs > 0) await sleep(retryDelayMs);
  }
  return last;
}

export const HACKER_NEWS_SOURCE: CollectorSource = 'hacker_news';
export const DEFAULT_HN_SEARCH_URL = 'https://hn.algolia.com/api/v1/search_by_date';
export const DEFAULT_HN_MIN_POINTS = 20;
export const DEFAULT_HN_FETCH_LIMIT = 100;

/** 「AI 相关」口径：标题关键词（词边界匹配）+ 热度阈值，均可配置。 */
export const DEFAULT_HN_KEYWORDS: readonly string[] = [
  'ai',
  'a.i.',
  'llm',
  'gpt',
  'chatgpt',
  'openai',
  'anthropic',
  'claude',
  'gemini',
  'deepmind',
  'machine learning',
  'deep learning',
  'neural',
  'transformer',
  'diffusion',
  'fine-tuning',
  'inference',
  'agent',
  'embedding',
  'rag',
  'multimodal',
];

export interface HackerNewsCollectorConfig {
  keywords?: readonly string[];
  minPoints?: number;
  limit?: number;
  baseUrl?: string;
  now?: () => Date;
  fetchOptions?: FetchTextOptions;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 标题是否命中 AI 关键词；短词（如 ai/gpt）按词边界匹配，避免 rain/spain 之类误命中。 */
export function isAiRelatedTitle(
  title: string,
  keywords: readonly string[] = DEFAULT_HN_KEYWORDS,
): boolean {
  const text = title.toLowerCase();
  return keywords.some((keyword) => {
    const needle = keyword.trim().toLowerCase();
    if (needle.length === 0) return false;
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}([^a-z0-9]|$)`).test(text);
  });
}

export function buildHackerNewsUrl(config: HackerNewsCollectorConfig = {}): string {
  const limit = Math.min(Math.max(Math.floor(config.limit ?? DEFAULT_HN_FETCH_LIMIT), 1), 1000);
  const base = config.baseUrl ?? DEFAULT_HN_SEARCH_URL;
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}tags=story&hitsPerPage=${limit}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asExternalId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function toHackerNewsItem(hit: unknown, config: HackerNewsCollectorConfig): CollectedItem | null {
  const row = asRecord(hit);
  const title = asText(row.title) || asText(row.story_title);
  const url = asText(row.url) || asText(row.story_url);
  if (title.length === 0 || !/^https?:\/\//i.test(url)) return null;
  if (asNumber(row.points) < (config.minPoints ?? DEFAULT_HN_MIN_POINTS)) return null;
  if (!isAiRelatedTitle(title, config.keywords ?? DEFAULT_HN_KEYWORDS)) return null;

  const createdAt = new Date(asText(row.created_at));
  const publishedAt = Number.isNaN(createdAt.getTime()) ? (config.now ?? (() => new Date()))() : createdAt;
  const excerptSource = asText(row.story_text) || asText(row.comment_text) || title;

  return {
    source: HACKER_NEWS_SOURCE,
    externalId: asExternalId(row.objectID),
    title,
    url,
    publishedAt,
    rawExcerpt: truncateExcerpt(excerptSource),
  };
}

/** 解析 HN Algolia JSON：按关键词 + 热度过滤，批内按 URL 去重，输出 CollectedItem。 */
export function parseHackerNews(
  payload: unknown,
  config: HackerNewsCollectorConfig = {},
): CollectedItem[] {
  const hits = asRecord(payload).hits;
  if (!Array.isArray(hits)) return [];
  const items: CollectedItem[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const item = toHackerNewsItem(hit, config);
    if (item === null) continue;
    const key = item.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return items;
}

/** Hacker News 采集器（AI 相关）：共享 fetchText 的超时与最多 3 次重试。 */
export function createHackerNewsCollector(config: HackerNewsCollectorConfig = {}): Collector {
  return {
    source: HACKER_NEWS_SOURCE,
    async fetchItems(fetcher: Fetcher): Promise<CollectResult> {
      const response = await fetchText(fetcher, buildHackerNewsUrl(config), config.fetchOptions ?? {});
      if (!response.ok) {
        return { ok: false, errorCode: response.errorCode, message: response.message };
      }
      let payload: unknown;
      try {
        payload = JSON.parse(response.body) as unknown;
      } catch {
        return {
          ok: false,
          errorCode: 'FETCH_INVALID_PAYLOAD',
          message: 'hacker_news payload is not valid JSON',
        };
      }
      return { ok: true, items: parseHackerNews(payload, config) };
    },
  };
}
