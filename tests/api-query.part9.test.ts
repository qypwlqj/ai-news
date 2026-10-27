import { beforeEach, describe, expect, it } from 'vitest';
import { GET as getNews } from '../src/app/api/news/route';
import { POST as postCollect } from '../src/app/api/cron/collect/route';
import { InMemoryNewsRepository, getNewsRepository, setNewsRepository } from '../src/lib/db/repository';
import { listNews, parseNewsQuery } from '../src/lib/query';
import { setCollectExecutor, setRuntimeConfig } from '../src/lib/runtime';
import type { NewsItemRecord } from '../src/lib/types';

const PUBLISHED = new Date('2025-06-01T02:00:00.000Z');

function makeItem(index: number, overrides: Record<string, unknown> = {}): NewsItemRecord {
  return {
    id: 'news-' + index,
    title: '标题' + index,
    url: 'https://example.com/news-' + index,
    source: 'hacker_news',
    publishedAt: PUBLISHED,
    summary: '摘'.repeat(60),
    summaryStatus: 'ok',
    category: 'model_release',
    createdAt: PUBLISHED,
    updatedAt: PUBLISHED,
    ...overrides,
  } as unknown as NewsItemRecord;
}

async function seed(count: number): Promise<void> {
  const repo = getNewsRepository();
  for (let i = 1; i <= count; i += 1) {
    await repo.insertNews(makeItem(i));
  }
}

beforeEach(() => {
  setNewsRepository(new InMemoryNewsRepository());
  setRuntimeConfig({ cronSecret: 'test-secret' });
  setCollectExecutor(null);
});

describe('parseNewsQuery', () => {
  it('缺省 page=1、limit=20，且允许空查询', () => {
    const parsed = parseNewsQuery(new URLSearchParams(''));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.page).toBe(1);
    expect(parsed.value.limit).toBe(20);
    expect(parsed.value.date).toBeNull();
  });

  it('非法 date / category / limit 返回稳定错误码', () => {
    const badDate = parseNewsQuery(new URLSearchParams('date=2025-02-30'));
    expect(badDate.ok ? '' : badDate.code).toBe('INVALID_DATE');
    const badCategory = parseNewsQuery(new URLSearchParams('category=bad'));
    expect(badCategory.ok ? '' : badCategory.code).toBe('INVALID_CATEGORY');
    const badLimit = parseNewsQuery(new URLSearchParams('limit=101'));
    expect(badLimit.ok ? '' : badLimit.code).toBe('INVALID_PAGINATION');
    const badPage = parseNewsQuery(new URLSearchParams('page=0'));
    expect(badPage.ok ? '' : badPage.code).toBe('INVALID_PAGINATION');
  });
});

describe('listNews', () => {
  it('默认 limit=20、按时间倒序并返回约定字段', async () => {
    await seed(25);
    const result = await listNews(new URLSearchParams('date=2025-06-01'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(20);
    expect(result.value.total).toBe(25);
    expect(result.value.totalPages).toBe(2);
    expect(result.value.hasNext).toBe(true);
    expect(result.value.date).toBe('2025-06-01');
    expect(Object.keys(result.value.items[0])).toEqual(
      expect.arrayContaining(['id', 'title', 'url', 'source', 'publishedAt', 'summary', 'category', 'summaryStatus']),
    );
  });

  it('summary_status=failed 的条目照常返回', async () => {
    await seed(1);
    await getNewsRepository().saveSummary('news-1', { summary: null, category: 'industry_news', summaryStatus: 'failed' });
    const result = await listNews(new URLSearchParams('category=industry_news'));
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.items).toHaveLength(1);
    expect(result.value.items[0].summary).toBeNull();
    expect(result.value.items[0].summaryStatus).toBe('failed');
  });
});

describe('GET /api/news', () => {
  it('合法查询返回 200 与分页结构', async () => {
    await seed(24);
    const response = await getNews(new Request('http://localhost/api/news?date=2025-06-01&page=1'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: unknown[]; limit: number };
    expect(body.limit).toBe(20);
    expect(body.items).toHaveLength(20);
  });

  it('非法分类返回 400 INVALID_CATEGORY 错误信封', async () => {
    const response = await getNews(new Request('http://localhost/api/news?category=bad'));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; message: string; requestId: string } };
    expect(body.error.code).toBe('INVALID_CATEGORY');
    expect(body.error.requestId).toBeTruthy();
  });
});

describe('POST /api/cron/collect', () => {
  it('缺少令牌返回 401，令牌错误返回 403', async () => {
    const anonymous = await postCollect(new Request('http://localhost/api/cron/collect', { method: 'POST' }));
    expect(anonymous.status).toBe(401);
    const forbidden = await postCollect(
      new Request('http://localhost/api/cron/collect', { method: 'POST', headers: { authorization: 'Bearer wrong' } }),
    );
    expect(forbidden.status).toBe(403);
  });

  it('空 body 合法，返回采集结果结构', async () => {
    let received: unknown = null;
    setCollectExecutor(async (body) => {
      received = body;
      return { status: 'success', runId: 'run-1', totals: { inserted: 3 } };
    });
    const response = await postCollect(
      new Request('http://localhost/api/cron/collect', {
        method: 'POST',
        headers: { authorization: 'Bearer test-secret' },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; runId: string };
    expect(body.runId).toBe('run-1');
    expect(received).toEqual({ date: undefined, sources: undefined, force: undefined });
  });

  it('透传 date/sources/force，全部来源失败返回 502', async () => {
    const calls: unknown[] = [];
    setCollectExecutor(async (body) => {
      calls.push(body);
      return { status: 'failed', runId: 'run-2', sources: [] };
    });
    const response = await postCollect(
      new Request('http://localhost/api/cron/collect', {
        method: 'POST',
        headers: { authorization: 'Bearer test-secret' },
        body: JSON.stringify({ date: '2025-06-01', sources: ['arxiv_cs_ai'], force: true }),
      }),
    );
    expect(response.status).toBe(502);
    expect(calls).toEqual([{ date: '2025-06-01', sources: ['arxiv_cs_ai'], force: true }]);
  });

  it('非法 date / sources 返回 400', async () => {
    const badDate = await postCollect(
      new Request('http://localhost/api/cron/collect', {
        method: 'POST',
        headers: { authorization: 'Bearer test-secret' },
        body: JSON.stringify({ date: '2025-13-01' }),
      }),
    );
    expect(badDate.status).toBe(400);
    const badSource = await postCollect(
      new Request('http://localhost/api/cron/collect', {
        method: 'POST',
        headers: { authorization: 'Bearer test-secret' },
        body: JSON.stringify({ sources: ['weibo'] }),
      }),
    );
    expect(badSource.status).toBe(400);
    const badJson = await postCollect(
      new Request('http://localhost/api/cron/collect', {
        method: 'POST',
        headers: { authorization: 'Bearer test-secret' },
        body: '{',
      }),
    );
    expect(badJson.status).toBe(400);
  });
});
