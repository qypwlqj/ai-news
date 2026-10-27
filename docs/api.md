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

## GET /api/news/{id}

路径参数 `id`（必填，非空标识）；无查询参数、无请求体。

```json
{
  "id": "cuid",
  "title": "标题",
  "originalTitle": "Original title",
  "url": "https://example.com/a",
  "source": "hacker_news",
  "publishedAt": "2025-06-01T00:00:00.000Z",
  "summary": null,
  "category": "industry_news",
  "summaryStatus": "failed",
  "rawExcerpt": "截断脱敏后的原文片段",
  "titleFingerprint": "1a2b3c4d",
  "createdAt": "2025-06-01T00:05:00.000Z",
  "updatedAt": "2025-06-01T00:06:00.000Z"
}
```

- 只读展示，不含评论/点赞/收藏字段；`summaryStatus=failed` 时 `summary` 为 `null`，详情照常 200。
- 静态子路径（如 `/api/categories`）优先于动态路由匹配，不会被吞并。
- 错误码：`400 INVALID_ID`、`404 NEWS_NOT_FOUND`、`500 INTERNAL_ERROR`。

## GET /api/categories

无参数、无请求体；分类 Chip 的 `label`/`order` 唯一来源，前端不得硬编码。

```json
{ "items": [ { "value": "model_release", "label": "模型发布", "order": 1 } ] }
```

固定 5 项且顺序稳定：`model_release`（模型发布）、`research_paper`（研究论文）、`product_application`（产品应用）、`industry_news`（行业动态）、`policy_funding`（政策融资）。错误码：`500 INTERNAL_ERROR`。

## GET /api/collect-runs

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `date` | `YYYY-MM-DD` | Asia/Shanghai 自然日 |
| `status` | `success` / `partial_failure` / `failed` | 批次状态 |
| `page` | integer ≥ 1 | 默认 1 |
| `limit` | integer 1..100 | 默认 20 |

200 响应：`{ items: [{ runId, trigger, date, status, startedAt, finishedAt, durationMs, totals }], page, limit, total, totalPages }`，`totals` 为 `{ fetched, inserted, duplicates, summaryOk, summaryFailed }`；默认按 `startedAt DESC`（由仓储负责排序）。错误码：`400 INVALID_DATE`、`400 INVALID_STATUS`、`400 INVALID_PAGINATION`、`500 INTERNAL_ERROR`。

## GET /api/collect-runs/{runId}

路径参数 `runId`（必填）。

200 响应：`{ runId, trigger, date, status, startedAt, finishedAt, durationMs, totals, sources: [{ source, status, fetched, inserted, duplicates, failed, durationMs, attempts, error?: { code, message } }] }`。逐源唯一键 `(run_id, source)`，重试只更新 `attempts`；`error.message` 截断（≤ 2000 字）脱敏后展示，不含令牌与连接串。错误码：`400 INVALID_RUN_ID`、`404 RUN_NOT_FOUND`、`500 INTERNAL_ERROR`。

## GET /api/health

无参数、无请求体。

```json
{ "status": "ok", "time": "2025-06-01T00:00:00.000Z", "checks": { "database": "ok" } }
```

`checks.database=error` 时返回 503 且 `status=degraded`；不返回配置、版本凭据或环境变量。错误码：`500 INTERNAL_ERROR`、`503 SERVICE_UNAVAILABLE`。

## 兼容性规则（二期小程序复用依据）

1. `GET /api/news` 的 `id/title/url/source/publishedAt/summary/category` 必返，二期微信小程序直接复用，不新增 Web 私有字段。
2. 响应字段只增不删、不改名、不改类型与语义；新增字段一律可选，客户端须容忍缺失。
3. 枚举只追加不删除不改名；客户端遇未知值降级为原值文本 + 中性样式，不报错不隐藏条目。
4. 分页 `page/limit/total/totalPages` 语义冻结，默认 `limit=20` 不得变更。
5. `summaryStatus=failed` 的条目长期返回，不得因加工失败被过滤。
6. 时间一律 ISO8601 UTC 传输；`date` 参数按 Asia/Shanghai 自然日解释为半开区间。
7. 错误统一信封 `{ error: { code, message, requestId } }`，`code` 为稳定机器码；`502`/`409` 状态码语义发布后不得改变。
8. 采集幂等与重试：当日已有 `success`/`partial_failure` 且未 `force` → 200 且 `sources` 全部 `skipped`；单源失败重试 `attempts ≤ 3`；全源失败返回 502（响应体结构不变）。
