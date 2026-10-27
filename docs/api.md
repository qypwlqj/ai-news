# 接口契约（v1）

公开只读接口；唯一需鉴权的是 `POST /api/cron/collect`（`Authorization: Bearer <CRON_SECRET>`，值仅从环境变量注入，任何响应、日志、页面都不得出现明文）。

## 通用约定

- 响应 `application/json; charset=utf-8`；时间一律 ISO8601 UTC 字符串。
- `date=YYYY-MM-DD` 按 Asia/Shanghai 自然日解释，应用层换算为 `[startUtc, endUtc)` 半开区间。
- 统一错误信封：`{ error: { code, message, requestId } }`；`code` 为稳定机器码，`message` 仅供展示。
- 分页：`page` 默认 1，`limit` 默认 20、上限 100；`page/limit/total/totalPages` 语义冻结。
- 兼容规则：只允许新增可选字段与新增枚举值；客户端对未知枚举值降级展示；`summary_status=failed` 的条目必须持续返回。

## GET /api/news

查询参数（全部可选）：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `date` | `YYYY-MM-DD` | 按 Asia/Shanghai 自然日过滤；缺省不做日期过滤 |
| `category` | 5 枚举之一 | `model_release` / `research_paper` / `product_application` / `industry_news` / `policy_funding` |
| `source` | 3 枚举之一 | `hacker_news` / `arxiv_cs_ai` / `jiqizhixin` |
| `page` | integer ≥ 1 | 默认 1 |
| `limit` | integer 1..100 | 默认 20 |

200 响应示例：

```json
{
  "items": [
    {
      "id": "cuid",
      "title": "标题",
      "url": "https://example.com/a",
      "source": "hacker_news",
      "publishedAt": "2025-06-01T00:00:00.000Z",
      "summary": "50–200 字中文摘要",
      "summaryStatus": "ok",
      "category": "model_release",
      "createdAt": "2025-06-01T00:05:00.000Z"
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 42,
  "totalPages": 3,
  "hasNext": true,
  "date": "2025-06-01"
}
```

语义：

- `items` 按 `publishedAt DESC, id DESC` 排序，稳定分页。
- 每条必含 `id/title/url/source/publishedAt/summary/category/summaryStatus`；`summaryStatus=failed` 时 `summary` 为 `null`，但条目必须出现，不得隐藏。
- 错误码：`400 INVALID_DATE`、`400 INVALID_CATEGORY`、`400 INVALID_SOURCE`、`400 INVALID_PAGINATION`、`500 INTERNAL_ERROR`；非法枚举不静默忽略。

## POST /api/cron/collect

外部调度兜底入口，与应用内 node-cron 共用同一服务层。

请求头：`Authorization: Bearer <CRON_SECRET>`（必需）、可选 `Idempotency-Key`。

请求体（可选，空 body 合法）：

```json
{ "date": "2025-06-01", "sources": ["hacker_news", "arxiv_cs_ai", "jiqizhixin"], "force": false }
```

- `date` 缺省为当日 Asia/Shanghai；`sources` 缺省为全部 3 个来源；`force=true` 忽略当日已成功的幂等短路。
- 同步执行一轮采集（含单源重试，`attempts ≤ 3`），超时上限固定 300s。

200 响应（至少一个来源成功，可为 `partial_failure`）：

```json
{
  "runId": "cuid",
  "status": "success",
  "startedAt": "2025-06-01T00:00:00.000Z",
  "finishedAt": "2025-06-01T00:00:42.000Z",
  "durationMs": 42000,
  "date": "2025-06-01",
  "totals": { "fetched": 90, "inserted": 72, "duplicates": 18, "summaryOk": 70, "summaryFailed": 2 },
  "sources": [
    {
      "source": "hacker_news",
      "status": "success",
      "fetched": 30,
      "inserted": 24,
      "duplicates": 6,
      "failed": 0,
      "durationMs": 14000,
      "attempts": 1
    }
  ]
}
```

错误码：`401 UNAUTHORIZED`、`403 FORBIDDEN`、`409 COLLECT_IN_PROGRESS`（并发保护）、`400 INVALID_DATE`、`400 INVALID_SOURCE`、`502 ALL_SOURCES_FAILED`（全部来源失败，响应体结构同上）、`500 INTERNAL_ERROR`。当日已有成功批次且未 `force` → 200 且 `sources` 全部 `status=skipped`。

## 其它端点

| 端点 | 用途 | 主要错误码 |
| --- | --- | --- |
| `GET /api/news/{id}` | 资讯详情 | `404 NEWS_NOT_FOUND` |
| `GET /api/categories` | 5 项 `value/label/order`，前端分类栏不硬编码 | `500 INTERNAL_ERROR` |
| `GET /api/collect-runs` | 批次列表（`date`/`status`/分页） | `400 INVALID_DATE`、`400 INVALID_STATUS` |
| `GET /api/collect-runs/{runId}` | 批次逐源明细 | `404 RUN_NOT_FOUND` |
| `GET /api/health` | 探活，`checks.database` 为 `ok` 或 `error` | `503 SERVICE_UNAVAILABLE` |
