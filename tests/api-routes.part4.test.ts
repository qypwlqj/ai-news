import { describe, expect, it } from 'vitest';
import { GET as getCategories } from '../src/app/api/categories/route';
import { GET as getRun } from '../src/app/api/collect-runs/[runId]/route';
import { GET as listRuns } from '../src/app/api/collect-runs/route';
import { GET as getHealth } from '../src/app/api/health/route';
import { GET as getNewsDetail } from '../src/app/api/news/[id]/route';
import { getNewsRepository } from '../src/lib/db/repository';

function request(url: string): Request {
  return new Request(url);
}

function paramsOf(values: Record<string, string>) {
  return { params: Promise.resolve(values) };
}

const newsRecord = {
  id: 'route-news-1',
  title: '模型发布速览',
  url: 'https://example.com/route-news-1',
  source: 'hacker_news' as const,
  externalId: 'hn-route-news-1',
  publishedAt: new Date('2025-06-01T00:00:00.000Z'),
  summary: '这是一段中文摘要，用于验证详情接口的字段映射是否与契约一致。',
  summaryStatus: 'ok' as const,
  category: 'model_release' as const,
  rawExcerpt: 'excerpt',
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('GET /api/categories', () => {
  it('返回固定 5 项 value/label/order', async () => {
    const response = await getCategories();
    expect(response.status).toBe(200);
    const body = await readJson(response);
    const items = body.items as Array<{ value: string; label: string; order: number }>;
    expect(items).toHaveLength(5);
    expect(items.map((item) => item.value)).toEqual([
      'model_release',
      'research_paper',
      'product_application',
      'industry_news',
      'policy_funding',
    ]);
    expect(items.map((item) => item.order)).toEqual([1, 2, 3, 4, 5]);
    expect(items.every((item) => item.label.length > 0)).toBe(true);
  });
});

describe('GET /api/news/{id}', () => {
  it('命中条目时返回详情字段', async () => {
    await getNewsRepository().insertNews(newsRecord);
    const response = await getNewsDetail(request('http://localhost/api/news/route-news-1'), paramsOf({
      id: 'route-news-1',
    }));
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.id).toBe('route-news-1');
    expect(body.title).toBe(newsRecord.title);
    expect(body.url).toBe(newsRecord.url);
    expect(body.category).toBe('model_release');
    expect(body.summaryStatus).toBe('ok');
    expect(body.publishedAt).toBe('2025-06-01T00:00:00.000Z');
  });

  it('未知 id 返回 404 NEWS_NOT_FOUND', async () => {
    const response = await getNewsDetail(request('http://localhost/api/news/missing-news'), paramsOf({
      id: 'missing-news',
    }));
    expect(response.status).toBe(404);
    const body = await readJson(response);
    expect((body.error as { code: string }).code).toBe('NEWS_NOT_FOUND');
  });

  it('非法 id 返回 400 INVALID_ID', async () => {
    const response = await getNewsDetail(request('http://localhost/api/news/bad%20id'), paramsOf({
      id: 'bad id',
    }));
    expect(response.status).toBe(400);
    const body = await readJson(response);
    expect((body.error as { code: string }).code).toBe('INVALID_ID');
  });
});

describe('GET /api/collect-runs', () => {
  it('默认分页 limit=20 且返回 items', async () => {
    const response = await listRuns(request('http://localhost/api/collect-runs'));
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
  });

  it('非法 status 返回 400 INVALID_STATUS', async () => {
    const response = await listRuns(request('http://localhost/api/collect-runs?status=running'));
    expect(response.status).toBe(400);
    const body = await readJson(response);
    expect((body.error as { code: string }).code).toBe('INVALID_STATUS');
  });

  it('非法 date 与 limit 返回 400', async () => {
    const badDate = await listRuns(request('http://localhost/api/collect-runs?date=2025-13-01'));
    expect(badDate.status).toBe(400);
    const badLimit = await listRuns(request('http://localhost/api/collect-runs?limit=101'));
    expect(badLimit.status).toBe(400);
    const body = await readJson(badLimit);
    expect((body.error as { code: string }).code).toBe('INVALID_PAGINATION');
  });
});

describe('GET /api/collect-runs/{runId}', () => {
  it('未知批次返回 404 RUN_NOT_FOUND', async () => {
    const response = await getRun(request('http://localhost/api/collect-runs/missing-run'), paramsOf({
      runId: 'missing-run',
    }));
    expect(response.status).toBe(404);
    const body = await readJson(response);
    expect((body.error as { code: string }).code).toBe('RUN_NOT_FOUND');
  });

  it('非法 runId 返回 400 INVALID_RUN_ID', async () => {
    const response = await getRun(request('http://localhost/api/collect-runs/bad'), paramsOf({ runId: '' }));
    expect(response.status).toBe(400);
    const body = await readJson(response);
    expect((body.error as { code: string }).code).toBe('INVALID_RUN_ID');
  });
});

describe('GET /api/health', () => {
  it('返回 ok 与 database 状态，不含配置信息', async () => {
    const response = await getHealth();
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.status).toBe('ok');
    expect((body.checks as { database: string }).database).toBe('ok');
    expect(JSON.stringify(body)).not.toContain('CRON_SECRET');
  });
});
