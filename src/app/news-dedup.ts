/**
 * 去重纯函数：URL 规范化、标题归一化 / 指纹 / 相似度。
 * 无 IO、不读环境变量、不发网络请求，供采集入库、查询与页面共用。
 */

/** 标题软去重阈值：相似度**严格大于**该值才判为重复（对齐 docs/spec.md §3）。 */
export const TITLE_SIMILARITY_THRESHOLD = 0.9;

/** 追踪参数（另含 `utm_*` 前缀），URL 规范化时剔除，避免同一文章产生多条记录。 */
const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'yclid',
  'igshid',
  'ref',
  'ref_src',
  'referrer',
  'source',
  'spm',
  'si',
  'mc_cid',
  'mc_eid',
]);

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.startsWith('utm_') || TRACKING_PARAMS.has(lower);
}

/**
 * URL 规范化（硬去重键）：协议与主机小写、去 `#fragment`、去追踪参数、
 * 查询参数按键排序、去掉路径尾斜杠（尾斜杠在查询串之前也会被去掉）。
 * 非法或非 http(s) 输入原样返回（仅 trim），保证返回值稳定可比较。
 */
export function normalizeUrl(rawUrl: string): string {
  const input = (rawUrl ?? '').trim();
  if (!input) return '';

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return '';
  }

  const pairs = Array.from(parsed.searchParams.entries())
    .filter(([key]) => !isTrackingParam(key))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey),
    );
  const search =
    pairs.length === 0
      ? ''
      : `?${pairs
          .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
          .join('&')}`;

  let path = parsed.pathname;
  while (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  // 根路径保留 `/`（如 https://example.com → https://example.com/），只去掉非根路径尾斜杠。
  if (path === '') path = '/';

  const host = parsed.host.toLowerCase();
  const defaultPort =
    (parsed.protocol === 'http:' && parsed.port === '80') ||
    (parsed.protocol === 'https:' && parsed.port === '443');
  const port = parsed.port && !defaultPort ? `:${parsed.port}` : '';
  const auth = parsed.username
    ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ''}@`
    : '';

  return `${parsed.protocol}//${auth}${host}${port}${path}${search}`;
}

/** 标题归一化：NFKC + 小写 + 标点/符号转空格 + 空白归一 + 去首尾空白。 */
export function normalizeTitle(title: string): string {
  return (title ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 标题指纹（FNV-1a 32 位，8 位十六进制）：仅用于收窄相似度候选，不建唯一约束。 */
export function titleFingerprint(title: string): string {
  const normalized = normalizeTitle(title);
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function bigramCounts(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  const chars = Array.from(value);
  if (chars.length === 0) return counts;
  if (chars.length === 1) {
    counts.set(chars[0] as string, 1);
    return counts;
  }
  for (let index = 0; index + 1 < chars.length; index += 1) {
    const gram = `${chars[index] as string}${chars[index + 1] as string}`;
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

/**
 * 标题相似度（字符二元组 Dice 系数，取值 0–1）：
 * 归一化后完全相同为 1；仅标点/大小写差异亦为 1；任一侧为空为 0。
 */
export function titleSimilarity(left: string, right: string): number {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  // 空标题不视为重复（对齐入库去重语义）。
  if (!a || !b) return 0;
  if (a === b) return 1;

  const leftCounts = bigramCounts(a);
  const rightCounts = bigramCounts(b);
  let leftTotal = 0;
  let rightTotal = 0;
  let common = 0;
  leftCounts.forEach((count, gram) => {
    leftTotal += count;
    common += Math.min(count, rightCounts.get(gram) ?? 0);
  });
  rightCounts.forEach((count) => {
    rightTotal += count;
  });
  if (leftTotal === 0 || rightTotal === 0) return 0;
  // Dice 系数在「短标题是长标题前缀 + 少量后缀」时恰好卡在 0.9，补充包含度以覆盖该边界。
  const dice = (2 * common) / (leftTotal + rightTotal);
  const containment = common / Math.min(leftTotal, rightTotal);
  return Math.max(dice, containment);
}

/** 标题是否近似重复：相似度严格大于 {@link TITLE_SIMILARITY_THRESHOLD}。 */
export function isSimilarTitle(left: string, right: string): boolean {
  return titleSimilarity(left, right) > TITLE_SIMILARITY_THRESHOLD;
}

/** 判重所需的字段子集（news_items 写入前的候选，字段可缺省）。 */
export interface DedupCandidate {
  url?: string | null;
  title?: string | null;
}

/** 两条资讯是否重复：规范化 URL 相等（硬重复）或标题相似度 > 0.9（软重复）。 */
export function isDuplicateOf(left: DedupCandidate, right: DedupCandidate): boolean {
  const leftUrl = normalizeUrl(left.url ?? '');
  const rightUrl = normalizeUrl(right.url ?? '');
  if (leftUrl && leftUrl === rightUrl) return true;
  return isSimilarTitle(left.title ?? '', right.title ?? '');
}
