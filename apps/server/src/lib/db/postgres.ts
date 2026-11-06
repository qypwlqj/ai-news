import { DDL_STATEMENTS } from './ddl';

export interface QueryResultLike {
  rows: Record<string, unknown>[];
  rowCount: number | null;
}

export type QueryFn = (sql: string, params?: readonly unknown[]) => Promise<QueryResultLike>;

/** 数据层唯一端口：仓储层只依赖它，便于测试注入内存实现。 */
export interface Database {
  query: QueryFn;
  close(): Promise<void>;
}

/** 驱动缺失或不可用时的可读降级错误（接口层映射为 500 INTERNAL_ERROR）。 */
export class DatabaseUnavailableError extends Error {
  readonly code = 'DATABASE_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'DatabaseUnavailableError';
  }
}

export interface PgPoolConfig {
  connectionString?: string;
  max?: number;
  connectionTimeoutMillis?: number;
}

export interface PgPoolLike {
  query(sql: string, params?: readonly unknown[]): Promise<QueryResultLike>;
  end(): Promise<void>;
}

export interface PgDriver {
  Pool: new (config: PgPoolConfig) => PgPoolLike;
}

export type ModuleImporter = (specifier: string) => Promise<unknown>;

/** 动态加载是唯一依赖点：未安装 pg 时不影响其它模块加载，只在建连时抛降级错误。 */
export const defaultImporter: ModuleImporter = (specifier) => import(/* @vite-ignore */ specifier);

export async function loadPgDriver(importer: ModuleImporter = defaultImporter): Promise<PgDriver> {
  let loaded: unknown;
  try {
    loaded = await importer('pg');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new DatabaseUnavailableError(`pg driver is unavailable: ${reason}`);
  }
  const candidate = (loaded as { default?: unknown } | null)?.default ?? loaded;
  const Pool = (candidate as { Pool?: unknown } | null)?.Pool;
  if (typeof Pool !== 'function') {
    throw new DatabaseUnavailableError('pg driver does not export Pool; install `pg` or use the memory repository');
  }
  return { Pool: Pool as PgDriver['Pool'] };
}

export async function createPostgresDatabase(
  config: PgPoolConfig = {},
  importer: ModuleImporter = defaultImporter,
): Promise<Database> {
  const driver = await loadPgDriver(importer);
  const pool = new driver.Pool(config);
  return {
    query: (sql, params) => pool.query(sql, params),
    close: () => pool.end(),
  };
}

/** 按数组顺序逐条执行 DDL（无分号结尾），返回执行条数。 */
export async function applySchema(
  db: Pick<Database, 'query'>,
  statements: readonly string[] = DDL_STATEMENTS,
): Promise<number> {
  let applied = 0;
  for (const statement of statements) {
    await db.query(statement);
    applied += 1;
  }
  return applied;
}
