/**
 * Postgres 访问封装：Pool 单例持有、参数化查询、事务与 advisory lock。
 * 池工厂与配置由运行时注入（本模块不直接引入驱动、不读环境变量），测试用假 client 覆盖。
 */
import type { DatabaseConfig } from './news-config';

export interface DbQueryResult<T> {
  rows: T[];
  rowCount: number | null;
}

export interface DbClient {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<DbQueryResult<T>>;
  release?(): void;
}

export interface DbPool extends DbClient {
  connect?(): Promise<DbClient>;
  end?(): Promise<void>;
}

export interface AdvisoryLockResult<T> {
  acquired: boolean;
  value?: T;
}

export interface Database {
  query<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  queryOne<T>(sql: string, params?: readonly unknown[]): Promise<T | null>;
  execute(sql: string, params?: readonly unknown[]): Promise<number>;
  transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T>;
  tryAdvisoryLock(key: string): Promise<boolean>;
  releaseAdvisoryLock(key: string): Promise<boolean>;
  withAdvisoryLock<T>(key: string, fn: () => Promise<T>): Promise<AdvisoryLockResult<T>>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export const COLLECT_LOCK_PREFIX = 'news_collect:';

/** 采集互斥键：hashtext('news_collect:' || run_date)，与 docs/runbook.md 一致。 */
export function collectLockKey(runDate: string): string {
  return `${COLLECT_LOCK_PREFIX}${runDate}`;
}

export type PoolFactory = (config: DatabaseConfig) => DbPool;

let poolFactory: PoolFactory | null = null;
let sharedDatabase: Database | null = null;

export function setPoolFactory(factory: PoolFactory | null): void {
  poolFactory = factory;
}

export function createDatabase(pool: DbPool): Database {
  const run = (sql: string, params?: readonly unknown[]) => pool.query(sql, params);

  async function transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
    if (typeof pool.connect !== 'function') {
      await run('BEGIN');
      try {
        const value = await fn(pool);
        await run('COMMIT');
        return value;
      } catch (error) {
        try {
          await run('ROLLBACK');
        } catch {
          // 回滚失败不掩盖原始错误
        }
        throw error;
      }
    }

    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      const value = await fn(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // 回滚失败不掩盖原始错误
      }
      throw error;
    } finally {
      client.release?.();
    }
  }

  const database: Database = {
    async query<T>(sql: string, params?: readonly unknown[]): Promise<T[]> {
      const result = await run(sql, params);
      return Array.isArray(result.rows) ? (result.rows as T[]) : [];
    },
    async queryOne<T>(sql: string, params?: readonly unknown[]): Promise<T | null> {
      const rows = await database.query<T>(sql, params);
      return rows.length > 0 ? rows[0] : null;
    },
    async execute(sql: string, params?: readonly unknown[]): Promise<number> {
      const result = await run(sql, params);
      return typeof result.rowCount === 'number' ? result.rowCount : (result.rows?.length ?? 0);
    },
    transaction,
    async tryAdvisoryLock(key: string): Promise<boolean> {
      const row = await database.queryOne<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
        [key],
      );
      return row?.locked === true;
    },
    async releaseAdvisoryLock(key: string): Promise<boolean> {
      const row = await database.queryOne<{ released: boolean }>(
        'SELECT pg_advisory_unlock(hashtext($1)) AS released',
        [key],
      );
      return row?.released === true;
    },
    async withAdvisoryLock<T>(key: string, fn: () => Promise<T>): Promise<AdvisoryLockResult<T>> {
      if (!(await database.tryAdvisoryLock(key))) return { acquired: false };
      try {
        return { acquired: true, value: await fn() };
      } finally {
        await database.releaseAdvisoryLock(key).catch(() => false);
      }
    },
    async ping(): Promise<boolean> {
      try {
        await run('SELECT 1 AS ok');
        return true;
      } catch {
        return false;
      }
    },
    async close(): Promise<void> {
      if (typeof pool.end === 'function') await pool.end();
    },
  };

  return database;
}

/** 建立并持有唯一 Pool 实例；缺少连接串或池工厂时直接抛错，不带任何凭据内容。 */
export async function initDatabase(config: DatabaseConfig): Promise<Database> {
  if (!config.connectionString) throw new Error('DATABASE_URL is not configured');
  if (!poolFactory) throw new Error('pool factory is not registered');
  const database = createDatabase(poolFactory(config));
  sharedDatabase = database;
  return database;
}

export function setDatabase(database: Database | null): void {
  sharedDatabase = database;
}

export function hasDatabase(): boolean {
  return sharedDatabase !== null;
}

export function getDatabase(): Database {
  if (sharedDatabase === null) throw new Error('database is not configured');
  return sharedDatabase;
}

export async function closeDatabase(): Promise<void> {
  const database = sharedDatabase;
  sharedDatabase = null;
  if (database) await database.close();
}
