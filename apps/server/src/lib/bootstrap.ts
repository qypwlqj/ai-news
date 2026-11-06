import { applySchema as applyIdempotentSchema } from '../app/news-schema';
import { createPostgresDatabase, type Database } from './db/postgres';
import {
  getNewsRepository,
  InMemoryNewsRepository,
  setNewsRepository,
  type NewsRepository,
} from './db/repository';
import { PostgresNewsRepository } from './db/postgres-repository';
import { createDefaultCollectExecutor } from './collection-runtime';
import { setRuntimeConfig, type CollectExecutor } from './runtime';
import {
  registerDailyCollect,
  stopDailyCollect,
  SCHEDULE_TIME_ZONE,
  DAILY_CRON_EXPRESSION,
  type CronTaskLike,
} from './schedule';

export type StorageMode = 'memory' | 'postgres';

let storageMode: StorageMode = 'memory';

export function getStorageMode(): StorageMode {
  return storageMode;
}

export function setStorageMode(mode: StorageMode): void {
  storageMode = mode;
}

export function resolveStorageMode(env: Record<string, string | undefined>): StorageMode {
  const explicit = env.AI_NEWS_STORAGE?.trim();
  if (explicit === 'postgres') return 'postgres';
  if (explicit === 'memory') return 'memory';
  if (env.NODE_ENV === 'production') return 'postgres';
  return 'memory';
}

export interface BootstrapDeps {
  createDatabase?: (connectionString: string) => Promise<Database>;
  applySchema?: (db: Pick<Database, 'query'>) => Promise<{ version: number; executed: number }>;
  createRepository?: (db: Database) => NewsRepository & { ping(): Promise<void> };
  registerDailyCollect?: (options: {
    run: () => Promise<unknown>;
    onError?: (error: unknown) => void;
    timeZone?: string;
  }) => Promise<CronTaskLike>;
  createCollectExecutor?: (env: Record<string, string | undefined>) => CollectExecutor;
}

export interface BootstrapRuntime {
  storage: StorageMode;
  close(): Promise<void>;
}

export async function bootstrapServer(
  env: Record<string, string | undefined> = process.env,
  deps: BootstrapDeps = {},
): Promise<BootstrapRuntime> {
  const mode = resolveStorageMode(env);
  setStorageMode(mode);
  setRuntimeConfig({
    cronSecret: env.CRON_SECRET?.trim() ? env.CRON_SECRET.trim() : null,
  });

  if (mode === 'memory') {
    setNewsRepository(new InMemoryNewsRepository());
    return {
      storage: 'memory',
      async close() {
        stopDailyCollect();
        setNewsRepository(null);
      },
    };
  }

  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for production/postgres storage');
  }

  const createDatabase =
    deps.createDatabase ?? ((connectionString) => createPostgresDatabase({ connectionString }));
  const db = await createDatabase(databaseUrl);
  const applySchema =
    deps.applySchema ??
    (async (database) => applyIdempotentSchema({ query: (sql) => database.query(sql) }));
  await applySchema(db);

  const createRepository =
    deps.createRepository ?? ((database) => new PostgresNewsRepository(database));
  const repository = createRepository(db);
  setNewsRepository(repository);

  const createCollectExecutor = deps.createCollectExecutor ?? createDefaultCollectExecutor;
  const executor = createCollectExecutor(env);
  const register =
    deps.registerDailyCollect ??
    ((options) =>
      registerDailyCollect({
        ...options,
        timeZone: options.timeZone ?? SCHEDULE_TIME_ZONE,
      }));

  const task = await register({
    timeZone: SCHEDULE_TIME_ZONE,
    run: async () => executor({}),
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'collect failed';
      console.error(`[ai-news] daily collect error: ${message}`);
    },
  });

  // Touch constants so deploy logs can confirm schedule without printing secrets.
  void DAILY_CRON_EXPRESSION;
  void getNewsRepository;

  return {
    storage: 'postgres',
    async close() {
      try {
        task.stop();
      } catch {
        /* ignore */
      }
      stopDailyCollect();
      setNewsRepository(null);
      await db.close();
    },
  };
}
