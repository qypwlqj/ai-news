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

## 8.1 首页与列表页

- 服务端读仓储：页面在服务端调用 `loadNewsPage()`（`src/lib/db/repository.ts`）取数据，输出时间倒序列表，默认 `limit=20`，首屏不依赖浏览器二次请求（对齐「2s 内渲染 ≥20 条」）。
- 分类筛选：Chip 组取自 `GET /api/categories`，切换后带 `?category=` 重新取数并把 `page` 重置为 1（对齐「切换后 1s 内刷新」）。
- 跳转原文：标题与「跳转原文 ↗」渲染为 `<a target="_blank" rel="noopener noreferrer">`，仅接受 http/https 绝对地址。
- 降级展示：`summaryStatus=failed` 显示「摘要生成失败，可点击标题阅读原文」，`pending` 显示「摘要生成中…」，条目照常可见可点。
- 样式内联（不新增 CSS 依赖）；无结果时展示「该分类今日暂无资讯」。

## 8.2 采集编排模块（src/app/news-collect.ts）

- 可注入 `fetcher` / 时钟 / 仓储 / 加工器：三来源解析（HN Algolia JSON、ArXiv Atom、机器之心 RSS）为纯函数，单测不触网、不连库。
- 逐源失败最多重试 3 次（`attempts` 记录实际次数）；全部来源失败时返回 `httpStatus=502`（对外映射 `502 ALL_SOURCES_FAILED`），部分失败仍为 200 且 `status=partial_failure`。
- 当日已有成功批次且未 `force` → 逐源 `skipped` 的幂等短路；`error.message` 写入前脱敏并截断（≤ 2000 字）。
- 机器之心 feed 地址、HN 关键词与条数上限全部配置化，默认配置不含任何凭据。

## 8.3 来源适配器（src/app/news-sources.ts）

- `parseHackerNews` / `parseArxivAtom` / `parseRssFeed` 为纯解析函数（HN Algolia JSON、ArXiv Atom、RSS/Atom），`collectHackerNews` / `collectArxiv` / `collectJiqizhixin` 接收注入的 `fetcher`，`createSourceCollectors` 按来源装配，重试与互斥仍由编排层负责。
- 端点、关键词（`DEFAULT_AI_KEYWORDS`）与条数上限全部来自 `SourceConfig`/`DEFAULT_SOURCE_CONFIG`，不读取环境变量、不含任何凭据；输出统一为 `RawNewsItem`（`publishedAt` 为 UTC `Date`，`rawExcerpt` 截断 ≤ 2000 字）。

## 8.5 采集器基础层（src/app/news-collectors.ts）

- `COLLECTOR_SOURCE_VALUES` 与 `source_enum` 三值对齐；`Collector` 契约（`source` + `fetchItems(fetcher)`）供三个来源适配器实现。
- `fetchText(fetcher, url, options)`：注入式 fetcher，超时（默认 10000ms）+ 最多 3 次重试，失败返回脱敏 `errorCode`（`FETCH_TIMEOUT` / `FETCH_HTTP_ERROR` / `FETCH_FAILED` / `FETCH_INVALID_PAYLOAD`）。
- `createHackerNewsCollector`：Algolia `search_by_date`，关键词（`isAiRelatedTitle` 词边界匹配）+ 热度阈值（默认 20）过滤，输出 `externalId/title/url/publishedAt/rawExcerpt`（截断 ≤ 2000 字）。

## 8.4 摘要模块（src/app/news-summarize.ts）

- `summarizeNewsItem(input, deps)` / `createSummarizer(deps)` 为纯函数 + 注入式模型调用（模型客户端由 `src/lib` 提供），不读环境变量、不发网络请求。
- 成功判定：摘要 50–200 字（超长截断至 200）；分类经 `coerceCategory` 归一（含中文别名），非法或缺失兜底 `industry_news`。
- 失败 / 超时（默认 8000ms，可注入）/ 摘要过短 / 未配置 caller 一律 `summaryStatus=failed`、`summary=null`，返回 `errorCode`（`SUMMARY_UNAVAILABLE` / `SUMMARY_TIMEOUT` / `SUMMARY_INVALID_LENGTH`），不抛错、不中断批次；`errorMessage` 截断 ≤200 字并脱敏。

## 8.6 LLM 客户端（src/app/news-llm.ts）

- `createLlmCaller(config, { fetchImpl })`：endpoint / model / apiKey 全部以配置注入（不读环境变量、不内置凭据），`fetch` 由调用方提供，测试不触网；返回 `ModelSummarizer` 供 `summarizeNewsItem` 的 `callModel` 使用。
- `buildSummaryPrompt` 固定「50–200 字中文摘要 + 5 类固定枚举」提示词；`parseModelPayload` 解析模型 JSON（容忍代码块包裹），分类归一与非法兜底 `industry_news` 仍由 `news-summarize.ts` 负责。
- 失败抛出带稳定 `code` 的 `LlmError`（`LLM_NOT_CONFIGURED` / `LLM_REQUEST_FAILED` / `LLM_HTTP_ERROR` / `LLM_INVALID_RESPONSE`），文案脱敏截断且不含凭据；`summarizeNewsItem` 捕获后降级 `summary=null` + `summaryStatus=failed` 并保留该 code，不中断批次。

## 8.7 入库去重与批次日志（src/app/news-persist.ts / news-runs.ts）

- `persistNewsItem` / `persistNewsBatch`：`INSERT ... ON CONFLICT (normalized_url) DO NOTHING` 硬去重（冲突计 `duplicates`），写入前用 `title_fingerprint` + 近 7 天窗口取候选做相似度 > 0.9 软去重；`updateNewsSummary` 回填摘要与 `summary_status`（`failed` 写 `NULL`）。
- `createCollectRun` / `finishCollectRun` / `saveSourceRun`：先写批次占位行 → 回填 `finished_at` / `duration_ms` / `totals`；逐源 `ON CONFLICT (run_id, source) DO UPDATE` 只更新计数与 `attempts`，`error_message` 经 `sanitizeMessage` 脱敏并截断 ≤ 2000 字。
- 两个模块都只依赖注入的 `{ query(sql, params) }`，不建连接、不读环境变量、不发网络请求。

## 9. 边界

- 不含账号/收藏、评论点赞、个性化推荐、多语言、原生 App、付费与广告、后台 CMS。
- 微信小程序为二期，复用同一 `GET /api/news` 字段集合，不新增私有字段。
