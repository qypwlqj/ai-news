import { normalizeUrl, titleFingerprint, titleSimilarity } from './news-dedup';

/** 标题软去重阈值：相似度严格大于该值判为重复（与 docs/spec.md 冻结一致）。 */
export const TITLE_SIMILARITY_THRESHOLD = 0.9;
/** 标题软去重候选窗口（天）：只看近 7 天入库条目。 */
export const TITLE_DEDUPE_WINDOW_DAYS = 7;
/** raw_excerpt 落库前截断长度。 */
export const RAW_EXCERPT_MAX_CHARS = 2000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 最小 SQL 执行契约：不建连接、不读环境变量，测试注入假实现。 */
export interface SqlResult<T> {
  rows: T[];
  rowCount: number;
}

export interface SqlRunner {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<SqlResult<T>>;
}

export interface NewsInsertInput {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
  category: string;
  originalTitle?: string | null;
  externalId?: string | null;
  rawExcerpt?: string | null;
}

export type DuplicateReason = 'normalized_url' | 'title_similarity' | 'external_id';

export interface PersistOutcome {
  id: string;
  status: 'inserted' | 'duplicate';
  reason?: DuplicateReason;
}

export interface SummaryPatch {
  id: string;
  summary: string | null;
  summaryStatus: 'ok' | 'failed' | 'pending';
  category?: string | null;
}

export interface BatchPersistResult {
  inserted: number;
  duplicates: number;
  outcomes: PersistOutcome[];
}

const INSERT_SQL = [
  'INSERT INTO news_items (id, title, original_title, url, normalized_url, title_fingerprint,',
  ' source, external_id, published_at, summary, summary_status, category, raw_excerpt)',
  " VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, 'pending', $10, $11)",
  ' ON CONFLICT (normalized_url) DO NOTHING',
  ' RETURNING id',
].join('');

const CANDIDATE_SQL =
  'SELECT id, title FROM news_items WHERE title_fingerprint = $1 AND published_at >= $2';

const UPDATE_SUMMARY_SQL = [
  'UPDATE news_items SET summary = $1, summary_status = $2, category = COALESCE($3, category),',
  ' updated_at = now() WHERE id = $4',
].join('');

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
  );
}

/** 单条入库：URL 硬去重（唯一索引 + ON CONFLICT）→ 近 7 天标题指纹候选软去重 → 写入。 */
export async function persistNewsItem(
  runner: SqlRunner,
  input: NewsInsertInput,
  now: Date = new Date(),
): Promise<PersistOutcome> {
  const normalizedUrl = normalizeUrl(input.url);
  const fingerprint = titleFingerprint(input.title);
  const windowStart = new Date(now.getTime() - TITLE_DEDUPE_WINDOW_DAYS * DAY_MS);
  const candidates = await runner.query<{ id: string; title: string }>(CANDIDATE_SQL, [
    fingerprint,
    windowStart,
  ]);
  for (const candidate of candidates.rows) {
    if (titleSimilarity(input.title, candidate.title) > TITLE_SIMILARITY_THRESHOLD) {
      return { id: input.id, status: 'duplicate', reason: 'title_similarity' };
    }
  }

  let inserted: SqlResult<{ id: string }>;
  try {
    inserted = await runner.query<{ id: string }>(INSERT_SQL, [
      input.id,
      input.title,
      input.originalTitle ?? null,
      input.url,
      normalizedUrl,
      fingerprint,
      input.source,
      input.externalId ?? null,
      input.publishedAt,
      input.category,
      input.rawExcerpt ? input.rawExcerpt.slice(0, RAW_EXCERPT_MAX_CHARS) : null,
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { id: input.id, status: 'duplicate', reason: 'external_id' };
    }
    throw error;
  }
  if (inserted.rowCount === 0 || inserted.rows.length === 0) {
    return { id: input.id, status: 'duplicate', reason: 'normalized_url' };
  }
  return { id: input.id, status: 'inserted' };
}

/** 批量入库：重复不阻断批次，只计入 duplicates。 */
export async function persistNewsBatch(
  runner: SqlRunner,
  items: NewsInsertInput[],
  now: Date = new Date(),
): Promise<BatchPersistResult> {
  const outcomes: PersistOutcome[] = [];
  for (const item of items) {
    outcomes.push(await persistNewsItem(runner, item, now));
  }
  return {
    inserted: outcomes.filter((outcome) => outcome.status === 'inserted').length,
    duplicates: outcomes.filter((outcome) => outcome.status === 'duplicate').length,
    outcomes,
  };
}

/** 摘要回填：成功写 summary + ok；失败降级 summary=NULL + failed，条目始终保留。 */
export async function updateNewsSummary(runner: SqlRunner, patch: SummaryPatch): Promise<boolean> {
  const result = await runner.query(UPDATE_SUMMARY_SQL, [
    patch.summaryStatus === 'ok' ? patch.summary : null,
    patch.summaryStatus,
    patch.category ?? null,
    patch.id,
  ]);
  return result.rowCount > 0;
}
