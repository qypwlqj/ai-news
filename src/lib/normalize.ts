/**
 * URL / 标题归一化与标题相似度（纯函数：无 IO、不读环境变量、不发网络请求）。
 * 规则冻结于 docs/spec.md §3 与 docs/news-primitives.md，与 src/app/news-dedup.ts 保持一致：
 * - URL：仅接受 http/https，其它协议或无法解析的地址返回空串；协议与主机小写、去默认端口；
 *   丢弃 utm_* / fbclid / gclid / ref 等追踪参数与 #fragment；查询参数按键、值排序；
 *   非根路径去尾斜杠，根路径保留 `/`。
 * - 标题：NFKC + 小写 + 标点符号替换为空格 + 空白归一。
 * - 相似度：字符二元组 Dice 系数，严格大于 0.9 判为近似重复。
 */

export const TITLE_SIMILARITY_THRESHOLD = 0.9;

const TRACKING_PARAMS = new Set(['fbclid', 'gclid', 'igshid', 'mc_cid', 'mc_eid', 'ref']);
const TRACKING_PREFIXES = ['utm_'];

function isTrackingKey(key: string): boolean {
  const lower = key.toLowerCase();
  return TRACKING_PARAMS.has(lower) || TRACKING_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/** 规范化 URL；非 http(s) 协议、空值或无法解析的地址返回空串。 */
export function normalizeUrl(raw: string): string {
  if (typeof raw !== 'string') return '';
  const input = raw.trim();
  if (input.length === 0) return '';

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return '';
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') return '';

  const host = parsed.hostname.toLowerCase();
  if (host.length === 0) return '';

  const defaultPort = protocol === 'https:' ? '443' : '80';
  const port = parsed.port.toLowerCase();
  const authority = port !== '' && port !== defaultPort ? `${host}:${port}` : host;

  let path = parsed.pathname === '' ? '/' : parsed.pathname;
  if (path.length > 1) {
    path = path.replace(/\/+$/, '');
    if (path.length === 0) path = '/';
  }

  const pairs: Array<[string, string]> = [];
  parsed.searchParams.forEach((value, key) => {
    if (isTrackingKey(key)) return;
    pairs.push([key, value]);
  });
  pairs.sort((left, right) => {
    if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1;
    if (left[1] === right[1]) return 0;
    return left[1] < right[1] ? -1 : 1;
  });
  const query = pairs
    .map(([key, value]) =>
      value === '' ? encodeURIComponent(key) : `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join('&');

  return `${protocol}//${authority}${path}${query === '' ? '' : `?${query}`}`;
}

/** 标题归一化：NFKC + 小写 + 标点/符号替换为空格 + 空白归一。 */
export function normalizeTitle(raw: string): string {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** 标题指纹（FNV-1a 32 位）：仅用于收窄近 7 天窗口内的近似候选，不建唯一约束。 */
export function titleFingerprint(raw: string): string {
  const normalized = normalizeTitle(raw);
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function bigramCounts(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let index = 0; index + 1 < value.length; index += 1) {
    const gram = value.slice(index, index + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

/** 标题相似度：字符二元组 Dice 系数，取值 [0, 1]；仅标点差异为 1。 */
export function titleSimilarity(left: string, right: string): number {
  const a = normalizeTitle(left).replace(/\s+/g, '');
  const b = normalizeTitle(right).replace(/\s+/g, '');
  if (a.length === 0 || b.length === 0) return 0;
  if (a === b) return 1;

  const leftCounts = bigramCounts(a);
  const rightCounts = bigramCounts(b);
  let overlap = 0;
  let total = 0;
  leftCounts.forEach((count, gram) => {
    total += count;
    overlap += Math.min(count, rightCounts.get(gram) ?? 0);
  });
  rightCounts.forEach((count) => {
    total += count;
  });
  if (total === 0) return 0;
  return (2 * overlap) / total;
}

/** 是否判为近似重复：相似度严格大于 0.9。 */
export function isSimilarTitle(left: string, right: string): boolean {
  return titleSimilarity(left, right) > TITLE_SIMILARITY_THRESHOLD;
}
