import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DATABASE_POOL_MAX,
  DEFAULT_LLM_MODEL,
  DEFAULT_LLM_TIMEOUT_MS,
  configSummary,
  parseConfig,
} from '../src/app/news-config';
import { collectLockKey, createDatabase } from '../src/app/news-db';
import type { DbPool, DbQueryResult } from '../src/app/news-db';

interface Recorded {
  sql: string;
  params?: readonly unknown[];
}

function createFakePool(options: { connect?: boolean; failSqlFragment?: string; locked?: boolean; emptyRows?: boolean } = {}) {
  const calls: Recorded[] = [];
  const releases: number[] = [];

  const run = async <T,>(sql: string, params?: readonly unknown[]): Promise<DbQueryResult<T>> => {
    calls.push({ sql, params });
    if (options.failSqlFragment && sql.includes(options.failSqlFragment)) throw new Error('query failed');
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: options.locked ?? true }] as T[], rowCount: 1 };
    if (sql.includes('pg_advisory_unlock')) return { rows: [{ released: true }] as T[], rowCount: 1 };
    if (options.emptyRows) return { rows: [] as T[], rowCount: 0 };
    if (sql.includes('SELECT 1')) return { rows: [{ ok: 1 }] as T[], rowCount: 1 };
    return { rows: [{ id: 'n1' }] as T[], rowCount: 4 };
  };

  const pool: DbPool = { query: run };
  if (options.connect) {
    pool.connect = async () => ({ query: run, release: () => void releases.push(1) });
  }
  return { pool, calls, releases };
}

describe('news-config', () => {
  it('fills defaults and records missing key names only', () => {
    const config = parseConfig({});
    expect(config.database.connectionString).toBeNull();
    expect(config.database.maxConnections).toBe(DEFAULT_DATABASE_POOL_MAX);
    expect(config.llm.model).toBe(DEFAULT_LLM_MODEL);
    expect(config.missing).toEqual(['DATABASE_URL', 'CRON_SECRET', 'LLM_API_KEY']);
  });

  it('trims provided values and rejects out-of-range integers', () => {
    const config = parseConfig({
      DATABASE_URL: ' postgres://u:p@localhost:5432/news ',
      CRON_SECRET: 'secret-value',
      LLM_API_KEY: 'key-value',
      DATABASE_POOL_MAX: '0',
      DATABASE_STATEMENT_TIMEOUT_MS: '5000',
      DATABASE_SSL: 'true',
      LLM_TIMEOUT_MS: 'abc',
    });
    expect(config.database.connectionString).toBe('postgres://u:p@localhost:5432/news');
    expect(config.database.maxConnections).toBe(DEFAULT_DATABASE_POOL_MAX);
    expect(config.database.statementTimeoutMs).toBe(5000);
    expect(config.database.ssl).toBe(true);
    expect(config.llm.timeoutMs).toBe(DEFAULT_LLM_TIMEOUT_MS);
    expect(config.missing).toEqual([]);
  });

  it('never leaks secret values through the summary', () => {
    const summary = configSummary(
      parseConfig({
        DATABASE_URL: 'postgres://u:topsecret@db/x',
        CRON_SECRET: 'cron-topsecret',
        LLM_API_KEY: 'llm-topsecret',
      }),
    );
    const serialised = JSON.stringify(summary);
    expect(summary.database.configured).toBe(true);
    expect(summary.cron.secretConfigured).toBe(true);
    expect(summary.llm.apiKeyConfigured).toBe(true);
    expect(serialised).not.toContain('topsecret');
  });
});

describe('news-db', () => {
  it('passes parameters through and exposes queryOne/execute', async () => {
    const { pool, calls } = createFakePool();
    const database = createDatabase(pool);
    expect(await database.query('SELECT * FROM news_items WHERE id = $1', ['n1'])).toEqual([{ id: 'n1' }]);
    expect(calls[0]).toEqual({ sql: 'SELECT * FROM news_items WHERE id = $1', params: ['n1'] });
    expect(await database.queryOne('SELECT * FROM news_items')).toEqual({ id: 'n1' });
    expect(await database.execute('UPDATE news_items SET summary = $1', ['x'])).toBe(4);
    expect(await createDatabase(createFakePool({ emptyRows: true }).pool).queryOne('SELECT 1')).toBeNull();
  });

  it('wraps transactions with BEGIN/COMMIT and rolls back on failure', async () => {
    const { pool, calls, releases } = createFakePool({ connect: true });
    const database = createDatabase(pool);
    await database.transaction(async (client) => {
      await client.query('INSERT INTO news_items VALUES ($1)', ['a']);
    });
    expect(calls.map((call) => call.sql)).toEqual(['BEGIN', 'INSERT INTO news_items VALUES ($1)', 'COMMIT']);
    expect(releases).toHaveLength(1);
    await expect(
      database.transaction(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(calls.some((call) => call.sql === 'ROLLBACK')).toBe(true);
    expect(releases).toHaveLength(2);
  });

  it('acquires and releases the collect advisory lock with a parameterised key', async () => {
    const { pool, calls } = createFakePool({ locked: true });
    const database = createDatabase(pool);
    const result = await database.withAdvisoryLock(collectLockKey('2025-06-01'), async () => 'done');
    expect(result).toEqual({ acquired: true, value: 'done' });
    expect(calls[0].params).toEqual(['news_collect:2025-06-01']);
    expect(calls.some((call) => call.sql.includes('pg_advisory_unlock'))).toBe(true);

    const busy = createFakePool({ locked: false });
    let executed = false;
    const skipped = await createDatabase(busy.pool).withAdvisoryLock('news_collect:2025-06-01', async () => {
      executed = true;
    });
    expect(skipped.acquired).toBe(false);
    expect(executed).toBe(false);
    expect(busy.calls.some((call) => call.sql.includes('pg_advisory_unlock'))).toBe(false);
  });

  it('reports ping failures without throwing', async () => {
    expect(await createDatabase(createFakePool().pool).ping()).toBe(true);
    expect(await createDatabase(createFakePool({ failSqlFragment: 'SELECT 1' }).pool).ping()).toBe(false);
  });
});
