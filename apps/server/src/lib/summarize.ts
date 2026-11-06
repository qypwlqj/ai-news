import {
  buildSummaryPrompt,
  FALLBACK_CATEGORY,
  LlmError,
  parseLlmOutput,
  SUMMARY_TIMEOUT_MS,
  type LlmClient,
  type LlmInput,
} from './llm';
import type { Category, SummaryStatus } from './types';

export const LLM_TIMEOUT_CODE = 'LLM_TIMEOUT';
export const LLM_NOT_CONFIGURED_CODE = 'LLM_NOT_CONFIGURED';
export const LLM_CALL_FAILED_CODE = 'LLM_CALL_FAILED';
export const LLM_INVALID_OUTPUT_CODE = 'LLM_INVALID_OUTPUT';

export interface SummarizeResult {
  summary: string | null;
  category: Category;
  summaryStatus: SummaryStatus;
  durationMs: number;
  errorCode?: string;
}

export interface SummarizeOptions {
  timeoutMs?: number;
}

function errorCodeOf(error: unknown): string {
  if (error instanceof LlmError) return error.code;
  return LLM_CALL_FAILED_CODE;
}

/** 单条 LLM 调用超时保护：到点即失败，绝不让批次被无限阻塞。 */
async function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LlmError(LLM_TIMEOUT_CODE, `llm timeout after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 生成中文摘要与分类标签；任何失败都降级为 summaryStatus=failed，永不抛出。
 * 失败时 summary=null 且 category 兜底 industry_news，条目照常入库。
 */
export async function summarizeNews(
  input: LlmInput,
  client: LlmClient | null,
  options: SummarizeOptions = {},
): Promise<SummarizeResult> {
  const startedAt = Date.now();
  const failed = (errorCode: string): SummarizeResult => ({
    summary: null,
    category: FALLBACK_CATEGORY,
    summaryStatus: 'failed',
    durationMs: Date.now() - startedAt,
    errorCode,
  });

  if (!client || typeof client.complete !== 'function') return failed(LLM_NOT_CONFIGURED_CODE);

  let raw: string;
  try {
    raw = await withTimeout(
      Promise.resolve().then(() => client.complete(buildSummaryPrompt(input))),
      options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : SUMMARY_TIMEOUT_MS,
    );
  } catch (error) {
    return failed(errorCodeOf(error));
  }

  const parsed = parseLlmOutput(raw);
  if (!parsed) return failed(LLM_INVALID_OUTPUT_CODE);

  return {
    summary: parsed.summary,
    category: parsed.category,
    summaryStatus: 'ok',
    durationMs: Date.now() - startedAt,
  };
}
