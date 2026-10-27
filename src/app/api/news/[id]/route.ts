import { getNewsRepository } from '../../../../lib/db/repository';
import { errorResponse, jsonResponse } from '../../../../lib/runtime';

export const dynamic = 'force-dynamic';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return asText(value);
}

/** GET /api/news/{id}：主键单点查询，400 INVALID_ID 与 404 NEWS_NOT_FOUND 严格区分。 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const params = await context.params;
  const rawId = typeof params?.id === 'string' ? params.id.trim() : '';
  if (!ID_PATTERN.test(rawId)) return errorResponse('INVALID_ID', 'id must be a non-empty identifier', 400);

  let detail: unknown;
  try {
    const repository = getNewsRepository() as unknown as { getNewsById?: (id: string) => Promise<unknown> };
    detail = typeof repository.getNewsById === 'function' ? await repository.getNewsById(rawId) : null;
  } catch {
    return errorResponse('INTERNAL_ERROR', 'failed to load news item', 500);
  }
  if (!detail) return errorResponse('NEWS_NOT_FOUND', 'news item not found', 404);

  const record = asRecord(detail);
  return jsonResponse({
    id: asText(record.id) ?? rawId,
    title: asText(record.title) ?? '',
    originalTitle: asText(record.originalTitle),
    url: asText(record.url) ?? '',
    source: asText(record.source) ?? 'unknown',
    publishedAt: asIso(record.publishedAt),
    summary: asText(record.summary),
    category: asText(record.category) ?? 'industry_news',
    summaryStatus: asText(record.summaryStatus) ?? 'pending',
    rawExcerpt: asText(record.rawExcerpt),
    titleFingerprint: asText(record.titleFingerprint),
    createdAt: asIso(record.createdAt),
    updatedAt: asIso(record.updatedAt),
  });
}
