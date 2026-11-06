import {
  CATEGORIES,
  SOURCE_VALUES,
  type NewsFilters,
  type NewsItem,
  type NewsPage,
} from '@ai-news/contracts';

/** An untrusted API response is checked before it reaches the UI. */
export function isNewsItem(value: unknown): value is NewsItem {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    [
      'id',
      'title',
      'url',
      'source',
      'publishedAt',
      'category',
      'summaryStatus',
    ].every((key) => typeof row[key] === 'string') &&
    (row.summary === null || typeof row.summary === 'string')
  );
}

export function parseNewsPage(value: unknown): NewsPage {
  if (!value || typeof value !== 'object')
    throw new Error('资讯数据暂时无法读取');
  const page = value as NewsPage;
  if (
    !Array.isArray(page.items) ||
    !page.items.every(isNewsItem) ||
    !Number.isInteger(page.total) ||
    page.total < 0 ||
    !Number.isInteger(page.page) ||
    page.page < 1 ||
    !Number.isInteger(page.limit) ||
    page.limit < 1 ||
    !Number.isInteger(page.totalPages) ||
    page.totalPages < 1 ||
    typeof page.hasNext !== 'boolean'
  )
    throw new Error('资讯数据暂时无法读取');
  return page;
}

export function normalizeFilters(input: Record<string, unknown>): NewsFilters {
  const filters: NewsFilters = {};
  if (CATEGORIES.some((item) => item.value === input.category))
    filters.category = input.category as NewsFilters['category'];
  if (SOURCE_VALUES.some((source) => source === input.source))
    filters.source = input.source as NewsFilters['source'];
  if (typeof input.q === 'string' && input.q.trim())
    filters.q = input.q.trim().slice(0, 120);
  if (
    typeof input.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(input.date)
  ) {
    const date = new Date(`${input.date}T00:00:00Z`);
    if (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === input.date
    )
      filters.date = input.date;
  }
  return filters;
}

export function queryString(query: Record<string, unknown>): string {
  return Object.entries(query)
    .filter(
      ([, value]) => value !== undefined && value !== null && value !== '',
    )
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    )
    .join('&');
}

export function safeOriginalUrl(value: string): string | null {
  // URL is not a guaranteed global in the mini-program JS runtime.
  if (
    !/^https?:\/\/[^\s/?#]+(?:[/?#][^\s]*)?$/i.test(value) ||
    /[\u0000-\u001f\\]/.test(value)
  )
    return null;
  return value;
}

export function summaryText(item: NewsItem): string {
  if (item.summaryStatus === 'pending') return '摘要正在生成，稍后再来看看。';
  if (item.summaryStatus === 'failed' || !item.summary?.trim())
    return '摘要暂不可用，你仍然可以复制原文链接阅读全文。';
  return item.summary;
}

/** Beijing time, without relying on Intl support in older WeChat base libraries. */
export function dateParts(
  value: string | number | Date,
): {
  date: string;
  time: string;
  month: string;
  day: string;
  weekday: string;
} | null {
  const at = new Date(value).getTime();
  if (!Number.isFinite(at)) return null;
  const local = new Date(at + 8 * 60 * 60 * 1000);
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');
  return {
    date: `${local.getUTCFullYear()}-${month}-${day}`,
    month,
    day,
    time: `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`,
    weekday: ['日', '一', '二', '三', '四', '五', '六'][local.getUTCDay()],
  };
}
