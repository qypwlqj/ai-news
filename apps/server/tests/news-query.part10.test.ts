import { describe, expect, it } from 'vitest';
import {
  buildPageMeta,
  parseNewsListQuery,
  parsePaging,
  readQueryParam,
  serializeNewsItem,
  serializeNewsList,
} from '../src/app/news-query';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    title: '示例标题',
    url: 'https://example.com/a',
    source: 'hacker_news',
    publishedAt: '2025-06-01T00:00:00.000Z',
    summary: '中文摘要'.repeat(10),
    summaryStatus: 'ok',
    category: 'model_release',
    ...overrides,
  };
}

describe('parseNewsListQuery', () => {
  it('缺省参数：page=1、limit=20、不做日期/分类/来源过滤', () => {
    const parsed = parseNewsListQuery({});
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.query).toMatchObject({
      page: 1,
      limit: 20,
      date: null,
      startUtc: null,
      endUtc: null,
      category: null,
      source: null,
    });
  });

  it('date 按 Asia/Shanghai 自然日换算为 UTC 半开区间', () => {
    const parsed = parseNewsListQuery(
      new URLSearchParams('date=2025-06-01&category=model_release&source=arxiv_cs_ai'),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.query.startUtc?.toISOString()).toBe('2025-05-31T16:00:00.000Z');
    expect(parsed.query.endUtc?.toISOString()).toBe('2025-06-01T16:00:00.000Z');
    expect(parsed.query.date).toBe('2025-06-01');
    expect(parsed.query.category).toBe('model_release');
    expect(parsed.query.source).toBe('arxiv_cs_ai');
  });

  it.each([
    ['date=2025-13-01', 'INVALID_DATE'],
    ['date=20250601', 'INVALID_DATE'],
    ['category=unknown', 'INVALID_CATEGORY'],
    ['source=unknown', 'INVALID_SOURCE'],
    ['page=0', 'INVALID_PAGINATION'],
    ['limit=101', 'INVALID_PAGINATION'],
    ['limit=abc', 'INVALID_PAGINATION'],
  ])('非法参数 %s → %s', (search, code) => {
    const parsed = parseNewsListQuery(new URLSearchParams(search));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.code).toBe(code);
  });
});

describe('parsePaging', () => {
  it('默认 limit=20、上限 100、page 从 1 起', () => {
    expect(parsePaging({})).toEqual({ page: 1, limit: 20 });
    expect(parsePaging({ page: '3', limit: '100' })).toEqual({ page: 3, limit: 100 });
    expect(parsePaging({ limit: '0' })).toBeNull();
    expect(parsePaging({ page: 'x' })).toBeNull();
  });
});

describe('readQueryParam', () => {
  it('数组取首值，空白视为缺省', () => {
    expect(readQueryParam({ category: ['model_release', 'x'] }, 'category')).toBe('model_release');
    expect(readQueryParam({ category: ['  ', 'model_release'] }, 'category')).toBeNull();
    expect(readQueryParam(new URLSearchParams('source=jiqizhixin'), 'source')).toBe('jiqizhixin');
  });
});

describe('serializeNewsItem / serializeNewsList', () => {
  it('summaryStatus=failed 的条目照常返回且 summary 为 null', () => {
    const item = serializeNewsItem(row({ summaryStatus: 'failed' }));
    expect(item.id).toBe('n1');
    expect(item.summary).toBeNull();
    expect(item.summaryStatus).toBe('failed');
  });

  it('字段齐全：id/title/url/source/publishedAt/summary/category', () => {
    const item = serializeNewsItem(row());
    for (const key of ['id', 'title', 'url', 'source', 'publishedAt', 'summary', 'category']) {
      expect(item).toHaveProperty(key);
    }
  });

  it('列表默认 20 条分页并计算 totalPages/hasNext', () => {
    const items = Array.from({ length: 20 }, (_, i) => row({ id: `n${i}` }));
    const body = serializeNewsList({ items, total: 42, page: 1, limit: 20, date: '2025-06-01' });
    expect(body.items).toHaveLength(20);
    expect(body).toMatchObject({
      page: 1,
      limit: 20,
      total: 42,
      totalPages: 3,
      hasNext: true,
      date: '2025-06-01',
    });
  });

  it('空结果是 200 语义的空数组，不是错误', () => {
    const body = serializeNewsList({ items: [], total: 0, page: 1, limit: 20, date: null });
    expect(body.items).toEqual([]);
    expect(body).toMatchObject({ totalPages: 0, hasNext: false, date: null });
  });

  it('buildPageMeta 边界：整除与空集', () => {
    expect(buildPageMeta(0, 1, 20)).toEqual({ totalPages: 0, hasNext: false });
    expect(buildPageMeta(40, 2, 20)).toEqual({ totalPages: 2, hasNext: false });
    expect(buildPageMeta(21, 2, 20)).toEqual({ totalPages: 2, hasNext: false });
  });
});
