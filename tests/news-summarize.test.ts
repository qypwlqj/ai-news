import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ERROR_LLM_HTTP_ERROR,
  ERROR_LLM_INVALID_RESPONSE,
  ERROR_LLM_NOT_CONFIGURED,
  buildSummaryPrompt,
  createLlmCaller,
  createLlmSummarizer,
  parseModelPayload,
  type LlmFetch,
} from '../src/app/news-llm';
import {
  ERROR_SUMMARY_INVALID_LENGTH,
  ERROR_SUMMARY_TIMEOUT,
  FALLBACK_CATEGORY,
  SUMMARY_CATEGORIES,
  summarizeNewsItem,
} from '../src/app/news-summarize';

const CONFIG = { endpoint: 'https://llm.example.test/v1/chat', model: 'test-model', apiKey: 'sk-test-secret-value' };
const LONG_SUMMARY = '这是一条用于测试的中文摘要'.repeat(6);

function responding(payload: unknown): LlmFetch {
  return async () => ({ ok: true, status: 200, json: async () => payload });
}

function completion(content: string): unknown {
  return { choices: [{ message: { role: 'assistant', content } }] };
}

test('buildSummaryPrompt 覆盖长度约束与 5 个固定枚举', () => {
  const prompt = buildSummaryPrompt({ title: 'OpenAI 发布新模型', url: 'https://example.com/a', rawExcerpt: '片段' });
  assert.match(prompt, /50–200 字/);
  for (const value of SUMMARY_CATEGORIES) assert.match(prompt, new RegExp(value));
  assert.match(prompt, /OpenAI 发布新模型/);
  assert.match(prompt, /只输出 JSON/);
});

test('parseModelPayload 容忍代码块包裹，非法内容返回 null', () => {
  assert.deepEqual(parseModelPayload('```json\n{"summary":"摘要","category":"model_release"}\n```'), {
    summary: '摘要',
    category: 'model_release',
  });
  assert.equal(parseModelPayload('不是 JSON'), null);
  assert.equal(parseModelPayload('{"category":"model_release"}'), null);
  assert.equal(parseModelPayload(null), null);
});

test('配置缺失时调用模型失败但不抛错，降级 failed', async () => {
  const caller = createLlmCaller({ endpoint: '', model: '' }, { fetchImpl: responding(completion('{}')) });
  const outcome = await summarizeNewsItem({ title: 't' }, { callModel: caller });
  assert.equal(outcome.summaryStatus, 'failed');
  assert.equal(outcome.summary, null);
  assert.equal(outcome.category, FALLBACK_CATEGORY);
  assert.equal(outcome.errorCode, ERROR_LLM_NOT_CONFIGURED);
});

test('模型返回合法摘要与枚举 → summaryStatus=ok', async () => {
  const caller = createLlmCaller(
    CONFIG,
    { fetchImpl: responding(completion(JSON.stringify({ summary: LONG_SUMMARY, category: 'model_release' }))) },
  );
  const outcome = await summarizeNewsItem({ title: 't' }, { callModel: caller });
  assert.equal(outcome.summaryStatus, 'ok');
  assert.equal(outcome.summary, LONG_SUMMARY);
  assert.equal(outcome.category, 'model_release');
  assert.equal(outcome.errorCode, null);
});

test('模型返回非法/中文分类名 → 归一或兜底 industry_news，条目仍成功', async () => {
  const invalid = createLlmCaller(
    CONFIG,
    { fetchImpl: responding(completion(JSON.stringify({ summary: LONG_SUMMARY, category: 'unknown_kind' }))) },
  );
  const fallback = await summarizeNewsItem({ title: 't' }, { callModel: invalid });
  assert.equal(fallback.category, FALLBACK_CATEGORY);
  assert.equal(fallback.summaryStatus, 'ok');

  const chinese = createLlmCaller(
    CONFIG,
    { fetchImpl: responding(completion(JSON.stringify({ summary: LONG_SUMMARY, category: '政策融资' }))) },
  );
  const mapped = await summarizeNewsItem({ title: 't' }, { callModel: chinese });
  assert.equal(mapped.category, 'policy_funding');
});

test('HTTP 非 2xx 保留 LLM_HTTP_ERROR，摘要为空且不抛错', async () => {
  const caller = createLlmCaller(CONFIG, { fetchImpl: async () => ({ ok: false, status: 503 }) });
  const outcome = await summarizeNewsItem({ title: 't' }, { callModel: caller });
  assert.equal(outcome.summaryStatus, 'failed');
  assert.equal(outcome.summary, null);
  assert.equal(outcome.errorCode, ERROR_LLM_HTTP_ERROR);
});

test('响应不可解析 → failed 且错误文案不含密钥', async () => {
  const caller = createLlmCaller(CONFIG, { fetchImpl: responding(completion('不是 JSON')) });
  const outcome = await summarizeNewsItem({ title: 't' }, { callModel: caller });
  assert.equal(outcome.summaryStatus, 'failed');
  assert.equal(outcome.errorCode, ERROR_LLM_INVALID_RESPONSE);
  assert.ok(!String(outcome.errorMessage).includes('sk-test-secret-value'));
  assert.ok(!JSON.stringify(outcome).includes('sk-test-secret-value'));
});

test('网络异常降级 failed，不泄露配置', async () => {
  const caller = createLlmCaller(CONFIG, {
    fetchImpl: async () => {
      throw new Error('network down');
    },
  });
  const outcome = await summarizeNewsItem({ title: 't' }, { callModel: caller });
  assert.equal(outcome.summaryStatus, 'failed');
  assert.equal(outcome.summary, null);
  assert.ok(!String(outcome.errorMessage).includes('sk-test-secret-value'));
});

test('超时降级为 SUMMARY_TIMEOUT，批次不中断', async () => {
  const hanging: LlmFetch = () => new Promise(() => {});
  const summarize = createLlmSummarizer(CONFIG, { fetchImpl: hanging, timeoutMs: 10 });
  const outcome = await summarize({ title: 't' });
  assert.equal(outcome.summaryStatus, 'failed');
  assert.equal(outcome.summary, null);
  assert.equal(outcome.category, FALLBACK_CATEGORY);
  assert.equal(outcome.errorCode, ERROR_SUMMARY_TIMEOUT);
});

test('摘要不足 50 字视为非法 → failed', async () => {
  const caller = createLlmCaller(
    CONFIG,
    { fetchImpl: responding(completion(JSON.stringify({ summary: '太短了', category: 'research_paper' }))) },
  );
  const outcome = await summarizeNewsItem({ title: 't' }, { callModel: caller });
  assert.equal(outcome.summaryStatus, 'failed');
  assert.equal(outcome.summary, null);
  assert.equal(outcome.category, 'research_paper');
  assert.equal(outcome.errorCode, ERROR_SUMMARY_INVALID_LENGTH);
});
