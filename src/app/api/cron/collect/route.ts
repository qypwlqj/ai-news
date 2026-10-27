import { isIsoDate, SOURCE_VALUES } from '../../../../lib/query';
import { errorResponse, getCollectExecutor, getRuntimeConfig, jsonResponse } from '../../../../lib/runtime';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function readBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const matched = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return matched ? matched[1] : null;
}

function invalidBody(message: string): Response {
  return errorResponse('INVALID_BODY', message, 400);
}

/** POST /api/cron/collect：外部调度兜底，与应用内 node-cron 共用同一采集服务。 */
export async function POST(request: Request): Promise<Response> {
  const secret = getRuntimeConfig().cronSecret;
  if (!secret) return errorResponse('UNAUTHORIZED', 'cron secret is not configured', 401);
  const token = readBearerToken(request);
  if (!token) return errorResponse('UNAUTHORIZED', 'missing bearer token', 401);
  if (token !== secret) return errorResponse('FORBIDDEN', 'invalid bearer token', 403);

  const raw = await request.text();
  let payload: Record<string, unknown> = {};
  if (raw.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return invalidBody('request body must be valid JSON');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return invalidBody('request body must be a JSON object');
    }
    payload = parsed as Record<string, unknown>;
  }

  const date = payload.date;
  if (date !== undefined && (typeof date !== 'string' || !isIsoDate(date))) {
    return errorResponse('INVALID_DATE', 'date must be YYYY-MM-DD', 400);
  }

  const sources = payload.sources;
  if (sources !== undefined) {
    const valid =
      Array.isArray(sources) &&
      sources.every(
        (item) => typeof item === 'string' && (SOURCE_VALUES as readonly string[]).includes(item),
      );
    if (!valid) {
      return errorResponse('INVALID_SOURCE', 'sources must be a subset of the 3 source enum values', 400);
    }
  }

  const force = payload.force;
  if (force !== undefined && typeof force !== 'boolean') return invalidBody('force must be a boolean');

  try {
    const executor = await getCollectExecutor();
    const result = await executor({
      date: date as string | undefined,
      sources: sources as string[] | undefined,
      force: force as boolean | undefined,
    });
    return jsonResponse(result, result.status === 'failed' ? 502 : 200);
  } catch {
    return errorResponse('INTERNAL_ERROR', 'collect run failed', 500);
  }
}
