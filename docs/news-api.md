# 查询接口说明（GET /api/news）

本文件记录列表查询的参数语义、错误码、响应字段契约与依赖索引，是 `docs/api.md` 的查询层补充说明。不执行任何 DDL，也不涉及 `.github/`、`deploy/`、`CODEOWNERS` 等治理与 CI 文件。

## 1. 参数语义

| 参数 | 类型 | 默认 | 语义 |
| --- | --- | --- | --- |
| `date` | `YYYY-MM-DD` | 无 | 按 **Asia/Shanghai 自然日**解释，换算为 UTC 半开区间 `[startUtc, endUtc)` |
| `category` | 5 枚举之一 | 无 | `model_release` / `research_paper` / `product_application` / `industry_news` / `policy_funding` |
| `source` | 3 枚举之一 | 无 | `hacker_news` / `arxiv_cs_ai` / `jiqizhixin` |
| `page` | 整数 ≥ 1 | `1` | 页码 |
| `limit` | 整数 1..100 | `20` | 每页条数；UI 不暴露修改入口 |

规则：

- 严格校验：格式错误、未知枚举、分页越界一律 400，**不静默忽略、不自动纠正、不做模糊匹配**，未知值不会被当成「全部」。
- 缺省参数不做该维度过滤（`date` 缺省 = 不限日期，`category` 缺省 = 全部 5 类）。
- 默认 `limit=20` 为契约冻结值，二期微信小程序复用同一语义。

## 2. date 的时区换算

`date=2025-06-01` 表示上海时间 2025-06-01 全天，等价于 UTC 半开区间：

```
startUtc = 2025-05-31T16:00:00.000Z   （含）
endUtc   = 2025-06-01T16:00:00.000Z   （不含）
```

仓储层查询条件为 `published_at >= $startUtc AND published_at < $endUtc`（半开区间避免同日边界重复计数）。`published_at` 一律按 UTC 存储；`collect_runs.run_date` 是 `date` 类型，天然不受时区影响。

## 3. 错误码

非 2xx 统一信封：`{ error: { code, message, requestId } }`，`code` 为稳定机器码，`message` 仅展示且已脱敏截断，`requestId` 供排障关联。

| 状态码 | code | 触发条件 |
| --- | --- | --- |
| 400 | `INVALID_DATE` | `date` 非 `YYYY-MM-DD` 或不存在该日 |
| 400 | `INVALID_CATEGORY` | `category` 不在 5 枚举内 |
| 400 | `INVALID_SOURCE` | `source` 不在 3 枚举内 |
| 400 | `INVALID_PAGINATION` | `page < 1`、非整数，或 `limit` 越出 1..100 |
| 500 | `INTERNAL_ERROR` | 未预期错误（不回显堆栈、SQL、连接串或环境变量） |

分类字典以 `src/app/news-api-types.ts` 的 `CATEGORY_DICTIONARY`（`value`/`label`/`order`）为唯一真源，校验走 `isCategoryValue`，展示走 `categoryLabel`（未知值降级为原值文本 + 中性样式）。

## 4. 响应字段契约

```json
{
  "items": [
    {
      "id": "cuid",
      "title": "标题",
      "url": "https://example.com/a",
      "source": "hacker_news",
      "publishedAt": "2025-06-01T00:00:00.000Z",
      "summary": null,
      "category": "industry_news",
      "summaryStatus": "failed"
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

- `items` 每项必含 `id`、`title`、`url`（绝对 URL）、`source`、`publishedAt`（ISO8601 UTC）、`summary`（`string | null`）、`category`、`summaryStatus`（`ok | failed | pending`）。
- `summaryStatus=failed` 时 `summary` 为 `null`，但条目**必须**出现在 `items` 中并计入 `total`，不得隐藏、置灰或扣除（AC5）。
- 排序固定 `publishedAt DESC, id DESC`（`id` 作 tie-breaker 保证稳定分页）。
- 分页元数据：`totalPages = Math.max(1, Math.ceil(total / limit))`，`hasNext = page < totalPages`；`date` 回显生效的日期过滤，未传为 `null`。
- 无结果返回 200 + `items: []`（空数组不是错误）。

## 5. 依赖索引

| 索引 | 支撑场景 |
| --- | --- |
| `news_items_published_at_idx (published_at DESC, id DESC)` | 无筛选的时间倒序列表与稳定分页，排序键与索引同序避免额外 sort |
| `news_items_category_published_at_idx (category, published_at DESC, id DESC)` | 分类筛选 + 时间倒序，支撑「切分类 1s 内刷新」（AC7） |
| `news_items_source_published_at_idx (source, published_at DESC)` | 来源维度回溯与单来源单日条数统计（AC2） |
| `news_items_normalized_url_uidx (normalized_url)` | 写入侧硬去重，保证列表不返回重复条目（AC3） |

目标：`GET /api/news` P95 < 300ms，支撑首页 2s 内渲染 ≥ 20 条；表结构见 `docs/database.md`、`docs/data-model.md`。

## 6. 客户端降级

- 未知枚举值（`category`/`source`/`summaryStatus`）降级为原值文本 + 中性样式，不报错、不隐藏条目。
- `summaryStatus=pending` 显示「摘要生成中…」，`failed` 显示「摘要生成失败，可点击标题阅读原文」，两种情形卡片仍完整可点。
- 错误态只展示脱敏后的 `error.message` 与 `requestId`，不展示堆栈、SQL、连接串或环境变量。

## 7. 测试覆盖

`tests/news-query.test.ts` 覆盖：默认 `page=1` / `limit=20`、合法参数透传、非法 `date`/`category`/分页被拒绝（对应 400）、分类枚举固定 5 项与顺序、未知枚举降级为原值文本。查询层不依赖真实网络与数据库。
