import { describe, expect, it } from 'vitest';
import { InMemoryNewsRepository, shanghaiDayRange } from '../src/lib/db/repository';
import type { NewsItemRecord } from '../src/lib/types';

function item(overrides: Partial<NewsItemRecord> = {}): NewsItemRecord {
  return {
    id: 'n1',
    title: 'OpenAI 发布 GPT-5 模型',
    url: 'https://example.com/a',
    normalizedUrl: '',
    titleFingerprint: '',
    source: 'hacker_news',
    publishedAt: new Date('2025-06-01T02:00:00.000Z'),
    summary: null,
    summaryStatus: 'pending',
    category: 'model_release',
    ...overrides,
  };
}

function run(overrides: Partial<import('../src/lib/db/repository').CollectRunRecord> = {}) {
  return {
    id: 'r1',
    trigger: 'api' as const,
    runDate: '2025-06-01',
    status: 'failed' as const,
    startedAt: new Date('2025-06-01T00:00:00.000Z'),
    finishedAt: null,
    durationMs: null,
    totals: { fetched: 0, inserted: 0, duplicates: 0, summaryOk: 0, summaryFailed: 0 },
    ...overrides,
  };
}

describe('shanghaiDayRange', () => {
  it('converts a natural day to a UTC half-open interval', () => {
    expect(shanghaiDayRange('2025-06-01')?.start.toISOString()).toBe('2025-05-31T16:00:00.000Z');
    expect(shanghaiDayRange('2025-06-01')?.end.toISOString()).toBe('2025-06-01T16:00:00.000Z');
    expect(shanghaiDayRange('2025-6-1')).toBeNull();
  });
});

describe('InMemoryNewsRepository', () => {
  it('rejects duplicates by normalized url, external id and title similarity', async () => {
    const repo = new InMemoryNewsRepository();
    expect((await repo.insertNews(item({ id: 'a', url: 'https://ex.test/x?utm_source=a' }))).inserted).toBe(true);
    expect(await repo.insertNews(item({ id: 'b', url: 'https://ex.test/x', title: '完全不同标题' }))).toMatchObject({
      inserted: false,
      reason: 'normalized_url',
    });
    expect(await repo.insertNews(item({ id: 'c', url: 'https://other.test/y', title: 'OpenAI 发布 GPT-5 模型！' }))).toMatchObject({
      inserted: false,
      reason: 'title_similarity',
    });
    expect((await repo.insertNews(item({ id: 'd', url: 'https://ext.test/z', title: '另一个标题', externalId: 'hn-1' }))).inserted).toBe(true);
    expect(
      await repo.insertNews(item({ id: 'e', url: 'https://ext2.test/z', title: '又一个标题', externalId: 'hn-1' })),
    ).toMatchObject({ inserted: false, reason: 'external_id' });
  });

  it('filters by Asia/Shanghai natural day', async () => {
    const repo = new InMemoryNewsRepository();
    await repo.insertNews(item({ id: '1', url: 'https://d.test/1', title: '第一条', publishedAt: new Date('2025-05-31T16:00:00.000Z') }));
    await repo.insertNews(item({ id: '2', url: 'https://d.test/2', title: '第二条', publishedAt: new Date('2025-06-01T15:59:59.000Z') }));
    await repo.insertNews(item({ id: '3', url: 'https://d.test/3', title: '第三条', publishedAt: new Date('2025-06-01T16:00:00.000Z') }));
    expect((await repo.listNews({ date: '2025-06-01' })).items.map((entry) => entry.id)).toEqual(['2', '1']);
    expect((await repo.listNews({ date: '2025-6-1' })).total).toBe(0);
    expect((await repo.listNews({ date: '2025-06-02' })).items.map((entry) => entry.id)).toEqual(['3']);
  });

  it('sorts by publishedAt desc with default limit 20', async () => {
    const repo = new InMemoryNewsRepository();
    for (let i = 0; i < 25; i += 1) {
      await repo.insertNews(
        item({ id: `p${i}`, url: `https://p.test/${i}`, title: `t${i}`, publishedAt: new Date(Date.UTC(2025, 5, 1, 0, 0, i)) }),
      );
    }
    const first = await repo.listNews({});
    expect(first.limit).toBe(20);
    expect(first.total).toBe(25);
    expect(first.items).toHaveLength(20);
    expect(first.items[0].id).toBe('p24');
    expect((await repo.listNews({ page: 2 })).items.map((entry) => entry.id)).toEqual(['p4', 'p3', 'p2', 'p1', 'p0']);
  });

  it('keeps items whose summary failed and exposes them in list results', async () => {
    const repo = new InMemoryNewsRepository();
    await repo.insertNews(item({ id: 's1' }));
    const updated = await repo.saveSummary('s1', { summary: null, category: 'industry_news', summaryStatus: 'failed' });
    expect(updated).toMatchObject({ summary: null, summaryStatus: 'failed', category: 'industry_news' });
    expect((await repo.listNews({})).items.map((entry) => entry.id)).toEqual(['s1']);
    expect(await repo.getNewsById('missing')).toBeNull();
  });

  it('records collect runs and per-source detail', async () => {
    const repo = new InMemoryNewsRepository();
    await repo.createRun(run());
    await repo.saveSourceRun({
      runId: 'r1',
      source: 'hacker_news',
      status: 'failed',
      fetched: 0,
      inserted: 0,
      duplicates: 0,
      failed: 1,
      durationMs: 1200,
      attempts: 3,
      errorCode: 'HTTP_500',
      errorMessage: 'upstream error',
    });
    const finished = await repo.finishRun('r1', {
      status: 'partial_failure',
      finishedAt: new Date('2025-06-01T00:00:05.000Z'),
      durationMs: 5000,
      totals: { fetched: 5, inserted: 4, duplicates: 1, summaryOk: 3, summaryFailed: 1 },
    });
    expect(finished).toMatchObject({ status: 'partial_failure', durationMs: 5000 });
    const detail = await repo.getRun('r1');
    expect(detail?.sources).toHaveLength(1);
    expect(detail?.sources[0]).toMatchObject({ source: 'hacker_news', attempts: 3, errorCode: 'HTTP_500' });
    expect((await repo.findSuccessfulRun('2025-06-01'))?.id).toBe('r1');
    expect((await repo.findSuccessfulRun('2025-06-02'))).toBeNull();
    expect((await repo.listRuns({ status: 'success' })).total).toBe(0);
    expect((await repo.listRuns({})).items.map((entry) => entry.id)).toEqual(['r1']);
  });
});
