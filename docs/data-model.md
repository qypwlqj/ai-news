# 数据模型（一期）

DDL 为唯一真源，代码中维护于 `src/lib/db/ddl.ts`；本文件描述结构与索引意图。列名 snake_case，Prisma 侧用 `@map` 对齐。

## 1. 枚举

| 枚举 | 取值 |
| --- | --- |
| `source_enum` | `hacker_news` / `arxiv_cs_ai` / `jiqizhixin` |
| `category_enum` | `model_release` / `research_paper` / `product_application` / `industry_news` / `policy_funding` |
| `summary_status_enum` | `ok` / `failed` / `pending` |
| `run_trigger_enum` | `cron` / `api` |
| `run_status_enum` | `success` / `partial_failure` / `failed` |
| `source_run_status_enum` | `success` / `failed` / `skipped` |

枚举「只加不删不改名」；客户端对未知枚举值降级展示而非报错。

## 2. news_items

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text PK | 应用侧生成（cuid/uuid），便于幂等重放 |
| `title` | text NOT NULL | 展示标题 |
| `original_title` | text NULL | 来源原始标题 |
| `url` | text NOT NULL | 原文绝对地址，前端 `target=_blank rel=noopener` |
| `normalized_url` | text NOT NULL | 规范化 URL，硬去重键 |
| `title_fingerprint` | text NOT NULL | 标题指纹，软去重候选检索 |
| `source` | source_enum NOT NULL | 来源 |
| `external_id` | text NULL | 来源侧 ID/guid，与 source 组成来源内幂等键 |
| `published_at` | timestamp(3) NOT NULL | UTC 存储 |
| `summary` | text NULL | 50–200 字中文摘要；`failed` 时 NULL |
| `summary_status` | summary_status_enum NOT NULL DEFAULT 'pending' | 三态 |
| `category` | category_enum NOT NULL | 5 枚举之一，应用层兜底 `industry_news` |
| `raw_excerpt` | text NULL | 正文片段，供重试与排障（截断 ≤ 2000 字） |
| `created_at` / `updated_at` | timestamp(3) NOT NULL DEFAULT now() | `updated_at` 回填摘要时更新 |

索引：

| 索引 | 用途 |
| --- | --- |
| `UNIQUE (normalized_url)` | 硬去重，写入冲突计入 `duplicates` |
| `UNIQUE (source, external_id)` | 来源内幂等（NULL 不冲突，兼容无 guid 来源） |
| `(published_at DESC, id DESC)` | 首页时间倒序 + 稳定分页 |
| `(category, published_at DESC, id DESC)` | 分类筛选 + 时间倒序 |
| `(source, published_at DESC)` | 来源维度回溯 |
| `(title_fingerprint)` | 标题近似去重候选 |
| `(published_at DESC) WHERE summary_status <> 'ok'` | 摘要补偿任务，避免全表扫描 |

## 3. collect_runs

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text PK | 即 `runId`，批次开始前生成，失败批次也可查 |
| `trigger_type` | run_trigger_enum NOT NULL | `cron` / `api`（列名避开保留字 trigger） |
| `run_date` | date NOT NULL | Asia/Shanghai 自然日，幂等短路与按日统计维度 |
| `status` | run_status_enum NOT NULL | 与接口 `status` 一致 |
| `started_at` | timestamp(3) NOT NULL | |
| `finished_at` / `duration_ms` | timestamp(3) / integer NULL | 结束回填，未结束为 NULL |
| `fetched` / `inserted` / `duplicates` / `summary_ok` / `summary_failed` | integer NOT NULL DEFAULT 0 | 与 `sources[]` 求和对齐 |

索引：`(run_date, status, finished_at DESC)` 用于幂等短路与按日筛选；`(started_at DESC)` 默认倒序分页；`(status, started_at DESC)` 排障过滤。

