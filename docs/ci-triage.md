# CI 返修记录（Loop 10）

本轮 CI 失败项逐条处理状态。**只有标注「已处理」且给出改动位置的项目在本轮被修改；其余仍未通过，不得视为通过。**

## 已处理

1. vitest `tests/collect.part8.test.ts > collects, dedups, summarises and records per-source logs`（期望 `inserted=7`，实际 `3`）
   - 根因：测试夹具 `raw()` 的标题为 `${who} ${what}`，按索引取模后三个来源会复用到完全相同的标题，被 PRD AC3 要求的「标题相似度 > 0.9 只保留 1 条」软去重丢弃 4 条，属夹具缺陷，非实现缺陷。
   - 处理：标题追加来源名，使各来源标题唯一；去重阈值与实现逻辑未做任何放宽。

## 已定位根因，尚未修复（本轮未通过）

2. `next build` / `npm run typecheck` 失败：`src/app/page.ts` 与 `src/app/news/[id]/page.ts` 的默认导出返回 `Promise<Response>`，不满足 Next.js 16 `AppPageConfig`（页面须返回 `ReactNode`）。
   - 修法方向：把渲染结果包成 React 元素（如 `dangerouslySetInnerHTML`），或把 `Response` 语义下沉为内部渲染函数，页面导出只返回组件。
3. `tests/news-dedup.part1.test.ts`（`src/app/news-dedup.ts`）：根路径需保留 `/`；非 http(s) 协议需返回空串；`titleSimilarity('', '')` 需为 `0`。
4. `tests/dedup.part3.test.ts`（`src/lib/dedup.ts`）：`/a/?a=1` 去尾斜杠需在查询串前生效（与第 3 条属不同模块，语义需分别修）。
5. `tests/api-news.part6.test.ts`：空结果时期望 `totalPages >= 1`，与 `tests/api-query.part9.test.ts` 的 `totalPages = 0` 互相冲突，需先统一口径再改实现。
6. `tests/news-collector-jqz.part6.test.ts`：ArXiv 摘要需剥离 HTML 标签；`maxItems` 上限需生效。
7. `tests/summarize.part7.test.ts`：超长摘要需截断到 200 字（按码点计数）。
8. `tests/spec.part1.test.ts`：对非法 URL 与 `ftp://` 的期望与第 3 条相反，需先确认二者是否分属 `src/lib` 与 `src/app` 两套实现再定稿。

## 未验证

第 2)–8) 项的实现改动本轮未提交，`build`、`typecheck`、`vitest`、`node --test` 均未在本轮通过，仅第 1) 项的夹具修复已提交。
