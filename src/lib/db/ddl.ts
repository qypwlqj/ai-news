/**
 * DDL 唯一真源（v1）：枚举 + news_items / collect_runs / collect_run_sources + 索引。
 * 迁移纪律：只增不改，历史脚本不回改；语句不带结尾分号，由执行侧按数组顺序逐条执行。
 */
export const SCHEMA_VERSION = 1;

export const DDL_STATEMENTS: readonly string[] = [
  `CREATE TYPE source_enum AS ENUM ('hacker_news', 'arxiv_cs_ai', 'jiqizhixin')`,
  `CREATE TYPE category_enum AS ENUM ('model_release', 'research_paper', 'product_application', 'industry_news', 'policy_funding')`,
  `CREATE TYPE summary_status_enum AS ENUM ('ok', 'failed', 'pending')`,
  `CREATE TYPE run_trigger_enum AS ENUM ('cron', 'api')`,
  `CREATE TYPE run_status_enum AS ENUM ('success', 'partial_failure', 'failed')`,
  `CREATE TYPE source_run_status_enum AS ENUM ('success', 'failed', 'skipped')`,
  `CREATE TABLE news_items (
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
  )`,
  `CREATE UNIQUE INDEX news_items_normalized_url_uidx ON news_items (normalized_url)`,
  `CREATE UNIQUE INDEX news_items_source_external_id_uidx ON news_items (source, external_id)`,
  `CREATE INDEX news_items_published_at_idx ON news_items (published_at DESC, id DESC)`,
  `CREATE INDEX news_items_category_published_at_idx ON news_items (category, published_at DESC, id DESC)`,
  `CREATE INDEX news_items_source_published_at_idx ON news_items (source, published_at DESC)`,
  `CREATE INDEX news_items_title_fingerprint_idx ON news_items (title_fingerprint)`,
  `CREATE INDEX news_items_summary_status_partial_idx ON news_items (published_at DESC) WHERE summary_status <> 'ok'`,
  `CREATE TABLE collect_runs (
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
  )`,
  `CREATE INDEX collect_runs_run_date_status_idx ON collect_runs (run_date, status, finished_at DESC)`,
  `CREATE INDEX collect_runs_started_at_idx ON collect_runs (started_at DESC)`,
  `CREATE INDEX collect_runs_status_started_at_idx ON collect_runs (status, started_at DESC)`,
  `CREATE TABLE collect_run_sources (
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
  )`,
  `CREATE UNIQUE INDEX collect_run_sources_run_id_source_uidx ON collect_run_sources (run_id, source)`,
  `CREATE INDEX collect_run_sources_source_status_idx ON collect_run_sources (source, status)`,
];
