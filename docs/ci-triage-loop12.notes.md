# Loop 12 附：失败项 ↔ 文件对照速查

| 失败 | 首个报错位置 | 需改动文件（预期） |
| --- | --- | --- |
| build / typecheck | `.next/types/validator.ts`（由 `src/app/page`、`src/app/news/[id]/page` 默认导出签名触发） | `src/app/page.ts`、`src/app/news/[id]/page.ts` |
| `news-dedup.part1` / `dedup.part3` / `spec.part1` / `store` | `normalizeUrl`、`titleSimilarity` | 归一化与相似度的唯一实现文件 + 其余为 re-export |
| `api-news.part6` | `body.totalPages` | 列表查询的分页元数据计算 |
| `api-news.part10` | `seeded` 的 `inserted` 断言 | 测试夹具（标题唯一化） |
| `news-collector-jqz.part6` | `excerpt` 含 `<p>`、`maxItems` 偏移 | ArXiv 解析函数 |
| `summarize.part7` | 期望 200、实得 60 | 摘要长度校验/截断 |

对照速查本身不改变运行行为；运行时以 `npm run typecheck && npm run build && npm run test` 结果为准。
