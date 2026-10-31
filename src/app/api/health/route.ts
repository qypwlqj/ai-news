import { getNewsRepository } from '../../../lib/db/repository';
import { jsonResponse } from '../../../lib/runtime';

export const dynamic = 'force-dynamic';

/** GET /api/health：探活，仅暴露 database 状态，不返回任何配置或凭据。 */
export async function GET(): Promise<Response> {
  const time = new Date().toISOString();
  let database: 'ok' | 'error' = 'ok';
  try {
    const repository = getNewsRepository() as unknown as {
      ping?: () => Promise<unknown>;
      listNews?: (query: Record<string, unknown>) => Promise<unknown>;
    };
    if (typeof repository.ping === 'function') {
      await repository.ping();
    } else if (typeof repository.listNews === 'function') {
      await repository.listNews({ page: 1, limit: 1, offset: 0 });
    }
  } catch {
    database = 'error';
  }

  if (database === 'error') {
    return jsonResponse({ status: 'degraded', time, checks: { database } }, 503);
  }
  return jsonResponse({ status: 'ok', time, checks: { database } });
}
