import { describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, TITLE_DEDUP_WINDOW_MS, createNewsStore } from '../src/app/news-store';

const base = {
  source: 'hacker_news',
  category: 'model_release',
  publishedAt: new Date('2025-06-01T00:00:00.000Z'),
};

const words = [
  'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet',
  'kilo', 'lima', 'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango',
  'uniform', 'victor', 'whiskey', 'xray', 'yankee',
];

describe('news store / 去重', () => {
  it('按规范化 URL 硬去重（忽略追踪参数与主机大小写）', () => {
    const store = createNewsStore();
    const first = store.insertNews({ ...base, title: 'quantum launches', url: 'https://example.com/a?utm_source=hn' });
    expect(first.inserted).toBe(true);
    expect(
      store.insertNews({ ...base, title: 'bravo different words', url: 'https://EXAMPLE.com/a/' }),
    ).toEqual({ inserted: false, reason: 'normalized_url' });
  });

  it('按 (source, external_id) 去重', () => {
    const store = createNewsStore();
    store.insertNews({ ...base, title: 'quantum launches', url: 'https://example.com/b', externalId: 'hn-1' });
    expect(
      store.insertNews({ ...base, title: 'bravo different words', url: 'https://example.com/c', externalId: 'hn-1' }),
    ).toEqual({ inserted: false, reason: 'external_id' });
  });

  it('近 7 天标题相似度 > 0.9 判重，超出窗口不判重', () => {
    const store = createNewsStore();
    store.insertNews({ ...base, title: 'OpenAI Releases GPT-5 Model', url: 'https://example.com/d' });
    expect(
      store.insertNews({ ...base, title: 'openai releases gpt-5 model!', url: 'https://example.com/e' }),
    ).toEqual({ inserted: false, reason: 'title_similarity' });
    const later = new Date(base.publishedAt.getTime() + TITLE_DEDUP_WINDOW_MS + 86400000);
    const escaped = store.insertNews({
      ...base,
      title: 'openai releases gpt-5 model!',
      url: 'https://example.com/f',
      publishedAt: later,
    });
    expect(escaped.inserted).toBe(true);
  });
});

describe('news store / 查询', () => {
  const seed = () => {
    const store = createNewsStore();
    for (let i = 0; i < 25; i += 1) {
      store.insertNews({
        ...base,
        title: `${words[i]} ${words[(i + 7) % words.length]}`,
        url: `https://example.com/n${i}`,
        source: i % 2 ? 'arxiv_cs_ai' : 'hacker_news',
        category: i % 2 ? 'research_paper' : 'model_release',
        publishedAt: new Date(Date.UTC(2025, 5, 1, 0, i)),
      });
    }
    return store;
  };

  it('默认 limit=20、时间倒序、稳定分页', () => {
    const store = seed();
    const page1 = store.listNews();
    expect(page1.limit).toBe(20);
    expect(page1.total).toBe(25);
    expect(page1.totalPages).toBe(2);
    expect(page1.items).toHaveLength(20);
    expect(page1.items[0].publishedAt.getTime()).toBe(Date.UTC(2025, 5, 1, 0, 24));
    expect(store.listNews({ page: 2 }).items).toHaveLength(5);
  });

  it('按分类 / 来源 / 日期区间筛选', () => {
    const store = seed();
    expect(store.listNews({ category: 'research_paper' }).items.every((i) => i.category === 'research_paper')).toBe(true);
    expect(store.listNews({ source: 'arxiv_cs_ai' }).total).toBe(12);
    expect(
      store.listNews({
        startUtc: new Date('2025-06-02T00:00:00.000Z'),
        endUtc: new Date('2025-06-03T00:00:00.000Z'),
      }).total,
    ).toBe(0);
  });

  it('summary 失败条目照常返回并标记 failed', () => {
    const store = createNewsStore();
    const inserted = store.insertNews({ ...base, title: 'quantum launches', url: 'https://example.com/g' });
    if (!inserted.inserted) throw new Error('expected insert');
    store.saveSummary(inserted.item.id, { summary: null, summaryStatus: 'failed' });
    const listed = store.listNews();
    expect(listed.total).toBe(1);
    expect(listed.items[0].summary).toBeNull();
    expect(listed.items[0].summaryStatus).toBe('failed');
  });
});

describe('news store / 批次日志', () => {
  it('逐源明细 upsert：重试只更新 attempts，不新增行', () => {
    const store = createNewsStore();
    const run = store.createRun({ trigger: 'api', date: '2025-06-01' });
    store.saveSourceRun({ runId: run.id, source: 'hacker_news', status: 'failed', errorMessage: 'boom' });
    const retried = store.saveSourceRun({
      runId: run.id,
      source: 'hacker_news',
      status: 'success',
      fetched: 30,
      inserted: 24,
      durationMs: 1200,
    });
    expect(retried.attempts).toBe(2);
    expect(retried.errorMessage).toBeNull();
    const detail = store.getRun(run.id);
    expect(detail?.sources).toHaveLength(1);
    expect(detail?.sources[0].fetched).toBe(30);
    expect(store.saveSourceRun({ runId: run.id, source: 'hacker_news', status: 'success' }).attempts).toBe(
      MAX_ATTEMPTS,
    );
  });

  it('finishRun 汇总 totals 并可查询当日成功批次', () => {
    const store = createNewsStore();
    const run = store.createRun({ trigger: 'cron', date: '2025-06-01' });
    expect(store.findSuccessfulRun('2025-06-01')).toBeNull();
    store.saveSourceRun({ runId: run.id, source: 'arxiv_cs_ai', status: 'success', fetched: 20, inserted: 20 });
    const finished = store.finishRun(run.id, 'success', { summaryOk: 19, summaryFailed: 1 });
    expect(finished?.run.totals).toEqual({ fetched: 20, inserted: 20, duplicates: 0, summaryOk: 19, summaryFailed: 1 });
    expect(finished?.run.durationMs).toBeGreaterThanOrEqual(0);
    expect(store.findSuccessfulRun('2025-06-01')?.id).toBe(run.id);
    expect(store.listRuns({ status: 'success' }).total).toBe(1);
    expect(store.listRuns({ date: '2025-06-02' }).total).toBe(0);
  });
});
