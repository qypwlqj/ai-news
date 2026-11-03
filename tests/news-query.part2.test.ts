import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORY_DICTIONARY,
  CATEGORY_VALUES,
  categoryLabel,
  isCategoryValue,
} from '../src/app/news-api-types';
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  buildPageMeta,
  parseNewsListQuery,
  serializeNewsList,
} from '../src/app/news-query';

test('分类字典固定 5 项且顺序稳定', () => {
  assert.deepEqual(CATEGORY_VALUES, [
    'model_release',
    'research_paper',
    'product_application',
    'industry_news',
    'policy_funding',
  ]);
  assert.equal(CATEGORY_DICTIONARY.length, 5);
  assert.deepEqual(
    CATEGORY_DICTIONARY.map((item) => item.order),
    [1, 2, 3, 4, 5],
  );
  assert.equal(categoryLabel('research_paper'), '研究论文');
});

test('未知分类降级为原值文本，不泄漏原型链属性', () => {
  assert.equal(isCategoryValue('constructor'), false);
  assert.equal(categoryLabel('constructor'), 'constructor');
  assert.equal(typeof categoryLabel('__proto__'), 'string');
  assert.equal(categoryLabel('other'), 'other');
});

test('非法参数返回稳定错误码，不静默忽略', () => {
  const date = parseNewsListQuery({ date: '2025/06/01' });
  assert.equal(date.ok, false);
  assert.equal(date.ok === false ? date.code : null, 'INVALID_DATE');

  const category = parseNewsListQuery({ category: 'unknown' });
  assert.equal(category.ok, false);
  assert.equal(category.ok === false ? category.code : null, 'INVALID_CATEGORY');

  const source = parseNewsListQuery({ source: 'weibo' });
  assert.equal(source.ok, false);
  assert.equal(source.ok === false ? source.code : null, 'INVALID_SOURCE');

  for (const bad of [{ page: '0' }, { limit: '101' }, { limit: 'abc' }, { page: '-1' }]) {
    const result = parseNewsListQuery(bad);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false ? result.code : null, 'INVALID_PAGINATION');
  }
});

test('默认 limit=20，日期换算为 Asia/Shanghai 自然日的 UTC 半开区间', () => {
  assert.equal(DEFAULT_PAGE_LIMIT, 20);
  assert.equal(MAX_PAGE_LIMIT, 100);

  const result = parseNewsListQuery({ date: '2025-06-01' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.query.page, 1);
  assert.equal(result.query.limit, DEFAULT_PAGE_LIMIT);
  assert.equal(result.query.date, '2025-06-01');
  assert.equal(result.query.startUtc?.toISOString(), '2025-05-31T16:00:00.000Z');
  assert.equal(result.query.endUtc?.toISOString(), '2025-06-01T16:00:00.000Z');

  const empty = parseNewsListQuery({});
  assert.equal(empty.ok, true);
  if (!empty.ok) return;
  assert.equal(empty.query.date, null);
  assert.equal(empty.query.startUtc, null);
  assert.equal(empty.query.endUtc, null);
  assert.equal(empty.query.limit, DEFAULT_PAGE_LIMIT);
});

test('分页元数据与 page/limit 保持一致', () => {
  assert.deepEqual(buildPageMeta(45, 1, 20), { totalPages: 3, hasNext: true });
  assert.deepEqual(buildPageMeta(45, 3, 20), { totalPages: 3, hasNext: false });
});

test('summaryStatus=failed 的条目照常返回，summary 降级为 null', () => {
  const body = serializeNewsList({
    items: [
      {
        id: 'a',
        title: '标题',
        url: 'https://example.com/a',
        source: 'hacker_news',
        publishedAt: '2025-06-01T00:00:00.000Z',
        summary: '不应输出',
        summaryStatus: 'failed',
        category: 'industry_news',
      },
    ],
    total: 1,
    page: 1,
    limit: DEFAULT_PAGE_LIMIT,
    date: '2025-06-01',
  });

  const items = body.items as Array<Record<string, unknown>>;
  assert.equal(items.length, 1);
  assert.equal(items[0].summary, null);
  assert.equal(items[0].summaryStatus, 'failed');
  assert.equal(body.date, '2025-06-01');
  assert.equal(body.limit, 20);
  assert.deepEqual(Object.keys(items[0]).sort(), [
    'category',
    'createdAt',
    'id',
    'publishedAt',
    'source',
    'summary',
    'summaryStatus',
    'title',
    'url',
  ]);
});
