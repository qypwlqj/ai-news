# 数据库结构（幂等 DDL）

DDL 真源：`src/app/news-schema.ts`（`SCHEMA_STATEMENTS` / `applySchema()` / `schemaSql()`）。列级说明与 Prisma 映射见 `docs/data-model.md`，冻结 DDL 速览见 `docs/spec.md`。

## 1. 幂等策略

| 对象 | 语句 | 幂等方式 |
| --- | --- | --- |
| 表 | `CREATE TABLE` | `IF NOT EXISTS` |
| 索引 | `CREATE [UNIQUE] INDEX` | `IF NOT EXISTS` |
| 枚举类型 | `CREATE TYPE ... AS ENUM` | `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` |
| 枚举取值 | `ALTER TYPE ... ADD VALUE` | `IF NOT EXISTS`（PG12+ 可在事务内执行，提交后新值才可用） |

整段可重复执行（迁移重放 / 启动自检），不含 `DROP`、`TRUNCATE`。删除列或删枚举值必须拆成独立迁移。

## 2. 执行方式

```ts
import { applySchema } from '../src/app/news-schema';

await applySchema({ query: (sql) => pool.query(sql) }); // 逐条执行，任一条失败即抛出
```

- 顺序固定：枚举 → `news_items` → 其索引 → `collect_runs` → 其索引 → `collect_run_sources` → 其索引。
- 执行器由调用方注入（`{ query(sql) }`），本模块不建连接、不读环境变量、不发网络请求。
- 需要人工执行时用 `schemaSql()` 取完整 SQL 文本粘贴到运维窗口。

## 3. 索引与用途

| 索引 | 用途 |
| --- | --- |
| `news_items_normalized_url_uidx`（UNIQUE） | URL 硬去重，冲突计入 `duplicates` |
| `news_items_source_external_id_uidx`（UNIQUE） | 来源内幂等（`external_id` 为 NULL 不冲突） |
| `news_items_published_at_idx` `(published_at DESC, id DESC)` | 首页时间倒序 + 稳定分页 |
| `news_items_category_published_at_idx` `(category, published_at DESC, id DESC)` | 分类筛选 + 时间倒序 |
| `news_items_source_published_at_idx` | 来源维度回溯与单日条数统计 |
| `news_items_title_fingerprint_published_at_idx` | 标题指纹近重复候选检索（近 7 天窗口） |
| `news_items_summary_status_partial_idx` `WHERE summary_status <> 'ok'` | 摘要补偿任务，避免全表扫描 |
| `collect_runs_run_date_status_idx` `(run_date, status, finished_at DESC)` | 幂等短路与按日筛选 |
| `collect_runs_started_at_idx` / `collect_runs_status_started_at_idx` | 批次日志默认倒序分页与按状态排障 |
| `collect_run_sources_run_id_source_uidx`（UNIQUE） | 同批次同来源仅一行，重试只更新 `attempts` |
| `collect_run_sources_source_status_idx` | 按来源统计成功率与失败原因分布 |

## 4. 演进与回滚

- 枚举只加不删不改名；客户端对未知值降级展示。
- 新增列须可空或带常量默认值（PG11+ 不重写表）；`NOT NULL`/`CHECK` 先 `ADD ... NOT VALID` 再 `VALIDATE`。
- 大表（已有量级）建索引用 `CREATE INDEX CONCURRENTLY`，需在事务外、低峰维护窗口手工执行，仓库只记录脚本。
- 上线后回滚只回滚应用版本、保留新表新结构；严禁 `TRUNCATE`，数据清理按 `run_date` 分批 `DELETE`（每批 ≤ 1000 行）。

## 5. 测试

`tests/news-schema.test.ts` 校验：表/索引全部 `IF NOT EXISTS`、枚举 `duplicate_object` 守护与逐值追加、索引名与键列（去重键、指纹+时间、分类+时间、部分索引 `WHERE`）、无 `DROP`/`TRUNCATE`、`applySchema` 顺序执行与可重放、失败即中断。
