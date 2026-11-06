import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalUrl, createMemoryNewsStore, titleKey, titleSimilarity } from '../src/lib/store';
import type { NewsItemRecord } from '../src/lib/types';

const BASE = Date.parse('2025-06-01T02:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function makeItem(overrides: Partial<NewsItemRecord> & { id: string; title: string; url: string }): NewsItemRecord {
  return {
    source: 'hacker_news',
    externalId: null,
    publishedAt: new Date(BASE),
    summary: null,
    summaryStatus: 'pending',
    category: 'industry_news',
    rawExcerpt: null,
    ...overrides,
  } as NewsItemRecord;
}

describe('规范化与相似度', () => {
  it('规范化 URL 去掉 #片段与追踪参数', () => {
    assert.equal(canonicalUrl('https://Example.com/a/?utm_source=hn&ref=feed#top'), 'https://example.com/a');
  });

  it('标题相似度：仅标点差异为 1，轻微改写 > 0.9，无关标题 < 0.9', () => {
    const base = titleKey('OpenAI 发布 GPT-5 模型：推理能力提升');
    assert.equal(titleSimilarity(base, titleKey('OpenAI 发布 GPT-5 模型，推理能力提升')), 1);
    const slight = titleKey('OpenAI 发布 GPT-5 模型 推理能力大幅提升');
    assert.ok(titleSimilarity(base, slight) > 0.9);
    assert.ok(titleSimilarity(base, titleKey('某公司宣布新一轮融资与合规政策')) < 0.9);
  });
});

describe('去重与幂等', () => {
  it('同 URL（含追踪参数差异）只保留一条，重复计入 reason=normalized_url', () => {
    const store = createMemoryNewsStore();
    const first = store.insertNews(makeItem({ id: 'n1', title: 'AI 模型发布', url: 'https://example.com/a' }));
    const second = store.insertNews(
      makeItem({ id: 'n2', title: 'AI 模型发布', url: 'https://example.com/a?utm_source=hn' }),
    );
    assert.equal(first.inserted, true);
    assert.equal(second.inserted, false);
    assert.equal(second.reason, 'normalized_url');
    assert.equal(store.count(), 1);
  });

  it('(source, external_id) 幂等，不同来源同 ID 不冲突', () => {
    const store = createMemoryNewsStore();
    store.insertNews(makeItem({ id: 'n1', title: '第一篇资讯', url: 'https://example.com/a', externalId: '42' }));
    const duplicate = store.insertNews(
      makeItem({ id: 'n2', title: '另一段完全不同的标题内容', url: 'https://example.com/b', externalId: '42' }),
    );
    assert.equal(duplicate.inserted, false);
    assert.equal(duplicate.reason, 'external_id');
    const otherSource = store.insertNews(
      makeItem({ id: 'n3', title: '另一段完全不同的标题内容', url: 'https://example.com/c', externalId: '42', source: 'arxiv_cs_ai' }),
    );
    assert.equal(otherSource.inserted, true);
  });

  it('近 7 天标题相似度 > 0.9 判重，窗口外可入库', () => {
    const store = createMemoryNewsStore();
    store.insertNews(
      makeItem({ id: 'n1', title: 'OpenAI 发布 GPT-5 模型：推理能力提升', url: 'https://example.com/a' }),
    );
    const similar = store.insertNews(
      makeItem({
        id: 'n2',
        title: 'OpenAI 发布 GPT-5 模型，推理能力提升',
        url: 'https://example.com/b',
        publishedAt: new Date(BASE + DAY_MS),
      }),
    );
    assert.equal(similar.inserted, false);
    assert.equal(similar.reason, 'title_similarity');

    const outOfWindow = store.insertNews(
      makeItem({
        id: 'n3',
        title: 'OpenAI 发布 GPT-5 模型，推理能力提升',
        url: 'https://example.com/c',
        publishedAt: new Date(BASE + 30 * DAY_MS),
      }),
    );
    assert.equal(outOfWindow.inserted, true);
  });
});

