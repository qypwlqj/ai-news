import { createHash, randomUUID } from 'node:crypto';
import { normalizeUrl, titleFingerprint } from './dedup';
import type { NewsRepository } from './db/repository';
import type { Category, NewsItemRecord } from './types';
import { isCategory } from './types';

export const X_INGEST_MAX_BATCH = 50;
export const X_TITLE_MAX = 500;
export const X_TEXT_MAX = 4000;
export const X_SUMMARY_MAX = 500;
export const X_HANDLE_MAX = 64;
export const X_DISPLAY_NAME_MAX = 128;

export const X_ALLOWED_HOSTS = new Set([
  'x.com',
  'www.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
  'mobile.x.com',
]);

export interface XIngestItemInput {
  postId: string;
  url: string;
  authorHandle: string;
  authorDisplayName: string;
  publishedAt: string;
  text: string;
  summary: string;
  category: Category;
  title?: string;
}

export interface XIngestDocument {
  items: XIngestItemInput[];
}

export interface XIngestReceipt {
  inserted: number;
  skipped: number;
  errors: Array<{ postId?: string; message: string }>;
}

function asNonEmptyString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required`);
  if ([...trimmed].length > max) throw new Error(`${field} exceeds ${max} characters`);
  return trimmed;
}

function assertXUrl(url: string, postId: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('url is invalid');
  }
  if (parsed.protocol !== 'https:') throw new Error('url must use https');
  const host = parsed.hostname.toLowerCase();
  if (!X_ALLOWED_HOSTS.has(host)) throw new Error(`url host not allowed: ${host}`);
  const path = parsed.pathname;
  // Require /{handle}/status/{id} shape and matching post id.
  const match = /^\/([^/]+)\/status\/(\d+)\/?$/.exec(path);
  if (!match) throw new Error('url must be an X status URL');
  if (match[2] !== postId) throw new Error('url status id must match postId');
  return parsed;
}

function parsePublishedAt(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('publishedAt must be ISO-8601');
  return date;
}

export function parseXIngestDocument(raw: unknown): XIngestDocument {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('document must be a JSON object');
  }
  const itemsRaw = (raw as { items?: unknown }).items;
  if (!Array.isArray(itemsRaw)) throw new Error('items must be an array');
  if (itemsRaw.length === 0) throw new Error('items must not be empty');
  if (itemsRaw.length > X_INGEST_MAX_BATCH) {
    throw new Error(`batch exceeds max size ${X_INGEST_MAX_BATCH}`);
  }
  const items = itemsRaw.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`items[${index}] must be an object`);
    }
    const row = entry as Record<string, unknown>;
    const postId = asNonEmptyString(row.postId, 'postId', 64);
    if (!/^\d+$/.test(postId)) throw new Error('postId must be digits');
    const url = asNonEmptyString(row.url, 'url', 500);
    assertXUrl(url, postId);
    const authorHandle = asNonEmptyString(row.authorHandle, 'authorHandle', X_HANDLE_MAX).replace(/^@/, '');
    const authorDisplayName = asNonEmptyString(
      row.authorDisplayName,
      'authorDisplayName',
      X_DISPLAY_NAME_MAX,
    );
    const publishedAt = asNonEmptyString(row.publishedAt, 'publishedAt', 64);
    parsePublishedAt(publishedAt);
    const text = asNonEmptyString(row.text, 'text', X_TEXT_MAX);
    const summary = asNonEmptyString(row.summary, 'summary', X_SUMMARY_MAX);
    const categoryRaw = asNonEmptyString(row.category, 'category', 64);
    if (!isCategory(categoryRaw)) throw new Error(`category is invalid: ${categoryRaw}`);
    const title =
      row.title === undefined || row.title === null
        ? undefined
        : asNonEmptyString(row.title, 'title', X_TITLE_MAX);
    return {
      postId,
      url,
      authorHandle,
      authorDisplayName,
      publishedAt,
      text,
      summary,
      category: categoryRaw,
      ...(title ? { title } : {}),
    } satisfies XIngestItemInput;
  });
  return { items };
}

/** Deterministic category from candidate topics only; never invents missing topics. */
export function categoryFromTopics(topics: unknown): Category {
  if (!Array.isArray(topics)) return 'industry_news';
  const normalized = topics
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.toLowerCase());
  if (normalized.some((t) => t.includes('model'))) return 'model_release';
  if (normalized.some((t) => t.includes('research') || t.includes('paper'))) return 'research_paper';
  if (normalized.some((t) => t.includes('product') || t.includes('api') || t.includes('image')))
    return 'product_application';
  if (normalized.some((t) => t.includes('policy') || t.includes('fund'))) return 'policy_funding';
  return 'industry_news';
}

/**
 * Map parent candidate feed (snake_case, not a deploy contract) into the stable ingest document.
 * Only copies existing fields; does not fabricate author/url/post ids.
 */
export function mapCandidateFeedToIngestDocument(raw: unknown): XIngestDocument {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('candidate feed must be an object');
  }
  const itemsRaw = (raw as { items?: unknown }).items;
  if (!Array.isArray(itemsRaw)) throw new Error('candidate feed items must be an array');
  const mapped = itemsRaw.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`candidate items[${index}] must be an object`);
    }
    const row = entry as Record<string, unknown>;
    const author = row.author;
    if (!author || typeof author !== 'object' || Array.isArray(author)) {
      throw new Error(`candidate items[${index}].author is required`);
    }
    const authorRec = author as Record<string, unknown>;
    return {
      postId: row.post_id,
      url: row.url,
      authorHandle: authorRec.handle,
      authorDisplayName: authorRec.name,
      publishedAt: row.published_at,
      text: row.original_text,
      summary: row.summary_zh,
      title: row.title_zh,
      category: categoryFromTopics(row.topics),
    };
  });
  return parseXIngestDocument({ items: mapped });
}

function stableId(postId: string): string {
  return `x_${createHash('sha256').update(postId).digest('hex').slice(0, 24)}`;
}

export async function ingestXBatch(
  repository: NewsRepository,
  items: readonly XIngestItemInput[],
): Promise<XIngestReceipt> {
  let inserted = 0;
  let skipped = 0;
  const errors: XIngestReceipt['errors'] = [];
  for (const item of items) {
    try {
      const publishedAt = parsePublishedAt(item.publishedAt);
      const title = item.title?.trim() || item.text.slice(0, 120);
      const record: NewsItemRecord = {
        id: stableId(item.postId),
        title,
        url: item.url,
        normalizedUrl: normalizeUrl(item.url),
        titleFingerprint: titleFingerprint(title),
        source: 'x',
        externalId: item.postId,
        publishedAt,
        summary: item.summary,
        summaryStatus: 'ok',
        category: item.category,
        rawExcerpt: item.text,
        metadata: {
          authorHandle: item.authorHandle,
          authorDisplayName: item.authorDisplayName,
        },
      };
      const result = await repository.insertNews(record);
      if (result.inserted) inserted += 1;
      else skipped += 1;
    } catch (error) {
      errors.push({
        postId: item.postId,
        message: error instanceof Error ? error.message : 'ingest failed',
      });
    }
  }
  return { inserted, skipped, errors };
}

export function newRequestId(): string {
  return randomUUID();
}
