import { expect, it } from 'vitest';
import {
  dateParts,
  normalizeFilters,
  parseNewsPage,
  queryString,
  safeOriginalUrl,
  summaryText,
} from '../src/domain/news';
import { demoNews, getDemoPage } from '../src/services/demo';

it('strictly normalizes deep-link filters and safely encodes keywords', () => {
  expect(
    normalizeFilters({
      category: 'invalid',
      source: '__proto__',
      date: '2026-02-30',
      q: '  AI & 模型  ',
    }),
  ).toEqual({ q: 'AI & 模型' });
  expect(queryString({ q: 'AI & 模型', source: undefined })).toBe(
    'q=AI%20%26%20%E6%A8%A1%E5%9E%8B',
  );
});
it('uses Beijing date boundaries without Intl', () => {
  expect(dateParts('2026-11-05T16:00:00Z')?.date).toBe('2026-11-06');
  expect(dateParts('2026-11-05T15:59:59Z')?.date).toBe('2026-11-05');
  expect(dateParts('invalid')).toBeNull();
});
it('keeps pending and failed summaries from exposing stale text', () => {
  expect(
    summaryText({ ...demoNews[0], summaryStatus: 'pending', summary: 'stale' }),
  ).toContain('正在生成');
  expect(
    summaryText({ ...demoNews[0], summaryStatus: 'failed', summary: 'stale' }),
  ).not.toContain('stale');
});
it('rejects unsupported original links and malformed API pages', () => {
  expect(safeOriginalUrl('javascript:alert(1)')).toBeNull();
  expect(safeOriginalUrl('https://example.com/\nfoo')).toBeNull();
  expect(safeOriginalUrl('https://example.com/news?q=ai')).toBe(
    'https://example.com/news?q=ai',
  );
  expect(() => parseNewsPage({ items: [null] })).toThrow();
  expect(parseNewsPage(getDemoPage({})).total).toBe(12);
});
it('combines example keyword, category, source and date filters before pagination', () => {
  const result = getDemoPage({
    q: '模型',
    category: 'research_paper',
    source: 'arxiv_cs_ai',
    date: '2026-11-06',
    limit: 1,
  });
  expect(result.total).toBeGreaterThan(1);
  expect(result.items).toHaveLength(1);
  expect(result.hasNext).toBe(true);
  expect(getDemoPage({ date: '2025-01-01' }).total).toBe(0);
});
