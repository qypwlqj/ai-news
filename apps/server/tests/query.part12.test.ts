import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listNews } from '../src/lib/query';

interface ListValue {
  items: unknown[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  date: string | null;
}

function expectOk(result: unknown): ListValue {
  const typed = result as { ok: boolean; value: ListValue };
  assert.equal(typed.ok, true);
  return typed.value;
}

function expectCode(result: unknown): string {
  const typed = result as { ok: boolean; code?: string };
  assert.equal(typed.ok, false);
  return typed.code ?? '';
}

test('listNews 默认分页 limit=20 且分页字段齐全', async () => {
  const value = expectOk(await listNews(new URLSearchParams()));
  assert.equal(value.page, 1);
  assert.equal(value.limit, 20);
  assert.ok(Array.isArray(value.items));
  assert.equal(typeof value.total, 'number');
  assert.equal(typeof value.totalPages, 'number');
  assert.equal(typeof value.hasNext, 'boolean');
  assert.equal(value.date, null);
});

test('listNews 回显 date/page/limit 参数', async () => {
  const value = expectOk(
    await listNews(new URLSearchParams('date=2025-06-01&category=model_release&page=2&limit=5')),
  );
  assert.equal(value.page, 2);
  assert.equal(value.limit, 5);
  assert.equal(value.date, '2025-06-01');
});

test('listNews 非法参数返回稳定错误码，不静默忽略', async () => {
  assert.equal(expectCode(await listNews(new URLSearchParams('category=bad'))), 'INVALID_CATEGORY');
  assert.equal(expectCode(await listNews(new URLSearchParams('source=weibo'))), 'INVALID_SOURCE');
  assert.equal(expectCode(await listNews(new URLSearchParams('date=2025-13-01'))), 'INVALID_DATE');
  assert.equal(expectCode(await listNews(new URLSearchParams('page=0'))), 'INVALID_PAGINATION');
});
