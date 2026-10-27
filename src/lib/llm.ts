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
