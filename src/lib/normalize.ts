/**
 * 规范化与判重的纯函数工具（无 I/O、无外部依赖）。
 * 规则见 docs/spec.md：URL 去追踪参数 / 片段 / 尾斜杠并统一大小写；标题按 NFKC + 小写 + 去标点归一。
 */

/** 标题相似度阈值，比较严格大于（PRD：相似度 > 0.9 判重）。 */
export const TITLE_SIMILARITY_THRESHOLD = 0.9;

const TRACKING_PARAM_PATTERNS: readonly RegExp[] = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^yclid$/i,
  /^msclkid$/i,
  /^mc_cid$/i,
  /^mc_eid$/i,
  /^_hsenc$/i,
  /^_hsmi$/i,
  /^igshid$/i,
  /^share_token$/i,
  /^spm$/i,
  /^ref$/i,
  /^ref_src$/i,
];

function isTrackingParam(key: string): boolean {
  return TRACKING_PARAM_PATTERNS.some((pattern) => pattern.test(key));
}

/** 规范化 URL，作为 normalized_url 唯一索引的键；无法解析时退化为去空白后的小写串。 */
export function normalizeUrl(raw: string | null | undefined): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return '';
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed.toLowerCase();
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') return trimmed;
  const host = parsed.hostname.toLowerCase();
  const defaultPort = protocol === 'http:' ? '80' : '443';
  const port = parsed.port && parsed.port !== defaultPort ? `:${parsed.port}` : '';
  const path = parsed.pathname.replace(/\/+$/, '');
  const params = [...parsed.searchParams.entries()]
    .filter(([key]) => !isTrackingParam(key))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const query = params.length
    ? `?${params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`
    : '';
  return `${protocol}//${host}${port}${path}${query}`;
}

/** 标题归一化：全半角统一、小写、标点符号替换为空格、空白折叠。 */
export function normalizeTitle(raw: string | null | undefined): string {
  const value = typeof raw === 'string' ? raw : '';
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** FNV-1a 32 位哈希（十六进制）：仅用于近重复候选检索，不建唯一约束。 */
export function titleFingerprint(raw: string | null | undefined): string {
  const normalized = normalizeTitle(raw);
  if (!normalized) return '';
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function bigrams(value: string): string[] {
  const compact = value.replace(/\s+/gu, '');
  if (!compact) return [];
  if (compact.length === 1) return [compact];
  const grams: string[] = [];
  for (let index = 0; index < compact.length - 1; index += 1) grams.push(compact.slice(index, index + 2));
  return grams;
}

/** 字符二元组 Dice 系数，取值 0–1；相同标题为 1，任一侧为空为 0。 */
export function titleSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftGrams = bigrams(left);
  const rightGrams = bigrams(right);
  if (leftGrams.length === 0 || rightGrams.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const gram of leftGrams) counts.set(gram, (counts.get(gram) ?? 0) + 1);
  let overlap = 0;
  for (const gram of rightGrams) {
    const remaining = counts.get(gram) ?? 0;
    if (remaining > 0) {
      overlap += 1;
      counts.set(gram, remaining - 1);
    }
  }
  return (2 * overlap) / (leftGrams.length + rightGrams.length);
}

export function isSimilarTitle(
  a: string | null | undefined,
  b: string | null | undefined,
  threshold: number = TITLE_SIMILARITY_THRESHOLD,
): boolean {
  return titleSimilarity(a, b) > threshold;
}
