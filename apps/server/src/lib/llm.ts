import type { Category } from './types';

/** 5 类固定枚举（与 category_enum 完全一致，顺序稳定，只增不删）。 */
export const CATEGORY_VALUES: readonly Category[] = [
  'model_release',
  'research_paper',
  'product_application',
  'industry_news',
  'policy_funding',
];

/** 模型未给出合法分类时的兜底值，保证 category 命中率 100%。 */
export const FALLBACK_CATEGORY: Category = 'industry_news';

export const SUMMARY_MIN_CHARS = 50;
export const SUMMARY_MAX_CHARS = 200;
export const SUMMARY_TIMEOUT_MS = 20_000;
export const PROMPT_EXCERPT_LIMIT = 2000;

export interface LlmInput {
  title: string;
  excerpt?: string | null;
}

/** 最小依赖面：任何返回文本的 LLM 调用都能注入，便于单测替换。 */
export interface LlmClient {
  complete(prompt: string): Promise<string>;
}

export class LlmError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
  }
}

export function buildSummaryPrompt(input: LlmInput): string {
  const excerpt = (input.excerpt ?? '').slice(0, PROMPT_EXCERPT_LIMIT).trim();
  return [
    '你是 AI 领域资讯编辑。请阅读下面的资讯，只输出一个 JSON 对象：',
    '{"summary": "50-200 字中文摘要", "category": "五类标签之一"}',
    `category 只能取以下枚举之一：${CATEGORY_VALUES.join(' / ')}。`,
    '摘要必须为中文，50-200 字，不换行、不含 Markdown；不要输出 JSON 以外的任何内容。',
    `标题：${input.title}`,
    excerpt ? `原文片段：${excerpt}` : '原文片段：（无）',
  ].join('\n');
}

/** 中文字数按码点统计（忽略首尾空白），用于 50–200 字校验。 */
export function countSummaryChars(text: string): number {
  return Array.from(text.trim()).length;
}

export function isValidSummary(text: string): boolean {
  const count = countSummaryChars(text);
  return count >= SUMMARY_MIN_CHARS && count <= SUMMARY_MAX_CHARS;
}

/** 超长摘要截断到 200 字，避免越过契约上限。 */
export function truncateSummary(text: string): string {
  const chars = Array.from(text.trim());
  return (chars.length > SUMMARY_MAX_CHARS ? chars.slice(0, SUMMARY_MAX_CHARS) : chars).join('');
}

/**
 * 解析模型输出：容忍 ```json 围栏与前后说明文字；
 * 摘要长度不合法或分类不在 5 枚举内一律返回 null（调用侧降级为 failed）。
 */
export function parseLlmOutput(raw: string): { summary: string; category: Category } | null {
  if (typeof raw !== 'string') return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const record = parsed as Record<string, unknown>;
  const summaryText = typeof record.summary === 'string' ? record.summary.replace(/\s+/g, ' ').trim() : '';
  const category = typeof record.category === 'string' ? record.category.trim() : '';
  if (!CATEGORY_VALUES.includes(category as Category)) return null;

  const summary = truncateSummary(summaryText);
  if (!isValidSummary(summary)) return null;
  return { summary, category: category as Category };
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const DEFAULT_LLM_BASE_URL = 'https://api.openai.com/v1';

/** 运行时注入的 LLM 配置：凭据只由调用方从环境变量读取，本模块不回显、不落库。 */
export interface HttpLlmOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

function readMessageContent(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const choices = (payload as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!first || typeof first !== 'object') return null;
  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== 'object') return null;
  const content = (message as Record<string, unknown>).content;
  return typeof content === 'string' && content.trim() ? content : null;
}

/**
 * OpenAI 兼容 /chat/completions 客户端。
 * 超时中断、HTTP 异常与结构异常统一抛 LlmError，message 中不含凭据，便于上层降级为 summary_status=failed。
 */
export function createHttpLlmClient(options: HttpLlmOptions): LlmClient {
  if (!options.apiKey) throw new LlmError('LLM_NOT_CONFIGURED', 'llm api key is missing');
  if (!options.model) throw new LlmError('LLM_NOT_CONFIGURED', 'llm model is missing');
  const baseUrl = (options.baseUrl ?? DEFAULT_LLM_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : SUMMARY_TIMEOUT_MS;

  return {
    async complete(prompt: string): Promise<string> {
      const fetchImpl = options.fetchImpl ?? (globalThis as { fetch?: FetchLike }).fetch;
      if (typeof fetchImpl !== 'function') throw new LlmError('LLM_NOT_CONFIGURED', 'fetch is not available');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response: Response;
        try {
          response = await fetchImpl(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
            body: JSON.stringify({ model: options.model, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
            signal: controller.signal,
          });
        } catch (cause) {
          if (controller.signal.aborted) throw new LlmError('LLM_TIMEOUT', `llm request exceeded ${timeoutMs}ms`);
          throw new LlmError('LLM_REQUEST_FAILED', cause instanceof Error ? cause.message : 'llm request failed');
        }
        if (!response.ok) throw new LlmError('LLM_HTTP_ERROR', `llm responded with status ${response.status}`);
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new LlmError('LLM_BAD_RESPONSE', 'llm response is not valid JSON');
        }
        const content = readMessageContent(payload);
        if (!content) throw new LlmError('LLM_BAD_RESPONSE', 'llm response has no message content');
        return content;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
