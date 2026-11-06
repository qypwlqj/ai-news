import { describe, expect, it } from 'vitest';
import {
  handleCategories,
  handleCollect,
  handleCollectRunDetail,
  handleCollectRuns,
  handleHealth,
  handleNewsDetail,
  handleNewsList,
  type NewsApiDeps,
  type NewsRow,
} from '../src/app/news-api';

const totals = { fetched: 1, inserted: 1, duplicates: 0, summaryOk: 0, summaryFailed: 1 };

const failedRow: NewsRow = {
  id: 'n1',
  title: '标题',
  url: 'https://example.com/a',
  source: 'hacker_news',
  publishedAt: '2025-06-01T00:00:00.000Z',
  summary: '不应返回的摘要',
  summaryStatus: 'failed',
  category: 'industry_news',
};

function makeDeps(
  repository: Partial<NewsApiDeps['repository']> = {},
  overrides: Partial<NewsApiDeps> = {},
): NewsApiDeps {
  return {
    repository: {
      listNews: async () => ({ items: [], total: 0 }),
      getNewsById: async () => null,
      listRuns: async () => ({ items: [], total: 0 }),
      getRun: async () => null,
      ...repository,
    },
    collect: async (input) => ({
      runId: 'run-1',
      status: 'success',
      startedAt: '2025-06-01T00:00:00.000Z',
      finishedAt: '2025-06-01T00:00:01.000Z',
      durationMs: 1000,
      date: input.date,
      totals,
      sources: [],
    }),
    cronSecret: 'secret',
    now: () => new Date('2025-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

const codeOf = (result: { body: Record<string, unknown> }) =>
  (result.body.error as { code?: string } | undefined)?.code;

describe('GET /api/news', () => {
  it('默认 page=1 limit=20，失败条目 summary 为 null 且照常返回', async () => {
    const deps = makeDeps({
      listNews: async (query) => {
        expect(query.page).toBe(1);
        expect(query.limit).toBe(20);
        expect(query.startUtc).toBeNull();
        return { items: [failedRow], total: 1 };
      },
    });
    const result = await handleNewsList(deps);
    expect(result.status).toBe(200);
    const items = result.body.items as NewsRow[];
    expect(items).toHaveLength(1);
    expect(items[0].summary).toBeNull();
    expect(result.body.totalPages).toBe(1);
    expect(result.body.hasNext).toBe(false);
    expect(result.body.date).toBeNull();
  });

  it('非法 date / category / 分页一律 400，不静默纠正', async () => {
    const deps = makeDeps();
    expect(codeOf(await handleNewsList(deps, { date: '2025-13-01' }))).toBe('INVALID_DATE');
    expect(codeOf(await handleNewsList(deps, { category: 'bad' }))).toBe('INVALID_CATEGORY');
    expect(codeOf(await handleNewsList(deps, { page: '0' }))).toBe('INVALID_PAGINATION');
    expect(codeOf(await handleNewsList(deps, { limit: '101' }))).toBe('INVALID_PAGINATION');
    expect((await handleNewsList(deps, { limit: '101' })).status).toBe(400);
  });
});

describe('GET /api/news/{id}', () => {
  it('400 INVALID_ID 与 404 NEWS_NOT_FOUND 严格区分', async () => {
    const deps = makeDeps();
    expect((await handleNewsDetail(deps, ' ')).status).toBe(400);
    const missing = await handleNewsDetail(deps, 'n1');
    expect(missing.status).toBe(404);
    expect(codeOf(missing)).toBe('NEWS_NOT_FOUND');
  });
});

describe('GET /api/categories', () => {
  it('固定 5 项且 order 递增', () => {
    const result = handleCategories();
    const items = result.body.items as { value: string; label: string; order: number }[];
    expect(items).toHaveLength(5);
    expect(items.map((item) => item.value)).toEqual([
      'model_release',
      'research_paper',
      'product_application',
      'industry_news',
      'policy_funding',
    ]);
    expect(items.map((item) => item.order)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('GET /api/health', () => {
  it('数据库异常返回 503 degraded', async () => {
    const result = await handleHealth(makeDeps({}, { checkDatabase: async () => false }));
    expect(result.status).toBe(503);
    expect(result.body.status).toBe('degraded');
    expect((await handleHealth(makeDeps())).status).toBe(200);
  });
});

describe('POST /api/cron/collect', () => {
  it('缺少 / 错误令牌返回 401', async () => {
    expect((await handleCollect(makeDeps(), { authorization: null })).status).toBe(401);
    expect((await handleCollect(makeDeps(), { authorization: 'Bearer bad' })).status).toBe(401);
  });

  it('非法 date / source 返回 400', async () => {
    const auth = { authorization: 'Bearer secret' };
    expect(codeOf(await handleCollect(makeDeps(), { ...auth, body: { date: 'x' } }))).toBe('INVALID_DATE');
    expect(codeOf(await handleCollect(makeDeps(), { ...auth, body: { sources: ['rss'] } }))).toBe(
      'INVALID_SOURCE',
    );
  });

  it('并发冲突 409、全源失败 502、部分失败 200', async () => {
    const auth = { authorization: 'Bearer secret' };
    const base = await makeDeps().collect({ date: '2025-06-01', sources: ['hacker_news'], force: false });
    const inProgress = makeDeps({}, { collect: async () => ({ ...base, inProgress: true }) });
    expect((await handleCollect(inProgress, auth)).status).toBe(409);

    const allFailed = makeDeps({}, { collect: async () => ({ ...base, status: 'failed' }) });
    expect((await handleCollect(allFailed, auth)).status).toBe(502);

    const partial = makeDeps({}, { collect: async () => ({ ...base, status: 'partial_failure' }) });
    const ok = await handleCollect(partial, auth);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('partial_failure');
    expect(ok.body.trigger).toBe('api');
  });
});

describe('采集日志接口', () => {
  it('列表默认分页与非法 status', async () => {
    const deps = makeDeps({ listRuns: async (query) => ({ items: [], total: 0 }) });
    const okRun = await handleCollectRuns(deps);
    expect(okRun.status).toBe(200);
    expect(okRun.body.limit).toBe(20);
    expect(codeOf(await handleCollectRuns(deps, { status: 'weird' }))).toBe('INVALID_STATUS');
  });

  it('详情 400 / 404', async () => {
    const deps = makeDeps();
    expect((await handleCollectRunDetail(deps, '')).status).toBe(400);
    expect(codeOf(await handleCollectRunDetail(deps, 'run-1'))).toBe('RUN_NOT_FOUND');
  });
});
