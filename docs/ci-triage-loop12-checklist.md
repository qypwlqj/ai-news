# Loop 12 合并前检查表

- [ ] `src/app/page.ts` 默认导出返回 JSX，页面内无 `new Response(`
- [ ] `src/app/news/[id]/page.ts` 默认导出返回 JSX，未命中走 `notFound()`
- [ ] 归一化/相似度只保留一份实现，其余 re-export
- [ ] `titleSimilarity('','') === 0`；仅标点差异 === 1；轻微改写 > 0.9
- [ ] 非 http(s) URL 的处置与 `docs/news-primitives.md` 一致
- [ ] 空集 `totalPages` 与契约一致（并在两处互斥断言间择一）
- [ ] ArXiv `excerpt` 已 `stripHtml`；`maxItems` 顺序固定
- [ ] 摘要按码点截断到 200
- [ ] `api-news.part10` 夹具标题唯一化
- [ ] `npm run typecheck` 通过
- [ ] `npm run build` 通过
- [ ] `npm run test` 通过（含 node:test 与 vitest 两套）
- [ ] 未改动 `.github/`、`deploy/`、`CODEOWNERS`
