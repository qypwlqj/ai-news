# 一期技术规格（冻结项）

本文件冻结领域枚举、去重规则与时间语义，供接口、采集与页面实现共同引用。接口细节见 `docs/api.md`，列级说明与 Prisma 映射见 `docs/data-model.md`，DDL 真源为 `src/app/news-schema.ts`（`SCHEMA_STATEMENTS` / `applySchema()` / `schemaSql()`）。

## 1. 领域枚举（只加不删不改名）

| 枚举 | 取值 | 代码真源 |
| --- | --- | --- |
| `source` | `hacker_news` / `arxiv_cs_ai` / `jiqizhixin` | `src/lib/types.ts` 的 `SOURCE_VALUES` |
| `category` | `model_release` / `research_paper` / `product_application` / `industry_news` / `policy_funding` | `CATEGORIES`（含中文 label 与 `order` 1–5） |
| `summary_status` | `ok` / `failed` / `pending` | `SUMMARY_STATUS_VALUES` |
| `run_status` | `success` / `partial_failure` / `failed` | `RUN_STATUS_VALUES` |
| `source_run_status` | `success` / `failed` / `skipped` | `SOURCE_RUN_STATUS_VALUES` |
| `run_trigger` | `cron` / `api` | `RUN_TRIGGER_VALUES` |

- 未知枚举值一律降级展示（原值文本 + 中性样式），不报错、不隐藏条目。
- `category` 无法判定时兜底 `industry_news`，保证入库命中率 100%。
- 错误码固定集合见 `API_ERROR_CODES`，统一信封 `{ error: { code, message, requestId } }`；`code` 为稳定机器码。
- 中文展示名集中在 `src/lib/labels.ts`；`label` 与 `order` 的唯一真源是 `CATEGORIES`，前端不得硬编码。

## 2. 三张表 DDL 与索引

```sql
CREATE TYPE source_enum AS ENUM ('hacker_news', 'arxiv_cs_ai', 'jiqizhixin');
CREATE TYPE category_enum AS ENUM ('model_release', 'research_paper', 'product_application', 'industry_news', 'policy_funding');
CREATE TYPE summary_status_enum AS ENUM ('ok', 'failed', 'pending');
CREATE TYPE run_trigger_enum AS ENUM ('cron', 'api');
CREATE TYPE run_status_enum AS ENUM ('success', 'partial_failure', 'failed');
CREATE TYPE source_run_status_enum AS ENUM ('success', 'failed', 'skipped');

CREATE TABLE news_items (
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
);

CREATE TABLE collect_runs (
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
);

CREATE TABLE collect_run_sources (
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
);
```

唯一键与复合索引：

| 索引 | 用途 |
| --- | --- |
| `UNIQUE news_items (normalized_url)` | URL 硬去重，写入冲突计入 `duplicates` |
| `UNIQUE news_items (source, external_id)` | 来源内幂等（`external_id` 为 NULL 不冲突） |
| `news_items (published_at DESC, id DESC)` | 首页时间倒序 + 稳定分页 |
| `news_items (category, published_at DESC, id DESC)` | 分类筛选 + 时间倒序 |
| `news_items (source, published_at DESC)` | 来源维度回溯与单日条数统计 |
| `news_items (title_fingerprint)` | 标题近似去重候选检索 |
| `news_items (published_at DESC) WHERE summary_status <> 'ok'` | 摘要补偿，避免全表扫描 |
| `UNIQUE collect_run_sources (run_id, source)` | 同批次同来源仅一行，重试只更新 `attempts` |
| `collect_runs (run_date, status, finished_at DESC)` | 幂等短路与按日筛选 |

## 3. 去重双策略

1. **硬去重（URL）**：`normalizeUrl()` 去掉 `utm_*` / `fbclid` / `gclid` / `ref` 等追踪参数、`#fragment` 与尾斜杠，协议与主机小写，查询参数按键排序；以 `normalized_url` 唯一索引兜底，冲突计入 `duplicates` 且不返回。
2. **软去重（标题）**：`normalizeTitle()` 做 NFKC + 小写 + 去标点符号 + 空白归一；`titleFingerprint()`（FNV-1a 32 位）仅用于在近 7 天窗口内检索候选（不建唯一约束），候选与新条目的 `titleSimilarity()`（字符二元组 Dice 系数）严格大于 `0.9` 即判为重复，丢弃新条并计入 `duplicates`。

重复只保留最早入库的 1 条；接口层永不返回重复条目。阈值常量 `TITLE_SIMILARITY_THRESHOLD = 0.9`。

## 4. 时间语义

- 库内 `published_at` / `started_at` / `finished_at` 一律 UTC（`timestamp(3)`）。
- `date=YYYY-MM-DD` 按 **Asia/Shanghai 自然日** 解释。上海固定 `+08:00`、无夏令时，因此半开区间：
  - `startUtc = new Date(`${date}T00:00:00.000+08:00`)`
  - `endUtc = startUtc + 24h`
  - 查询条件 `published_at >= startUtc AND published_at < endUtc`，走 `(published_at DESC, id DESC)` / `(category, published_at DESC, id DESC)` 索引范围扫描。
- `collect_runs.run_date` 用 `date` 类型存上海自然日，天然不受时区影响；缺省 `date` 取「当前上海日期」。
- 响应时间统一为 ISO8601 UTC 字符串，展示格式化由客户端按 `Asia/Shanghai` 处理。

## 5. 摘要与分类契约

- 摘要 50–200 字中文；LLM 失败降级 `summary=null` + `summary_status=failed`，条目照常入库并由 `GET /api/news` 返回，当日批次不中断。
- 分类只取 5 枚举之一；LLM 返回非法值时兜底 `industry_news`。
- 来源 / 分类 / 摘要状态与占位、错误文案见 `src/lib/labels.ts` 与 `docs/api.md`。
