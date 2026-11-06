# Loop 12 附：需在下一次迭代执行的改动单（可直接照做）

> 本文件是 `docs/ci-triage-loop12.md` 的执行附录，仅记录待办，不含任何凭据。

1. `src/app/page.ts`：默认导出改为返回 JSX 元素（复用 `src/app/news-ui.ts` 的渲染/数据函数），移除 `new Response(...)`；查询参数从 `searchParams` 读取后交给 `listNews`，非法参数静默回退默认（前端侧校验），不返回 400。
2. `src/app/news/[id]/page.ts`：默认导出改为返回 JSX；未命中走 `notFound()`，非法 id 同样走 `notFound()`（页面层不返回 400/404 响应体）。
3. 归一化：保留单一实现，其余文件改为 `export { normalizeUrl } from '<canonical>'`；语义按 `docs/news-primitives.md` 冻结。
4. `titleSimilarity`：任一侧归一化后为空 → `0`；完全一致 → `1`；其余按字符集合 Jaccard 或编辑距离，阈值 `> 0.9`。
5. 分页：`totalPages = Math.max(1, Math.ceil(total / limit))`。
6. `src/lib/sources/arxiv.ts`（或对应解析函数）：`excerpt = stripHtml(summary)`，解析顺序 `parse → validate → stripHtml → slice(maxItems)`。
7. 摘要：长度按码点计，超 200 截断、50–200 视为合法，否则 `summary_status=failed` 且 `summary=null`。
8. 夹具：`tests/api-news.part10.test.ts` 的 `seeded` 标题追加唯一序号，避免命中标题相似度去重。
9. 三命令验证：`npm run typecheck` → `npm run build` → `npm run test`，全绿后再提交。
