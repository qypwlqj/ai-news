/**
 * LLM 客户端封装：endpoint / model / apiKey 全部由调用方以配置注入，
 * 本模块不读环境变量、不内置任何凭据、不自行发起真实网络请求（fetch 由调用方注入）。
 *
 * 职责三件事：构造「50–200 字中文摘要 + 5 类固定枚举」提示词、发起单次模型调用、解析 JSON 结果。
 * 超时判定与降级（summary=null + summaryStatus='failed' 且不抛错）由 news-summarize.ts 负责；
 * 本模块失败一律抛出带稳定 code 的 LlmError，错误文案经脱敏截断，绝不包含配置或凭据。
 */
import {
  SUMMARY_CATEGORIES,
  SUMMARY_MAX_CHARS,
  SUMMARY_MIN_CHARS,
  createSummarizer,
  sanitizeErrorMessage,
  type ModelSummarizer,
  type SummarizeDeps,
  type SummaryInput,
  type SummaryOutcome,
} from './news-summarize';

export interface LlmConfig {
  endpoint: string;
  model: string;
  apiKey?: string;
  maxTokens?: number;
}

export interface LlmResponse {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}

export interface LlmRequestInit {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}

export type LlmFetch = (url: string, init: LlmRequestInit) => Promise<LlmResponse>;

export const ERROR_LLM_NOT_CONFIGURED = 'LLM_NOT_CONFIGURED';
export const ERROR_LLM_REQUEST_FAILED = 'LLM_REQUEST_FAILED';
export const ERROR_LLM_HTTP_ERROR = 'LLM_HTTP_ERROR';
export const ERROR_LLM_INVALID_RESPONSE = 'LLM_INVALID_RESPONSE';

export const PROMPT_EXCERPT_MAX_CHARS = 800;
export const DEFAULT_LLM_MAX_TOKENS = 400;

const CATEGORY_LABELS: Record<(typeof SUMMARY_CATEGORIES)[number], string> = {
  model_release: '模型发布',
  research_paper: '研究论文',
  product_application: '产品应用',
  industry_news: '行业动态',
  policy_funding: '政策融资',
};

/** 稳定机器码错误：只带 code 与脱敏文案，不携带配置、URL 凭据或响应体。 */
export class LlmError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
  }
}

/** 提示词：明确摘要长度与 5 个枚举值，减少模型返回值漂移。 */
export function buildSummaryPrompt(input: SummaryInput): string {
  const excerpt = (input.rawExcerpt ?? '').replace(/\s+/gu, ' ').trim().slice(0, PROMPT_EXCERPT_MAX_CHARS);
  const lines = [
    '你是 AI 领域资讯编辑。请阅读下面的资讯，只输出一个 JSON 对象：{"summary":"中文摘要","category":"枚举值"}。',
    `摘要要求：简体中文，${SUMMARY_MIN_CHARS}–${SUMMARY_MAX_CHARS} 字，客观陈述事实，不使用 Markdown。`,
    '分类要求：只能取以下 5 个枚举之一（括号内为中文名）：',
    ...SUMMARY_CATEGORIES.map((value) => `- ${value}（${CATEGORY_LABELS[value]}）`),
    '无法判断时输出 industry_news。',
    `标题：${String(input.title ?? '').slice(0, 300)}`,
  ];
  if (input.url) lines.push(`链接：${String(input.url).slice(0, 500)}`);
  if (excerpt) lines.push(`原文片段：${excerpt}`);
  lines.push('只输出 JSON，不要额外解释。');
  return lines.join('\n');
}

/** 解析模型文本为 { summary, category }；容忍 ```json 包裹与前后附言，无法解析返回 null。 */
export function parseModelPayload(content: unknown): { summary: string; category: string } | null {
  if (typeof content !== 'string') return null;
  const text = content.replace(/```(?:json)?/giu, ' ').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    const category = typeof parsed.category === 'string' ? parsed.category.trim() : '';
    return summary ? { summary, category } : null;
  } catch {
    return null;
  }
}

/** 从常见响应形态中取出模型正文：OpenAI 风格 choices[0].message.content、text 或直出 JSON。 */
function extractModelContent(data: unknown): unknown {
  if (typeof data === 'string') return data;
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const choices = record.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0] as Record<string, unknown> | null;
    const message = (first?.message ?? null) as Record<string, unknown> | null;
    if (message && typeof message.content === 'string') return message.content;
    if (first && typeof first.text === 'string') return first.text;
  }
  if (typeof record.output_text === 'string') return record.output_text;
  if (typeof record.summary === 'string') return record;
  return null;
}

/** 生成注入式 model caller，供 summarizeNewsItem(deps.callModel) 使用。 */
export function createLlmCaller(
  config: LlmConfig,
  deps: { fetchImpl?: LlmFetch } = {},
): ModelSummarizer {
  const endpoint = String(config?.endpoint ?? '').trim();
  const model = String(config?.model ?? '').trim();
  const maxTokens =
    typeof config?.maxTokens === 'number' && config.maxTokens > 0
      ? config.maxTokens
      : DEFAULT_LLM_MAX_TOKENS;

  return async (input: SummaryInput, signal: AbortSignal) => {
    const fetchImpl = deps.fetchImpl;
    if (!endpoint || !model) {
      throw new LlmError(ERROR_LLM_NOT_CONFIGURED, 'LLM endpoint/model not configured');
    }
    if (typeof fetchImpl !== 'function') {
      throw new LlmError(ERROR_LLM_NOT_CONFIGURED, 'LLM fetch implementation not available');
    }

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const apiKey = String(config?.apiKey ?? '').trim();
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;

    const body = JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: '你是严谨的中文 AI 资讯编辑，只输出 JSON。' },
        { role: 'user', content: buildSummaryPrompt(input) },
      ],
    });

    let response: LlmResponse | null;
    try {
      response = await fetchImpl(endpoint, { method: 'POST', headers, body, signal });
    } catch (error) {
      throw new LlmError(ERROR_LLM_REQUEST_FAILED, sanitizeErrorMessage(error));
    }
    if (!response || response.ok !== true) {
      const status = Number(response?.status ?? 0) || 0;
      throw new LlmError(ERROR_LLM_HTTP_ERROR, `LLM request failed with status ${status}`);
    }

    let data: unknown;
    try {
      if (typeof response.json === 'function') {
        data = await response.json();
      } else if (typeof response.text === 'function') {
        data = await response.text();
      } else {
        data = null;
      }
    } catch (error) {
      throw new LlmError(ERROR_LLM_INVALID_RESPONSE, sanitizeErrorMessage(error));
    }

    const payload = parseModelPayload(extractModelContent(data));
    if (!payload) {
      throw new LlmError(ERROR_LLM_INVALID_RESPONSE, 'LLM response is not a valid JSON payload');
    }
    return payload;
  };
}

/** 一步装配：配置 + 注入 fetch → 逐条加工器（永不抛错，失败降级为 summaryStatus='failed'）。 */
export function createLlmSummarizer(
  config: LlmConfig,
  deps: SummarizeDeps & { fetchImpl?: LlmFetch } = {},
): (input: SummaryInput) => Promise<SummaryOutcome> {
  return createSummarizer({
    callModel: createLlmCaller(config, { fetchImpl: deps.fetchImpl }),
    timeoutMs: deps.timeoutMs,
  });
}
