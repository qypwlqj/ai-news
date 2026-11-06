/**
 * URL 规范化（纯函数，无 IO）：与 docs/news-primitives.md 的细则一一对应。
 *
 * 规则：仅接受 http/https（其它协议或无法解析返回空串）；协议与主机小写、去默认端口；
 * 丢弃 utm_* / fbclid / gclid / ref 等追踪参数与 #fragment；查询参数按键排序；
 * 非根路径去尾斜杠，根路径保留 `/`。
 */

const TRACKING_KEYS = new Set(['fbclid', 'gclid', 'ref']);

function isTrackingKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.startsWith('utm_') || TRACKING_KEYS.has(lower);
}

function trimTrailingSlashes(pathname: string): string {
  if (pathname.length <= 1) return '/';
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

export function normalizeUrl(input: string): string {
  if (typeof input !== 'string') return '';
  const raw = input.trim();
  if (raw === '') return '';

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return '';
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') return '';

  const keptKeys = new Set<string>();
  parsed.searchParams.forEach((_value, key) => {
    if (!isTrackingKey(key)) keptKeys.add(key);
  });
  const keys = Array.from(keptKeys).sort();

  const params = new URLSearchParams();
  for (const key of keys) {
    const values = parsed.searchParams.getAll(key);
    values.sort();
    for (const value of values) params.append(key, value);
  }

  let origin = `${protocol}//${parsed.hostname.toLowerCase()}`;
  const port = parsed.port;
  const isDefaultPort =
    (protocol === 'http:' && port === '80') || (protocol === 'https:' && port === '443');
  if (port !== '' && !isDefaultPort) origin += `:${port}`;

  const search = params.toString();
  const pathname = trimTrailingSlashes(parsed.pathname === '' ? '/' : parsed.pathname);
  return search === '' ? `${origin}${pathname}` : `${origin}${pathname}?${search}`;
}
