const TRACKING_KEY = /^(utm_.*|fbclid|gclid|ref|source|spm)$/i;

export const TITLE_SIMILARITY_THRESHOLD = 0.9;

export function normalizeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return input.trim().toLowerCase();
  }

  if (url.protocol === 'http:') url.protocol = 'https:';
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';

  const kept = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_KEY.test(key))
    .sort(([a], [b]) => a.localeCompare(b));
  url.search = '';
  for (const [key, value] of kept) url.searchParams.append(key, value);

  const normalized = url.toString();
  return url.pathname !== '/' && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

export function titleFingerprint(title: string): string {
  return title.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

export function titleSimilarity(a: string, b: string): number {
  const x = titleFingerprint(a);
  const y = titleFingerprint(b);
  if (!x && !y) return 1;
  if (!x || !y) return 0;
  if (x === y) return 1;

  let previous = Array.from({ length: y.length + 1 }, (_, index) => index);
  for (let i = 1; i <= x.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= y.length; j += 1) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return 1 - previous[y.length] / Math.max(x.length, y.length);
}

export interface DedupCandidate {
  url: string;
  title: string;
}

export function isDuplicateNews(a: DedupCandidate, b: DedupCandidate): boolean {
  return normalizeUrl(a.url) === normalizeUrl(b.url) || titleSimilarity(a.title, b.title) > TITLE_SIMILARITY_THRESHOLD;
}
