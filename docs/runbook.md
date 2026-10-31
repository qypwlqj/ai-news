# 运维手册（一期）

## 1. 定时与兜底

- 应用内 `node-cron` 表达式 `0 8 * * *`，`timeZone: Asia/Shanghai`，触发 `trigger=cron` 批次；与 HTTP 触发共用 `src/lib/collect.ts` 同一服务函数。
- 外部调度（平台定时器、CI、人工补采）调用 `POST /api/cron/collect`，触发 `trigger=api` 批次。请求头携带 `Authorization: Bearer <CRON_SECRET>`，值来自环境变量，不入库、不落日志、不写进工单。
- 批次互斥：`pg_try_advisory_lock(hashtext('news_collect:' || run_date))`，冲突返回 `409 COLLECT_IN_PROGRESS`，等下一轮，不要并发重试。
- 幂等：当日已有 `success`/`partial_failure` 且未带 `force` 时返回 `sources` 全 `skipped`；确需重跑加 `force=true`，历史批次保留不覆盖。
- 单源失败自动重试，最多 3 次，实际次数见 `sources[].attempts`。

## 2. 日志查看

- 批次列表：`GET /api/collect-runs?date=YYYY-MM-DD&status=success|partial_failure|failed&page=1`。
- 单批明细：`GET /api/collect-runs/{runId}`，逐源含 `fetched/inserted/duplicates/failed/durationMs/attempts` 与 `error.code`、`error.message`（写入前截断 ≤ 2000 字并脱敏）。
- 验收口径：每个来源单日 `inserted ≥ 20`；日志必须能回答「来源名、抓取条数、耗时」三问；连续 7 天每天至少 1 个成功批次。

## 3. 常见故障处置

| 现象 | 判断 | 处置 |
| --- | --- | --- |
| 401 / 403 | 令牌缺失或不匹配 | 由调度方确认环境变量注入，禁止把值写进仓库或日志 |
| 409 COLLECT_IN_PROGRESS | 有批次在跑 | 等待，勿并发重试 |
| 502 ALL_SOURCES_FAILED | 三源全失败 | 看 `sources[].error.code`；先收窄 `sources` 保通，再修适配器 |
| 某来源 inserted 长期偏低 | 抓取规则或去重过严 | 核对来源适配器配置与标题相似度阈值（> 0.9 判重） |
| summaryFailed 偏高 | LLM 超时或报错 | 条目仍入库、接口照常返回；由补偿任务重跑 `summary_status <> 'ok'` |
| GET /api/news 变慢 | 索引缺失或数据量增长 | 核对 `docs/data-model.md` 索引；大表按维护窗口手工 `CREATE INDEX CONCURRENTLY` |

## 4. 已知待确认项（不阻塞上线，均配置化）

- 机器之心 RSS 具体 feed 地址需求未给出，由配置提供。
- LLM 服务商与模型型号未定，凭据仅从环境变量读取；失败即降级 `summary_status=failed`，批次不中断。
- Hacker News「AI 相关」判定口径未定（关键词 / 板块标签 / 热度阈值），先按关键词配置化实现。
- 采集日志仅落库为 `collect_runs` + `collect_run_sources` 两张表，不额外写文件日志。

## 5. 回滚要点

- 优先回滚应用版本，保留新增表与枚举：旧代码不读写新表新列即可正常启动。
- 已有数据时严禁 `DROP TABLE` / `TRUNCATE`；单列回退拆成独立迁移。
- 唯一索引引发写入异常时，先收窄 `sources` 保批次可用，再修归一化逻辑，不删唯一索引。
