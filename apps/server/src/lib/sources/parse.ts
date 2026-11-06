/**
 * 轻量 RSS/Atom/HTML 文本工具：不引入 XML 依赖，只用正则抽取，便于单测。
 * 全部为纯函数，不发起网络请求。
 */
import type { FetchLike, FetchOptions } from '../http';
import type { RawNewsItem } from './index';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function fromCode(code: number, fallback: string): string {
  return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : fallback;
}

export function decodeEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex: string) => fromCode(Number.parseInt(hex, 16), match))
    .replace(/&#(\d+);/g, (match, dec: string) => fromCode(Number(dec), match))
    .replace(/&([a-zA-Z]+);/g, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

export function stripTags(input: string): string {
  const withoutCdata = input.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return decodeEntities(withoutCdata.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function truncate(input: string, maxLength = 2000): string {
  return input.length <= maxLength ? input : input.slice(0, maxLength);
}

/** 取第一个 `<tag>` 块的原始内容（CDATA 保留，交由 stripTags 处理）。 */
export function firstTag(block: string, tag: string): string {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  return match?.[1]?.trim() ?? '';
}

/** 按标签切分成多个块，用于 RSS `<item>` / Atom `<entry>`。 */
export function splitBlocks(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  return [...xml.matchAll(pattern)].map((match) => match[1] ?? '');
}

export function toIsoDate(input: string | undefined, fallback: Date): string {
  const raw = input?.trim();
  if (!raw) return fallback.toISOString();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? fallback.toISOString() : parsed.toISOString();
}

export function resolveUrl(candidate: string, base: string): string | null {
  const raw = candidate.trim();
  if (!raw) return null;
  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}

/** 统一按发布时间倒序，保证接口与前端「时间倒序」口径一致。 */
export function sortByPublishedAtDesc(items: readonly RawNewsItem[]): RawNewsItem[] {
  return [...items].sort((a, b) =>
    a.publishedAt === b.publishedAt ? 0 : a.publishedAt < b.publishedAt ? 1 : -1,
  );
}

export interface FetchOptionSource {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  retries?: number;
}

/** 只挑出显式传入的字段，避免把 undefined 透传给 fetch 选项。 */
export function toFetchOptions(source: FetchOptionSource, headers?: Record<string, string>): FetchOptions {
  const options: FetchOptions = {};
  if (source.fetchImpl) options.fetchImpl = source.fetchImpl;
  if (source.timeoutMs !== undefined) options.timeoutMs = source.timeoutMs;
  if (source.retries !== undefined) options.retries = source.retries;
  if (headers) options.headers = headers;
  return options;
}
