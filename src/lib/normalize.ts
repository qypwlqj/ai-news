/**
 * URL 与标题规范化（纯函数：无 IO、不读环境变量、不发网络请求）。
 * 规则见 docs/spec.md §3 与 docs/news-primitives.md。
 */

/** 标题相似度阈值：严格大于该值判为重复。 */
export const TITLE_SIMILARITY_THRESHOLD = 0.9;

const TRACKING_QUERY_KEYS = new Set([
  'fbclid',
  'gclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  'spm',
  'yclid',
]);

/** 是否为追踪参数：`utm_*` 前缀或固定名单。 */
export function isTrackingQueryKey(key: string): boolean {
  const lower = typeof key === 'string' ? key.trim().toLowerCase() : '';
  if (!lower) return false;
  return lower.startsWith('utm_') || TRACKING_QUERY_KEYS.has(lower);
}

/**
 * URL 规范化：
 * - 仅接受 http/https，其它协议或无法解析的地址返回空串；
 * - 协议与主机小写、去掉默认端口；
 * - 丢弃 `utm_*`/`fbclid`/`gclid`/`ref` 等追踪参数与 `#fragment`；
 * - 查询参数按键、值排序；
 * - 非根路径去掉尾斜杠，根路径保留 `/`。
 */
export function normalizeUrl(raw: string): string {
  const input = typeof raw === 'string' ? raw.trim() : '';
  if (!input) return '';

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return '';
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') return '';

  const host = parsed.hostname.toLowerCase();
  if (!host) return '';

  const port = parsed.port ? `:${parsed.port}` : '';

  let path = parsed.pathname || '/';
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1) path = path.replace(/\/+$/, '') || '/';

  const params = [...parsed.searchParams.entries()]
    .filter(([key]) => !isTrackingQueryKey(key))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
      if (leftValue === rightValue) return 0;
      return leftValue < rightValue ? -1 : 1;
    });

  const search = params.length
    ? `?${params
        .map(([key, value]) =>
          value === '' ? encodeURIComponent(key) : `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
        )
        .join('&')}`
    : '';

  return `${protocol}//${host}${port}${path}${search}`;
}

/** 标题归一化：NFKC + 小写 + 去标点符号 + 空白归一。 */
export function normalizeTitle(raw: string): string {
  const input = typeof raw === 'string' ? raw : '';
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 标题指纹：归一化标题的 FNV-1a 32 位哈希（8 位小写十六进制）。 */
export function titleFingerprint(raw: string): string {
  const text = normalizeTitle(raw);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function toBigrams(text: string): Map<string, number> {
  const grams = new Map<string, number>();
  for (let index = 0; index < text.length - 1; index += 1) {
    const gram = text.slice(index, index + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/** 标题相似度：归一化后字符二元组 Dice 系数（0..1，相同为 1）。 */
export function titleSimilarity(left: string, right: string): number {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const leftGrams = toBigrams(a);
  const rightGrams = toBigrams(b);
  let total = 0;
  let intersection = 0;
  for (const [gram, count] of leftGrams) {
    total += count;
    intersection += Math.min(count, rightGrams.get(gram) ?? 0);
  }
  for (const count of rightGrams.values()) total += count;

  return total === 0 ? 0 : (2 * intersection) / total;
}

/** 是否近似标题：相似度严格大于阈值（默认 0.9）。 */
export function isSimilarTitle(
  left: string,
  right: string,
  threshold: number = TITLE_SIMILARITY_THRESHOLD,
): boolean {
  return titleSimilarity(left, right) > threshold;
}
