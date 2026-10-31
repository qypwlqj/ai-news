import { describe, expect, it } from 'vitest';
import { GET } from '../src/app/api/news/route';
import { isIsoDate } from '../src/lib/query';

const BASE = 'http://localhost/api/news';

function request(query = ''): Promise<Response> {
  return GET(new Request(`${BASE}${query}`));
}

async function codeOf(response: Response): Promise<string> {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code ?? '';
}

type NewsBody = {
  items: Array<Record<string, unknown>>;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
};

describe('GET /api/news 参数校验', () => {
  it('非法 date 返回 400 INVALID_DATE', async () => {
    for (const query of ['?date=2025-6-1', '?date=not-a-date']) {
      const response = await request(query);
      expect(response.status).toBe(400);
      expect(await codeOf(response)).toBe('INVALID_DATE');
    }
  });

  it('非法 category 返回 400 INVALID_CATEGORY（不静默忽略）', async () => {
    const response = await request('?category=bad_value');
    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe('INVALID_CATEGORY');
  });

  it('非法 source 返回 400 INVALID_SOURCE', async () => {
    const response = await request('?source=weibo');
    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe('INVALID_SOURCE');
  });

  it('分页越界或非整数返回 400 INVALID_PAGINATION', async () => {
    for (const query of ['?page=0', '?page=abc', '?limit=0', '?limit=101']) {
      const response = await request(query);
      expect(response.status).toBe(400);
      expect(await codeOf(response)).toBe('INVALID_PAGINATION');
    }
  });

  it('date 判定函数只接受 YYYY-MM-DD', () => {
    expect(isIsoDate('2025-06-01')).toBe(true);
    expect(isIsoDate('2025-6-1')).toBe(false);
    expect(isIsoDate('2025/06/01')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });
});

describe('GET /api/news 默认值与返回字段', () => {
  it('缺省查询返回 200，page=1 且 limit 默认 20', async () => {
    const response = await request();
    expect(response.status).toBe(200);
    const body = (await response.json()) as NewsBody;
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(body.totalPages).toBeGreaterThanOrEqual(1);
    expect(typeof body.hasNext).toBe('boolean');
  });

  it('limit 上限 100 合法并被回显', async () => {
    const response = await request('?limit=100');
    expect(response.status).toBe(200);
    const body = (await response.json()) as NewsBody;
    expect(body.limit).toBe(100);
  });

  it('返回条目字段齐全，含 summaryStatus=failed 的可见性', async () => {
    const body = (await (await request('?limit=100')).json()) as NewsBody;
    for (const item of body.items) {
      for (const key of ['id', 'title', 'url', 'source', 'publishedAt', 'category', 'summaryStatus']) {
        expect(item).toHaveProperty(key);
      }
      expect(item).toHaveProperty('summary');
      if (item.summaryStatus === 'failed') {
        expect(item.summary === null || item.summary === '').toBe(true);
      }
    }
  });
});
