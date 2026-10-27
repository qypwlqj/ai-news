import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GET } from '../src/app/api/news/route';

interface NewsListBody {
  items: Array<Record<string, unknown>>;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  date: string | null;
}

test('GET /api/news 返回 200 与完整分页字段（默认 limit=20）', async () => {
  const response = await GET(new Request('http://localhost/api/news'));
  assert.equal(response.status, 200);
  const body = (await response.json()) as NewsListBody;
  assert.equal(body.page, 1);
  assert.equal(body.limit, 20);
  assert.ok(Array.isArray(body.items));
  for (const key of ['items', 'page', 'limit', 'total', 'totalPages', 'hasNext', 'date']) {
    assert.ok(key in body, `missing field ${key}`);
  }
});

test('GET /api/news 非法分类返回 400 INVALID_CATEGORY', async () => {
  const response = await GET(new Request('http://localhost/api/news?category=bad'));
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'INVALID_CATEGORY');
});