## 4. collect_run_sources

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text PK | |
| `run_id` | text NOT NULL FK → collect_runs(id) ON DELETE CASCADE | |
| `source` | source_enum NOT NULL | 与 `news_items.source` 复用同一枚举 |
| `status` | source_run_status_enum NOT NULL | `skipped` 仅用于幂等短路批次 |
| `fetched` / `inserted` / `duplicates` / `failed` | integer NOT NULL DEFAULT 0 | 逐源计数 |
| `duration_ms` | integer NOT NULL DEFAULT 0 | 逐源耗时 |
| `attempts` | integer NOT NULL DEFAULT 1 | 体现最多 3 次重试 |
| `error_code` / `error_message` | text NULL | 稳定机器码 + 脱敏文案 |

索引：`UNIQUE (run_id, source)`（重试只更新 attempts，不新增行）、`(source, status)`。

## 5. Prisma 等价映射（等效说明）

Prisma schema 用于类型安全读写，**索引与部分索引仍以 DDL 为真源**（`published_at DESC, id DESC` 排序、`WHERE` 部分索引无法在 Prisma schema 中完整表达）。

```prisma
enum Source {
  hacker_news
  arxiv_cs_ai
  jiqizhixin
  @@map("source_enum")
}

enum Category {
  model_release
  research_paper
  product_application
  industry_news
  policy_funding
  @@map("category_enum")
}

enum SummaryStatus {
  ok
  failed
  pending
  @@map("summary_status_enum")
}

model NewsItem {
  id               String        @id
  title            String
  originalTitle    String?       @map("original_title")
  url              String
  normalizedUrl    String        @unique @map("normalized_url")
  titleFingerprint String        @map("title_fingerprint")
  source           Source
  externalId       String?       @map("external_id")
  publishedAt      DateTime      @map("published_at") @db.Timestamp(3)
  summary          String?
  summaryStatus    SummaryStatus @default(pending) @map("summary_status")
  category         Category
  rawExcerpt       String?       @map("raw_excerpt")
  createdAt        DateTime      @default(now()) @map("created_at") @db.Timestamp(3)
  updatedAt        DateTime      @updatedAt @map("updated_at") @db.Timestamp(3)

  @@unique([source, externalId])
  @@index([publishedAt, id])
  @@index([category, publishedAt, id])
  @@index([source, publishedAt])
  @@index([titleFingerprint])
  @@map("news_items")
}
```

`collect_runs` / `collect_run_sources` 同为 `@map` 到 snake_case 列的模型，`trigger_type` 字段名用 `triggerType @map("trigger_type")`。

## 6. 其它约定

- 分类字典（`value` / `label` / `order`）不建表：以 `category_enum` + `src/lib` 常量映射为唯一真源，避免两处漂移。
- 批次日志保留 90 天，按 `run_date` 分批清理（每批 ≤ 1000 行），不使用 `TRUNCATE`。
- 三张表均不得存储令牌、连接串、环境变量或 LLM 凭据。
- 迁移只增不改：新增列必须可空或带常量默认值；删除列拆成「先停写 → 观察 → 独立迁移」。

## 7. 仓储接口

- `NewsRepository`（`src/lib/db/repository.ts`）是唯一写入通道：`insertNews` / `listNews` / `getNewsById` / `saveSummary` / `createRun` / `finishRun` / `saveSourceRun` / `getRun` / `listRuns` / `findSuccessfulRun`。
- 判重语义与索引一致：`normalized_url` 唯一冲突 → `reason=normalized_url`；`(source, external_id)` 冲突 → `reason=external_id`；近 7 天窗口内标题相似度 > 0.9 → `reason=title_similarity`；重复不计入 `inserted`。
- `InMemoryNewsRepository` 为测试与无库环境的等价实现；Postgres 适配器由 `src/lib/db/postgres.ts` 在运行时注入（`setNewsRepository`），未注入时降级为内存实现。
- `summary_status=failed` 的条目照常出现在 `listNews` 结果中，不得过滤。
