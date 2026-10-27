# ai-news

每日自动汇总 AI 资讯：定时从 Hacker News（AI 相关）、ArXiv cs.AI、机器之心 RSS 采集，经 LLM 生成 50–200 字中文摘要与 5 类固定标签，在 Web 端按时间倒序 + 分类筛选浏览。

## 目标

取代手动刷多个站点：一天一次采集，一页看完当日 AI 资讯。

## 技术栈

- Next.js 16（App Router / Route Handlers）+ TypeScript（严格类型）
- Tailwind CSS（列表页与筛选栏样式）
- Postgres + Prisma（数据模型与索引见 `docs/data-model.md`）
- 应用内 `node-cron` 每日 08:00（Asia/Shanghai）触发采集；`POST /api/cron/collect` 供外部调度兜底

## 模块分层

| 目录 | 职责 |
| --- | --- |
| `src/app/api/**` | Route Handler：参数校验、统一错误信封、调用服务层，不含业务规则 |
| `src/lib/collect.ts` | 采集编排：抢锁、逐源抓取、去重、入库、汇总批次日志 |
| `src/lib/sources/**` | 三个来源适配器，统一输出 `RawNewsItem`；来源判定与配置化参数在此 |
| `src/lib/summarize.ts` / `src/lib/llm.ts` | 摘要与分类加工，失败降级为 `summary_status=failed` 不阻塞批次 |
| `src/lib/dedup.ts` | URL 规范化与标题指纹、相似度判定 |
| `src/lib/query.ts` | 列表查询：日期/分类/分页与排序 |
| `src/lib/db/**` | DDL、连接与仓储（唯一写入通道），无业务编排 |
| `src/lib/schedule.ts` | node-cron 注册，与 HTTP 触发共用同一服务层 |
| `docs/` | 架构、数据模型、接口、运维手册 |

## 约束

- 只读公开接口，仅 `POST /api/cron/collect` 需要 `Authorization: Bearer <CRON_SECRET>`；任何响应、日志、页面都不得出现令牌、连接串或环境变量值。
- 首版仅中文界面与中文摘要；不含账号、评论、推荐、广告、CMS。
- 不修改 `.github/`、`deploy/`、`CODEOWNERS` 等治理与 CI 文件。

## 文档

- [架构说明](docs/architecture.md)
- [数据模型](docs/data-model.md)
- 接口契约、运维手册与示例（后续补充于 `docs/`、`examples/`）

## 测试

单元测试位于 `tests/`，覆盖去重、来源解析、摘要降级、采集编排、查询分页与定时注册；不依赖真实网络与数据库。
