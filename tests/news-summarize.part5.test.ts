import { describe, expect, it } from 'vitest';
import {
  ERROR_SUMMARY_INVALID_LENGTH,
  ERROR_SUMMARY_TIMEOUT,
  ERROR_SUMMARY_UNAVAILABLE,
  FALLBACK_CATEGORY,
  SUMMARY_MAX_CHARS,
  coerceCategory,
  createSummarizer,
  normalizeSummary,
  sanitizeErrorMessage,
  summarizeNewsItem,
} from '../src/app/news-summarize';

const LONG_SUMMARY = '模型能力持续提升'.repeat(8); // 64 字，落在 50–200 区间

describe('news-summarize', () => {
  it('生成 50–200 字摘要并保留合法分类', async () => {
    const outcome = await summarizeNewsItem(
      { title: 't' },
      { callModel: async () => ({ summary: LONG_SUMMARY, category: 'research_paper' }) },
    );
    expect(outcome.summaryStatus).toBe('ok');
    expect(outcome.summary).toBe(LONG_SUMMARY);
    expect(outcome.category).toBe('research_paper');
    expect(outcome.errorCode).toBeNull();
  });

  it('未知分类兜底 industry_news，中文别名归一', async () => {
    const outcome = await summarizeNewsItem(
      { title: 't' },
      { callModel: async () => ({ summary: LONG_SUMMARY, category: 'unknown_value' }) },
    );
    expect(outcome.category).toBe(FALLBACK_CATEGORY);
    expect(coerceCategory('模型发布')).toBe('model_release');
    expect(coerceCategory(undefined)).toBe(FALLBACK_CATEGORY);
  });

  it('摘要过短判定 failed，不抛错且保留分类', async () => {
    const outcome = await summarizeNewsItem(
      { title: 't' },
      { callModel: async () => ({ summary: '太短', category: 'model_release' }) },
    );
    expect(outcome.summaryStatus).toBe('failed');
    expect(outcome.summary).toBeNull();
    expect(outcome.category).toBe('model_release');
    expect(outcome.errorCode).toBe(ERROR_SUMMARY_INVALID_LENGTH);
  });

  it('模型调用抛错降级 failed 且错误文案脱敏', async () => {
    const outcome = await summarizeNewsItem(
      { title: 't' },
      {
        callModel: async () => {
          throw new Error('upstream 500 Bearer abc.def.ghi failed');
        },
      },
    );
    expect(outcome.summaryStatus).toBe('failed');
    expect(outcome.summary).toBeNull();
    expect(outcome.errorCode).toBe(ERROR_SUMMARY_UNAVAILABLE);
    expect(outcome.errorMessage ?? '').not.toContain('abc.def.ghi');
    expect(sanitizeErrorMessage('x'.repeat(500))).toHaveLength(200);
  });

  it('超时降级 SUMMARY_TIMEOUT', async () => {
    const outcome = await summarizeNewsItem(
      { title: 't' },
      { timeoutMs: 10, callModel: () => new Promise(() => undefined) },
    );
    expect(outcome.summaryStatus).toBe('failed');
    expect(outcome.errorCode).toBe(ERROR_SUMMARY_TIMEOUT);
  });

  it('未配置模型调用时降级不抛错', async () => {
    const outcome = await summarizeNewsItem({ title: 't' });
    expect(outcome.summaryStatus).toBe('failed');
    expect(outcome.errorCode).toBe(ERROR_SUMMARY_UNAVAILABLE);
  });

  it('超长摘要截断至 200 字', () => {
    const normalized = normalizeSummary('摘'.repeat(300));
    expect(Array.from(normalized ?? '')).toHaveLength(SUMMARY_MAX_CHARS);
    expect(normalizeSummary(null)).toBeNull();
  });

  it('createSummarizer 复用注入依赖', async () => {
    const summarize = createSummarizer({
      callModel: async () => ({ summary: LONG_SUMMARY, category: 'industry_news' }),
    });
    const outcome = await summarize({ title: 't' });
    expect(outcome.summaryStatus).toBe('ok');
    expect(outcome.category).toBe('industry_news');
  });
});
