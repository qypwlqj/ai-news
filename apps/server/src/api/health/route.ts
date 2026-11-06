import { getStorageMode } from '../../lib/bootstrap';
import { getNewsRepository } from '../../lib/db/repository';
import { jsonResponse } from '../../lib/runtime';

/** GET /api/health：探活；storage 区分 memory/postgres，禁止把内存仓伪装成生产库。 */
export async function GET(): Promise<Response> {
  const time = new Date().toISOString();
  const storage = getStorageMode();
  let database: 'ok' | 'error' = 'ok';
  try {
    const repository = getNewsRepository() as unknown as {
      ping?: () => Promise<unknown>;
      listNews?: (query: Record<string, unknown>) => Promise<unknown>;
    };
    if (storage === 'postgres') {
      if (typeof repository.ping !== 'function') throw new Error('postgres repository missing ping');
      await repository.ping();
    } else if (typeof repository.listNews === 'function') {
      await repository.listNews({ page: 1, limit: 1 });
    }
  } catch {
    database = 'error';
  }

  if (database === 'error') {
    return jsonResponse({ status: 'degraded', time, checks: { database, storage } }, 503);
  }
  return jsonResponse({ status: 'ok', time, checks: { database, storage } });
}