describe('列表查询', () => {
  it('默认 limit=20 且按 publishedAt DESC, id DESC 稳定分页', () => {
    const store = createMemoryNewsStore();
    for (let index = 0; index < 25; index += 1) {
      store.insertNews(
        makeItem({
          id: `n${String(index).padStart(2, '0')}`,
          title: `资讯 ${index}`,
          url: `https://example.com/${index}`,
          publishedAt: new Date(BASE - index * 30 * DAY_MS),
        }),
      );
    }
    const first = store.listNews();
    assert.equal(first.limit, 20);
    assert.equal(first.items.length, 20);
    assert.equal(first.total, 25);
    assert.equal(first.totalPages, 2);
    assert.equal(first.hasNext, true);
    assert.equal(first.items[0]?.id, 'n00');

    const second = store.listNews({ page: 2 });
    assert.equal(second.items.length, 5);
    assert.equal(second.hasNext, false);
    assert.equal(second.items[0]?.id, 'n20');
  });

  it('按分类与来源过滤', () => {
    const store = createMemoryNewsStore();
    store.insertNews(makeItem({ id: 'n1', title: '资讯一', url: 'https://example.com/1', category: 'model_release' }));
    store.insertNews(
      makeItem({ id: 'n2', title: '资讯二', url: 'https://example.com/2', category: 'research_paper', source: 'arxiv_cs_ai' }),
    );
    assert.deepEqual(
      store.listNews({ category: 'research_paper' }).items.map((item) => item.id),
      ['n2'],
    );
    assert.deepEqual(
      store.listNews({ source: 'hacker_news' }).items.map((item) => item.id),
      ['n1'],
    );
  });

  it('date 按 Asia/Shanghai 自然日换算为 UTC 半开区间', () => {
    const store = createMemoryNewsStore();
    store.insertNews(
      makeItem({ id: 'in', title: '当日资讯', url: 'https://example.com/in', publishedAt: new Date('2025-05-31T16:30:00.000Z') }),
    );
    store.insertNews(
      makeItem({ id: 'out', title: '次日资讯', url: 'https://example.com/out', publishedAt: new Date('2025-05-31T15:30:00.000Z') }),
    );
    const result = store.listNews({ date: '2025-06-01' });
    assert.equal(result.date, '2025-06-01');
    assert.deepEqual(
      result.items.map((item) => item.id),
      ['in'],
    );
  });

  it('summary_status=failed 的条目仍可查询且 summary 为 null', () => {
    const store = createMemoryNewsStore();
    store.insertNews(makeItem({ id: 'n1', title: '摘要降级资讯', url: 'https://example.com/1' }));
    store.saveSummary('n1', { summary: null, category: 'industry_news', summaryStatus: 'failed' });
    const result = store.listNews();
    assert.equal(result.total, 1);
    assert.equal(result.items[0]?.summaryStatus, 'failed');
    assert.equal(result.items[0]?.summary, null);
  });
});

describe('批次日志', () => {
  const totals = { fetched: 10, inserted: 8, duplicates: 2, summaryOk: 7, summaryFailed: 1 };

  it('逐源明细同批次同来源仅一行，重试只更新 attempts', () => {
    const store = createMemoryNewsStore();
    store.createRun({
      id: 'run-1',
      trigger: 'api',
      runDate: '2025-06-01',
      status: 'failed',
      startedAt: new Date(BASE),
      finishedAt: null,
      durationMs: null,
      totals: { fetched: 0, inserted: 0, duplicates: 0, summaryOk: 0, summaryFailed: 0 },
    });
    const base = {
      runId: 'run-1',
      source: 'hacker_news' as const,
      status: 'failed' as const,
      fetched: 0,
      inserted: 0,
      duplicates: 0,
      failed: 0,
      durationMs: 0,
      attempts: 1,
      errorCode: 'FETCH_FAILED',
      errorMessage: 'boom',
    };
    store.saveSourceRun(base);
    store.saveSourceRun({ ...base, status: 'success', fetched: 10, inserted: 8, duplicates: 2, attempts: 2, errorCode: null, errorMessage: null });
    const detail = store.getRun('run-1');
    assert.ok(detail);
    assert.equal(detail?.sources.length, 1);
    assert.equal(detail?.sources[0]?.attempts, 2);
    assert.equal(detail?.sources[0]?.status, 'success');
  });

  it('完成批次后可查到成功批次并按状态/日期筛选', () => {
    const store = createMemoryNewsStore();
    store.createRun({
      id: 'run-1',
      trigger: 'cron',
      runDate: '2025-06-01',
      status: 'failed',
      startedAt: new Date(BASE),
      finishedAt: null,
      durationMs: null,
      totals: { fetched: 0, inserted: 0, duplicates: 0, summaryOk: 0, summaryFailed: 0 },
    });
    assert.equal(store.findSuccessfulRun('2025-06-01'), null);
    store.finishRun('run-1', { status: 'success', finishedAt: new Date(BASE + 1000), durationMs: 1000, totals });
    assert.equal(store.findSuccessfulRun('2025-06-01')?.id, 'run-1');
    assert.equal(store.findSuccessfulRun('2025-06-02'), null);

    const success = store.listRuns({ status: 'success', date: '2025-06-01' });
    assert.equal(success.total, 1);
    assert.deepEqual(success.items[0]?.totals, totals);
    assert.equal(store.listRuns({ status: 'partial_failure' }).total, 0);
  });
});
