# 架构说明（一期）

## 1. 分层

```
src/app/api/**           Route Handler（HTTP 边界）
      │  参数校验 → 统一错误信封 { error: { code, message, requestId } }
      ▼
src/lib/collect.ts       采集编排（服务层）
src/lib/query.ts         查询服务（列表）
src/lib/summarize.ts     LLM 加工与降级
src/lib/dedup.ts         规范化与判重
src/lib/sources/**       来源适配器（HN / arXiv / 机器之心）
      ▼
src/lib/db/**            DDL + 仓储（唯一 SQL 写入点）
      ▼
Postgres
```

原则：

- 业务规则只写在 `src/lib`，Route Handler 只做参数解析、错误映射与序列化。
- 仓储层不承载采集逻辑；编排层不拼 SQL。
- 应用内 `node-cron` 与 `POST /api/cron/collect` 调用**同一个**服务函数，保证外部调度可独立跑通。

## 2. 采集流程

1. 计算目标日期（默认当日 Asia/Shanghai）→ 选来源（默认 3 个）。
2. `pg_try_advisory_lock(hashtext('news_collect:' || run_date))` 抢锁；冲突返回 `409 COLLECT_IN_PROGRESS`。
3. 幂等短路：当日已有 `success`/`partial_failure` 批次且未 `force` → 返回 200，`sources` 全部 `skipped`。
4. 先写 `collect_runs` 记录（终态前占位），再逐源执行：抓取 → 规范化 URL → 入库去重 → 摘要加工。
5. 每个来源写一行 `collect_run_sources`（唯一键 `(run_id, source)`），单源失败重试，`attempts ≤ 3`。
6. 汇总 `totals`、回填 `finished_at` / `duration_ms`；至少一个来源成功即 200（`partial_failure`），全失败 502。

## 3. 去重策略

- 硬去重：`normalized_url` 唯一索引，写入冲突计入 `duplicates`。
- 软去重：`title_fingerprint` + 近 7 天窗口缩小候选，应用层按归一化串相似度 > 0.9 判为重复。
- 重复条目不计入 `inserted`，接口层不返回。

## 4. 摘要降级

- 采集入库时 `summary_status=pending`；LLM 成功写 `summary`、`status=ok`。
- LLM 失败/超时：`status=failed`、`summary=NULL`，条目保留，批次继续。
- `GET /api/news` 必须返回 `failed` 条目（`summary` 降级为空串/null），前端展示占位文案并保留原文链接。
- 分类兜底：模型未给出 5 个枚举之一时落 `industry_news`，保证 `category` 命中率 100%。

## 5. 时间语义

- `published_at`、`started_at` 等统一以 UTC 存储。
- 查询参数 `date=YYYY-MM-DD` 按 **Asia/Shanghai 自然日**解释，应用层换算为 `[startUtc, endUtc)` 半开区间。
- `collect_runs.run_date` 为 `date` 类型，天然不受时区影响。

## 6. 调度

- `src/lib/schedule.ts` 在进程启动时注册 `node-cron`（`0 8 * * *`，`timeZone: 'Asia/Shanghai'`），触发 `trigger='cron'` 批次。
- `POST /api/cron/collect` 触发 `trigger='api'` 批次，用于外部调度兜底与补采。
- 单次同步执行，超时上限在实现中固定（300s）。

## 7. 可观测

- 采集日志落库：`collect_runs`（批次汇总）+ `collect_run_sources`（逐源：来源、条数、耗时、失败原因、重试次数）。
- 对外只读查询：`GET /api/collect-runs`、`GET /api/collect-runs/{runId}`。
- `error_message`/`raw_excerpt` 写入前截断（≤ 2000 字）并脱敏，严禁落库任何凭据。

## 8. 性能口径

- 列表排序键 `(published_at DESC, id DESC)`，复合索引同序建立，避免额外排序。
- 目标：`GET /api/news` P95 < 300ms，支撑首页 2s 内渲染 ≥ 20 条、切分类 1s 内刷新。
- `limit` 上限 100，默认 20。

## 9. 边界

- 不含账号/收藏、评论点赞、个性化推荐、多语言、原生 App、付费与广告、后台 CMS。
- 微信小程序为二期，复用同一 `GET /api/news` 字段集合，不新增私有字段。
