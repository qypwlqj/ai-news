/**
 * 数据库结构真源（幂等 DDL）：news_items / collect_runs / collect_run_sources 与索引。
 *
 * 规范：
 * - 表与索引一律 `CREATE ... IF NOT EXISTS`，重复执行是空操作，可用于启动自检与迁移重放。
 * - ENUM 没有 `CREATE TYPE IF NOT EXISTS`，用 `DO` 块捕获 `duplicate_object`；
 *   取值一律 `ALTER TYPE ... ADD VALUE IF NOT EXISTS`，枚举「只加不删不改名」。
 * - 本模块只含新增语句，不含 DROP / TRUNCATE；删除列须拆成独立迁移。
 * - 纯字符串生成 + 注入式执行器：不读环境变量、不建连接、不发网络请求。
 */

export const SCHEMA_VERSION = 1;

/** 枚举真源；取值顺序即落库顺序，只允许尾部追加新值或新增枚举类型。 */
export const SCHEMA_ENUMS = {
  source_enum: ['hacker_news', 'arxiv_cs_ai', 'jiqizhixin'],
  category_enum: [
    'model_release',
    'research_paper',
    'product_application',
    'industry_news',
    'policy_funding',
  ],
  summary_status_enum: ['ok', 'failed', 'pending'],
  run_trigger_enum: ['cron', 'api'],
  run_status_enum: ['success', 'partial_failure', 'failed'],
  source_run_status_enum: ['success', 'failed', 'skipped'],
} as const satisfies Record<string, readonly string[]>;

export type SchemaEnumName = keyof typeof SCHEMA_ENUMS;

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** 单个枚举的幂等语句：DO 块建类型 + 逐值 ADD VALUE IF NOT EXISTS。 */
export function createEnumStatements(name: string, values: readonly string[]): readonly string[] {
  if (!name) throw new Error('enum name is required');
  if (values.length === 0) throw new Error(`enum ${name} requires at least one value`);
  const literals = values.map(quoteLiteral).join(', ');
  return [
    `DO $$ BEGIN CREATE TYPE ${quoteIdent(name)} AS ENUM (${literals}); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    ...values.map(
      (value) => `ALTER TYPE ${quoteIdent(name)} ADD VALUE IF NOT EXISTS ${quoteLiteral(value)};`,
    ),
  ];
}

const NEWS_ITEMS_TABLE = `CREATE TABLE IF NOT EXISTS news_items (
  id text PRIMARY KEY,
  title text NOT NULL,
  original_title text,
  url text NOT NULL,
  normalized_url text NOT NULL,
  title_fingerprint text NOT NULL,
  source source_enum NOT NULL,
  external_id text,
  published_at timestamp(3) NOT NULL,
  summary text,
  summary_status summary_status_enum NOT NULL DEFAULT 'pending',
  category category_enum NOT NULL,
  raw_excerpt text,
  created_at timestamp(3) NOT NULL DEFAULT now(),
  updated_at timestamp(3) NOT NULL DEFAULT now()
);`;

const NEWS_ITEMS_INDEXES: readonly string[] = [
  'CREATE UNIQUE INDEX IF NOT EXISTS news_items_normalized_url_uidx ON news_items (normalized_url);',
  'CREATE UNIQUE INDEX IF NOT EXISTS news_items_source_external_id_uidx ON news_items (source, external_id);',
  'CREATE INDEX IF NOT EXISTS news_items_published_at_idx ON news_items (published_at DESC, id DESC);',
  'CREATE INDEX IF NOT EXISTS news_items_category_published_at_idx ON news_items (category, published_at DESC, id DESC);',
  'CREATE INDEX IF NOT EXISTS news_items_source_published_at_idx ON news_items (source, published_at DESC);',
  'CREATE INDEX IF NOT EXISTS news_items_title_fingerprint_published_at_idx ON news_items (title_fingerprint, published_at DESC);',
  "CREATE INDEX IF NOT EXISTS news_items_summary_status_partial_idx ON news_items (published_at DESC) WHERE summary_status <> 'ok';",
];

const COLLECT_RUNS_TABLE = `CREATE TABLE IF NOT EXISTS collect_runs (
  id text PRIMARY KEY,
  trigger_type run_trigger_enum NOT NULL,
  run_date date NOT NULL,
  status run_status_enum NOT NULL,
  started_at timestamp(3) NOT NULL,
  finished_at timestamp(3),
  duration_ms integer,
  fetched integer NOT NULL DEFAULT 0,
  inserted integer NOT NULL DEFAULT 0,
  duplicates integer NOT NULL DEFAULT 0,
  summary_ok integer NOT NULL DEFAULT 0,
  summary_failed integer NOT NULL DEFAULT 0,
  created_at timestamp(3) NOT NULL DEFAULT now()
);`;

const COLLECT_RUNS_INDEXES: readonly string[] = [
  'CREATE INDEX IF NOT EXISTS collect_runs_run_date_status_idx ON collect_runs (run_date, status, finished_at DESC);',
  'CREATE INDEX IF NOT EXISTS collect_runs_started_at_idx ON collect_runs (started_at DESC);',
  'CREATE INDEX IF NOT EXISTS collect_runs_status_started_at_idx ON collect_runs (status, started_at DESC);',
];

const COLLECT_RUN_SOURCES_TABLE = `CREATE TABLE IF NOT EXISTS collect_run_sources (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES collect_runs (id) ON DELETE CASCADE ON UPDATE CASCADE,
  source source_enum NOT NULL,
  status source_run_status_enum NOT NULL,
  fetched integer NOT NULL DEFAULT 0,
  inserted integer NOT NULL DEFAULT 0,
  duplicates integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 1,
  error_code text,
  error_message text,
  created_at timestamp(3) NOT NULL DEFAULT now()
);`;

const COLLECT_RUN_SOURCES_INDEXES: readonly string[] = [
  'CREATE UNIQUE INDEX IF NOT EXISTS collect_run_sources_run_id_source_uidx ON collect_run_sources (run_id, source);',
  'CREATE INDEX IF NOT EXISTS collect_run_sources_source_status_idx ON collect_run_sources (source, status);',
];

/** 完整幂等 DDL 序列：枚举 → 三表 → 索引（依赖顺序固定，可整体重放）。 */
export const SCHEMA_STATEMENTS: readonly string[] = [
  ...(Object.entries(SCHEMA_ENUMS) as Array<[SchemaEnumName, readonly string[]]>).flatMap(
    ([name, values]) => createEnumStatements(name, values),
  ),
  NEWS_ITEMS_TABLE,
  ...NEWS_ITEMS_INDEXES,
  COLLECT_RUNS_TABLE,
  ...COLLECT_RUNS_INDEXES,
  COLLECT_RUN_SOURCES_TABLE,
  ...COLLECT_RUN_SOURCES_INDEXES,
];

export interface SchemaExecutor {
  query: (sql: string) => Promise<unknown>;
}

export interface SchemaResult {
  version: number;
  executed: number;
}

/** 逐条执行 DDL；任一条失败立即抛出，不吞错、不继续后续语句。 */
export async function applySchema(executor: SchemaExecutor): Promise<SchemaResult> {
  if (!executor || typeof executor.query !== 'function') {
    throw new Error('applySchema requires a query executor');
  }
  let executed = 0;
  for (const sql of SCHEMA_STATEMENTS) {
    await executor.query(sql);
    executed += 1;
  }
  return { version: SCHEMA_VERSION, executed };
}

/** 供迁移脚本 / 运维手动执行时复制的完整 SQL 文本。 */
export function schemaSql(): string {
  return SCHEMA_STATEMENTS.join('\n\n');
}
