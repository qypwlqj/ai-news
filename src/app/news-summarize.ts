/**
 * 摘要与分类加工（纯函数 + 注入式模型调用）。
 *
 * 约定：成功 ⇒ summaryStatus='ok'（摘要 50–200 字，超长截断至 200）；
 * 失败 / 超时 / 摘要过短 / 未配置模型调用 ⇒ summaryStatus='failed' 且 summary=null，
 * 返回 errorCode 供日志记录，永不抛错，从而不中断当日批次。
 * 本模块不读环境变量、不发网络请求：模型 caller 由编排层（src/lib）注入。
 */

export const SUMMARY_MIN_CHARS = 50;
export const SUMMARY_MAX_CHARS = 200;
export const DEFAULT_SUMMARY_TIMEOUT_MS = 8000;

/** 与 category_enum 一致（只加不删不改名）。 */
export const SUMMARY_CATEGORIES = [
  'model_release',
  'research_paper',
  'product_application',
  'industry_news',
  'policy_funding',
] as const;

export type SummaryCategory = (typeof SUMMARY_CATEGORIES)[number];
export type SummaryStatus = 'ok' | 'failed' | 'pending';

/** 分类无法判定时的兜底值，保证入库 category 命中率 100%。 */
export const FALLBACK_CATEGORY: SummaryCategory = 'industry_news';

export const ERROR_SUMMARY_UNAVAILABLE = 'SUMMARY_UNAVAILABLE';
export const ERROR_SUMMARY_TIMEOUT = 'SUMMARY_TIMEOUT';
export const ERROR_SUMMARY_INVALID_LENGTH = 'SUMMARY_INVALID_LENGTH';

/** 英文枚举 + 中文展示名 → 枚举，容忍模型直接返回中文分类名。 */
const CATEGORY_ALIASES: Record<string, SummaryCategory> = {
  model_release: 'model_release',
  '模型发布': 'model_release',
  research_paper: 'research_paper',
  '研究论文': 'research_paper',
  product_application: 'product_application',
  '产品应用': 'product_application',
  industry_news: 'industry_news',
  '行业动态': 'industry_news',
  policy_funding: 'policy_funding',
  '政策融资': 'policy_funding',
};

export interface SummaryInput {
  title: string;
  url?: string;
  rawExcerpt?: string | null;
}

export interface ModelSummaryPayload {
  summary?: unknown;
  category?: unknown;
}

export type ModelSummarizer = (
  input: SummaryInput,
  signal: AbortSignal,
) => Promise<ModelSummaryPayload | null | undefined>;

export interface SummarizeDeps {
  callModel?: ModelSummarizer | null;
  timeoutMs?: number;
}

export interface SummaryOutcome {
  summary: string | null;
  category: SummaryCategory;
  summaryStatus: SummaryStatus;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number;
}

const TOKEN_PATTERN = /(bearer\s+|token[=:]\s*|password[=:]\s*)[^\s,;]+/gi;

/** 错误文案脱敏（令牌类片段替换）并截断 ≤200 字，禁止回显凭据。 */
export function sanitizeErrorMessage(error: unknown, limit = 200): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return raw.replace(/\s+/gu, ' ').replace(TOKEN_PATTERN, '$1***').trim().slice(0, limit);
}

/** 按字符（忽略空白）计数，用于 50–200 字判定。 */
export function countSummaryChars(text: string): number {
  return Array.from(text.replace(/\s+/gu, '')).length;
}

export function coerceCategory(value: unknown): SummaryCategory {
  if (typeof value !== 'string') return FALLBACK_CATEGORY;
  const raw = value.trim();
  if (!raw) return FALLBACK_CATEGORY;
  return CATEGORY_ALIASES[raw.toLowerCase()] ?? CATEGORY_ALIASES[raw] ?? FALLBACK_CATEGORY;
}

/** 规整摘要：空白归一；超长截断至 200 字；不足 50 字视为非法（返回 null）。 */
export function normalizeSummary(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/gu, ' ').trim();
  if (!text) return null;
  const chars = Array.from(text);
  if (chars.length > SUMMARY_MAX_CHARS) return chars.slice(0, SUMMARY_MAX_CHARS).join('');
  return countSummaryChars(text) < SUMMARY_MIN_CHARS ? null : text;
}

/** 单条资讯加工：任何异常都降级为 failed，不抛出。 */
export async function summarizeNewsItem(
  input: SummaryInput,
  deps: SummarizeDeps = {},
): Promise<SummaryOutcome> {
  const startedAt = Date.now();
  const caller = deps.callModel;
  if (typeof caller !== 'function') {
    return {
      summary: null,
      category: FALLBACK_CATEGORY,
      summaryStatus: 'failed',
      errorCode: ERROR_SUMMARY_UNAVAILABLE,
      errorMessage: 'model caller not configured',
      durationMs: 0,
    };
  }

  const timeoutMs =
    typeof deps.timeoutMs === 'number' && deps.timeoutMs > 0 ? deps.timeoutMs : DEFAULT_SUMMARY_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const payload = await Promise.race([
      caller(input, controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(ERROR_SUMMARY_TIMEOUT));
        }, timeoutMs);
      }),
    ]);

    const category = coerceCategory(payload?.category);
    const summary = normalizeSummary(payload?.summary);
    const durationMs = Date.now() - startedAt;
    if (!summary) {
      return {
        summary: null,
        category,
        summaryStatus: 'failed',
        errorCode: ERROR_SUMMARY_INVALID_LENGTH,
        errorMessage: `summary must be ${SUMMARY_MIN_CHARS}-${SUMMARY_MAX_CHARS} characters`,
        durationMs,
      };
    }
    return { summary, category, summaryStatus: 'ok', errorCode: null, errorMessage: null, durationMs };
  } catch (error) {
    const timedOut = error instanceof Error && error.message === ERROR_SUMMARY_TIMEOUT;
    return {
      summary: null,
      category: FALLBACK_CATEGORY,
      summaryStatus: 'failed',
      errorCode: timedOut ? ERROR_SUMMARY_TIMEOUT : ERROR_SUMMARY_UNAVAILABLE,
      errorMessage: sanitizeErrorMessage(error),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}

/** 供采集编排注入的加工器工厂：固定依赖，逐条调用不抛错。 */
export function createSummarizer(
  deps: SummarizeDeps = {},
): (input: SummaryInput) => Promise<SummaryOutcome> {
  return (input: SummaryInput) => summarizeNewsItem(input, deps);
}
