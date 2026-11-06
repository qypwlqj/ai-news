import { expect, it, vi } from 'vitest';
import { NewsFeed } from '../src/domain/feed';
import { demoNews, getDemoPage } from '../src/services/demo';
import type { NewsPage } from '@ai-news/contracts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it('ignores a previous category response that arrives after the new category', async () => {
  const old = deferred<NewsPage>();
  const current = deferred<NewsPage>();
  const request = vi
    .fn()
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);
  const feed = new NewsFeed(request);
  const first = feed.setFilters({ category: 'model_release' });
  const second = feed.setFilters({ category: 'research_paper' });
  current.resolve(getDemoPage({ category: 'research_paper' }));
  await second;
  old.resolve(getDemoPage({ category: 'model_release' }));
  await first;
  expect(
    feed
      .getSnapshot()
      .items.every((item) => item.category === 'research_paper'),
  ).toBe(true);
});

it('retains old results when refresh fails and can recover', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(getDemoPage({}))
    .mockRejectedValueOnce(new Error('离线'))
    .mockResolvedValueOnce(getDemoPage({}));
  const feed = new NewsFeed(request);
  await feed.refresh();
  await feed.refresh();
  expect(feed.getSnapshot().items.length).toBeGreaterThan(0);
  expect(feed.getSnapshot().error).toBe('离线');
  await feed.refresh();
  expect(feed.getSnapshot().error).toBe('');
  expect(feed.getSnapshot().phase).toBe('ready');
});

it('prevents duplicate bottom events and keeps filters when loading the next page', async () => {
  const next = deferred<NewsPage>();
  const request = vi
    .fn()
    .mockResolvedValueOnce(getDemoPage({ source: 'hacker_news', limit: 2 }))
    .mockReturnValue(next.promise);
  const feed = new NewsFeed(request, 2);
  await feed.setFilters({ source: 'hacker_news' });
  const more = feed.loadMore();
  await feed.loadMore();
  expect(request).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenLastCalledWith({
    source: 'hacker_news',
    page: 2,
    limit: 2,
  });
  next.resolve(getDemoPage({ source: 'hacker_news', page: 2, limit: 2 }));
  await more;
  expect(feed.getSnapshot().items).toHaveLength(4);
});

it('refresh invalidates a pending pagination response', async () => {
  const next = deferred<NewsPage>();
  const page = getDemoPage({ limit: 2 });
  const request = vi
    .fn()
    .mockResolvedValueOnce(page)
    .mockReturnValueOnce(next.promise)
    .mockResolvedValueOnce(page);
  const feed = new NewsFeed(request, 2);
  await feed.refresh();
  const more = feed.loadMore();
  await feed.refresh();
  next.resolve(getDemoPage({ page: 2, limit: 2 }));
  await more;
  expect(feed.getSnapshot().items).toHaveLength(2);
  expect(feed.getSnapshot().page).toBe(1);
});

it('failed pagination leaves the page number intact, supports retry, and deduplicates ids', async () => {
  const first = getDemoPage({ limit: 2 });
  const request = vi
    .fn()
    .mockResolvedValueOnce(first)
    .mockRejectedValueOnce(new Error('timeout'))
    .mockResolvedValueOnce({
      ...first,
      page: 2,
      items: [demoNews[1], demoNews[2]],
      hasNext: false,
    });
  const feed = new NewsFeed(request, 2);
  await feed.refresh();
  await feed.loadMore();
  expect(feed.getSnapshot().page).toBe(1);
  await feed.loadMore();
  expect(feed.getSnapshot().items).toHaveLength(3);
  expect(feed.getSnapshot().page).toBe(2);
  expect(feed.getSnapshot().hasNext).toBe(false);
});

it('dispose invalidates requests from unmounted pages', async () => {
  const request = deferred<NewsPage>();
  const feed = new NewsFeed(() => request.promise);
  const work = feed.refresh();
  feed.dispose();
  request.resolve(getDemoPage({}));
  await work;
  expect(feed.getSnapshot().items).toEqual([]);
});
