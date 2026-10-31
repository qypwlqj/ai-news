# Loop 12 与验收标准的回归影响

修复本轮的 6 项根因后，需复核以下验收点未被削弱：

- AC2（三来源单日 ≥20 条、日志含来源/条数/耗时）：改 arxiv 解析顺序后，逐源 `fetched` 计数需与实际入库数一致。
- AC3（重复率 < 1%）：归一化语义一旦变更，历史 `normalized_url` 的去重口径随之变化；不改阈值、不改唯一索引，只改归一化实现本身。
- AC4（category 5 枚举、summary 50–200 字）：截断改按码点后，200 码点仍属合法区间。
- AC5（LLM 失败降级）：`summary_status=failed` 的条目必须仍出现在列表与详情，且 `summary=null`，不得因本轮改动被过滤。
- AC6（`GET /api/news` 默认 `limit=20`、字段齐全）：改 `totalPages` 不得影响 `items`/`total`/`hasNext` 语义。
- AC7（首页 2s ≥20 条、切分类 1s 刷新）：页面从返回 `Response` 改为返回 JSX 后，服务端直出路径必须仍然一次渲染出 ≥20 条，避免退化为二次请求。
