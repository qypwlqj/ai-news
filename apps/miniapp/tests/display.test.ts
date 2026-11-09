import { expect, it } from 'vitest';
import type { NewsItem } from '@ai-news/contracts';
import { isNewsItem, newsDisplay } from '../src/domain/news';

const base: NewsItem = {
  id: 'n1',
  title: 'OpenAI ships a new model',
  url: 'https://news.ycombinator.com/item?id=1',
  source: 'hacker_news',
  publishedAt: '2026-11-09T00:00:00.000Z',
  summary: '摘要',
  summaryStatus: 'ok',
  category: 'model_release',
};

it('accepts old and new API shapes, rejects malformed display fields', () => {
  expect(isNewsItem(base)).toBe(true);
  expect(
    isNewsItem({
      ...base,
      originalTitle: null,
      excerpt: null,
      rawExcerpt: null,
      author: null,
    }),
  ).toBe(true);
  expect(
    isNewsItem({
      ...base,
      originalTitle: 'Orig',
      excerpt: 'e',
      author: { name: 'Sam', handle: 'sama' },
    }),
  ).toBe(true);
  expect(isNewsItem({ ...base, originalTitle: 1 })).toBe(false);
  expect(isNewsItem({ ...base, excerpt: {} })).toBe(false);
  expect(isNewsItem({ ...base, author: { handle: 'x' } })).toBe(false);
});

it('old rows show only title + summary: no subtitle, no excerpt, no author', () => {
  const view = newsDisplay(base);
  expect(view.title).toBe('OpenAI ships a new model');
  expect(view.subtitle).toBeNull();
  expect(view.excerpt).toBeNull();
  expect(view.author).toBeNull();
});

it('shows original title as subtitle only when it differs', () => {
  expect(
    newsDisplay({
      ...base,
      title: '新模型发布',
      originalTitle: 'OpenAI ships a new model',
    }).subtitle,
  ).toBe('OpenAI ships a new model');
  expect(
    newsDisplay({ ...base, originalTitle: ' OpenAI ships a new model ' })
      .subtitle,
  ).toBeNull();
});

it('prefers the full rawExcerpt in detail, falls back to list excerpt, hides blanks', () => {
  expect(
    newsDisplay({ ...base, rawExcerpt: 'full text', excerpt: 'full…' }).excerpt,
  ).toBe('full text');
  expect(newsDisplay({ ...base, excerpt: 'short…' }).excerpt).toBe('short…');
  expect(
    newsDisplay({ ...base, rawExcerpt: '   ', excerpt: '' }).excerpt,
  ).toBeNull();
});

it('formats X authors with handle', () => {
  expect(
    newsDisplay({
      ...base,
      source: 'x',
      author: { name: 'Sam Altman', handle: 'sama' },
    }).author,
  ).toBe('Sam Altman @sama');
  expect(
    newsDisplay({ ...base, author: { name: 'Lab', handle: null } }).author,
  ).toBe('Lab');
});
