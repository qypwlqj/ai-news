import { fetchText } from '../http';
import type { RawNewsItem, SourceFetchOptions } from './index';
import {
  firstTag,
  resolveUrl,
  sortByPublishedAtDesc,
  splitBlocks,
  stripTags,
  toFetchOptions,
  toIsoDate,
  truncate,
} from './parse';

/** feed 地址在需求中未给出具体值，作为可配置项集中在此常量与调用参数上。 */
export const JIQIZHIXIN_FEED_URL = 'https://www.jiqizhixin.com/rss';
export const JIQIZHIXIN_BASE_URL = 'https://www.jiqizhixin.com';

export interface JiqizhixinFetchOptions extends SourceFetchOptions {
  /** 覆盖默认 feed 地址 */
  feedUrl?: string;
  /** 相对链接解析基准，默认站点域名 */
  baseUrl?: string;
}

export function parseJiqizhixinFeed(
  xml: string,
  options: JiqizhixinFetchOptions = {},
): RawNewsItem[] {
  const limit = options.limit ?? 60;
  const now = options.now ?? new Date();
  const baseUrl = options.baseUrl ?? JIQIZHIXIN_BASE_URL;
  const items: RawNewsItem[] = [];

  for (const item of splitBlocks(xml, 'item')) {
    const title = stripTags(firstTag(item, 'title'));
    const link = resolveUrl(stripTags(firstTag(item, 'link')), baseUrl);
    if (!title || !link) continue;
    const guid = stripTags(firstTag(item, 'guid'));
    const excerpt =
      stripTags(firstTag(item, 'description')) || stripTags(firstTag(item, 'content:encoded'));
    const published =
      stripTags(firstTag(item, 'pubDate')) || stripTags(firstTag(item, 'dc:date'));
    items.push({
      source: 'jiqizhixin',
      externalId: guid || link,
      title,
      url: link,
      publishedAt: toIsoDate(published, now),
      excerpt: excerpt ? truncate(excerpt) : null,
    });
  }
  return sortByPublishedAtDesc(items).slice(0, limit);
}

export async function fetchJiqizhixin(
  options: JiqizhixinFetchOptions = {},
): Promise<RawNewsItem[]> {
  const feedUrl = options.feedUrl ?? JIQIZHIXIN_FEED_URL;
  const xml = await fetchText(
    feedUrl,
    toFetchOptions(options, { accept: 'application/rss+xml, application/xml;q=0.9' }),
  );
  return parseJiqizhixinFeed(xml, options);
}
