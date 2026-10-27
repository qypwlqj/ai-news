/**
 * 去重纯函数：URL 归一化（硬去重键）、标题指纹（候选收窄）、
 * 标题相似度（字符二元组 Dice 系数，> 0.9 判为软重复）。无 IO。
 */

import { TITLE_SIMILARITY_THRESHOLD } from './news-constants';

const TRACKING_PARAM_PATTERN =
  /^(utm_[a-z0-9_]*|fbclid|gclid|dclid|msclkid|yclid|ref|ref_src|ref_url|referrer|spm|mc_cid|mc_eid|igshid|_hsenc|_hsmi)$/;

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function stripTrailingSlash(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/**
 * URL 归一化：协议与主机小写、去追踪参数、去 fragment、去尾斜杠、查询参数按键排序。
 * 非 http(s) 或无法解析时返回空串（调用方视为无效条目）。
 */
export function normalizeUrl(rawUrl: string): string {
  const raw = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (raw === '') return '';

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return '';
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') return '';

  const entries = [...parsed.searchParams.entries()].filter(
    ([key]) => !TRACKING_PARAM_PATTERN.test(key.toLowerCase()),
  );
  entries.sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
    if (leftValue === rightValue) return 0;
    return leftValue < rightValue ? -1 : 1;
  });

  const search = new URLSearchParams();
  for (const [key, value] of entries) search.append(key, value);
  const query = search.toString();

  return `${protocol}//${parsed.host.toLowerCase()}${stripTrailingSlash(parsed.pathname)}${
    query ? `?${query}` : ''
  }`;
}

/** 标题归一化：NFKC + 小写 + 去标点与符号 + 空白归一。 */
export function normalizeTitle(title: string): string {
  const raw = typeof title === 'string' ? title : '';
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 标题指纹（FNV-1a 32 位，8 位十六进制），仅用于收窄候选，不建唯一约束。 */
export function titleFingerprint(title: string): string {
  const normalized = normalizeTitle(title);
  let hash = FNV_OFFSET_BASIS;
  for (const char of normalized) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function bigramCounts(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  const chars = [...value];
  for (let index = 0; index < chars.length - 1; index += 1) {
    const gram = chars[index] + chars[index + 1];
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

/** 标题相似度：字符二元组 Dice 系数，取值 0–1。 */
export function titleSimilarity(left: string, right: string): number {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  if (a === b) return a === '' ? 0 : 1;

  const aCounts = bigramCounts(a);
  const bCounts = bigramCounts(b);
  let aTotal = 0;
  for (const count of aCounts.values()) aTotal += count;
  let bTotal = 0;
  for (const count of bCounts.values()) bTotal += count;
  if (aTotal === 0 || bTotal === 0) return 0;

  let overlap = 0;
  for (const [gram, count] of aCounts) {
    overlap += Math.min(count, bCounts.get(gram) ?? 0);
  }
  return (2 * overlap) / (aTotal + bTotal);
}

/** 标题相似度严格大于 0.9 判为重复。 */
export function isSimilarTitle(left: string, right: string): boolean {
  return titleSimilarity(left, right) > TITLE_SIMILARITY_THRESHOLD;
}

/** 候选与既有条目是否重复：URL 归一化相等（硬）或标题相似度 > 0.9（软）。 */
export function isDuplicateOf(
  candidate: { url: string; title: string },
  existing: { url: string; title: string },
): boolean {
  const candidateUrl = normalizeUrl(candidate.url);
  const existingUrl = normalizeUrl(existing.url);
  if (candidateUrl !== '' && candidateUrl === existingUrl) return true;
  return isSimilarTitle(candidate.title, existing.title);
}
