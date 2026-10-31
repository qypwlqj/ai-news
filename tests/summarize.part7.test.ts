import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSummaryPrompt,
  CATEGORY_VALUES,
  countSummaryChars,
  FALLBACK_CATEGORY,
  LlmError,
  parseLlmOutput,
  truncateSummary,
} from '../src/lib/llm';
import { LLM_INVALID_OUTPUT_CODE, LLM_NOT_CONFIGURED_CODE, LLM_TIMEOUT_CODE, summarizeNews } from '../src/lib/summarize';

const LONG_ZH = '模型发布'.repeat(60);
const SUMMARY_OK = '这是一个用来验证摘要长度校验的中文摘要文本，内容需要达到五十个字符的下限，因此这里继续补充一些描述性文字以保证长度符合要求。';

function okPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ summary: SUMMARY_OK, category: 'model_release', ...overrides });
}

test('prompt 包含 5 个分类枚举且限制摘要长度', () => {
  const prompt = buildSummaryPrompt({ title: 't', excerpt: null });
  for (const value of CATEGORY_VALUES) assert.ok(prompt.includes(value));
  assert.ok(prompt.includes('50-200'));
  assert.equal(CATEGORY_VALUES.length, 5);
});

test('parseLlmOutput 容忍围栏与多余文字', () => {
  const raw = '```json\n' + okPayload() + '\n```';
  const parsed = parseLlmOutput(raw);
  assert.ok(parsed);
  assert.equal(parsed?.category, 'model_release');
});

test('parseLlmOutput 拒绝非法分类与过短摘要', () => {
  assert.equal(parseLlmOutput(okPayload({ category: 'other' })), null);
  assert.equal(parseLlmOutput(okPayload({ category: 1 })), null);
  assert.equal(parseLlmOutput(okPayload({ summary: '太短' })), null);
  assert.equal(parseLlmOutput('not json'), null);
});

test('摘要超长截断到 200 字且字数统计按码点', () => {
  const long = truncateSummary(LONG_ZH);
  assert.equal(countSummaryChars(long), 200);
  assert.equal(countSummaryChars('  中文  '), 2);
});

test('summary 成功时返回 ok 与模型给出的分类', async () => {
  const client = { complete: async () => okPayload({ category: 'research_paper' }) };
  const result = await summarizeNews({ title: 'ArXiv 论文发布' }, client);
  assert.equal(result.summaryStatus, 'ok');
  assert.equal(result.category, 'research_paper');
  assert.ok(result.summary && countSummaryChars(result.summary) >= 50);
  assert.equal(result.errorCode, undefined);
});

test('LLM 抛错时降级 failed 且不抛出', async () => {
  const client = {
    complete: async () => {
      throw new LlmError('LLM_HTTP_500', 'upstream 500');
    },
  };
  const result = await summarizeNews({ title: 'x' }, client);
  assert.equal(result.summaryStatus, 'failed');
  assert.equal(result.summary, null);
  assert.equal(result.category, FALLBACK_CATEGORY);
  assert.equal(result.errorCode, 'LLM_HTTP_500');
});

test('未配置客户端与非法输出都降级为 failed', async () => {
  const missing = await summarizeNews({ title: 'x' }, null);
  assert.equal(missing.summaryStatus, 'failed');
  assert.equal(missing.errorCode, LLM_NOT_CONFIGURED_CODE);

  const bad = await summarizeNews({ title: 'x' }, { complete: async () => 'oops' });
  assert.equal(bad.summaryStatus, 'failed');
  assert.equal(bad.errorCode, LLM_INVALID_OUTPUT_CODE);
  assert.equal(bad.category, FALLBACK_CATEGORY);
});

test('调用超时降级 failed 并返回超时错误码', async () => {
  const client = {
    complete: () => new Promise<string>((resolve) => setTimeout(() => resolve(okPayload()), 200)),
  };
  const result = await summarizeNews({ title: 'x' }, client, { timeoutMs: 10 });
  assert.equal(result.summaryStatus, 'failed');
  assert.equal(result.errorCode, LLM_TIMEOUT_CODE);
});
