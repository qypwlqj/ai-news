# Loop 13 CI 失败分诊（run #41213645837）

本文件逐项记录 `test` / `typecheck` / `build` 三个 job 的失败、根因定位与处理状态。
**说明：本轮仅完成定位与修复方案，未删除、未跳过任何测试用例；下列所有条目在重新跑 CI 前均为「待验证」。**

## 1. 阻塞项：Next.js 页面组件契约（typecheck + build 双失败）

- 现象：`.next/types/validator.ts` 报 `TS2344`，`src/app/page.ts` 与 `src/app/news/[id]/page.ts` 的默认导出被判定为 `(props) => Promise<Response>`，不满足 `AppPageConfig` 的返回类型 `ReactNode | Promise<ReactNode>`。
- 根因：页面模块直接 `return new Response(html, ...)` 输出 HTML 字符串。Route Handler 允许返回 `Response`，但 App Router 的 `page.*` 必须是 React 组件。
- 约束：路径策略只允许 `js/mjs/cjs/ts/md/txt`，**不能**改成 `.tsx` 绕过（上一候选补丁即因新增 `.tsx` 被拦截）。
- 修复方向：保持 `.ts` 扩展名，把 `renderHomePage` / 详情渲染产出的 HTML 字符串包成 React 元素后返回，例如：
  `return createElement('div', { dangerouslySetInnerHTML: { __html: html } });`
  并把 `searchParams` / `params` 的 `await` 保持在组件内部，不改变既有 URL 参数契约。
- 状态：**待实现**（需先逐字读取两个页面模块原文，再做小块编辑；同时注意详情页 404 分支应返回 `notFound()` 或错误态组件，而不是 `new Response(..., { status: 404 })`）。

## 2. 去重 / 归一化语义分叉（4 个测试文件互斥）

| 测试文件 | 隔离出的语义要求 |
| --- | --- |
| `tests/news-dedup.part1.test.ts` | 根路径保留 `/`；非 http(s) 与非法输入返回 `''`；`titleSimilarity('','')===0` |
| `tests/dedup.part3.test.ts` | `http://Example.com/a/?...` → `https://example.com/a?a=1&b=2`（去尾斜杠、主机小写、参数排序） |
| `tests/spec.part1.test.ts` | 非法值原样返回（`'not a url'`），`ftp://` 原样返回；近似标题相似度 > 0.9 |
| `tests/store.test.ts` | 轻微改写标题相似度 > 0.9 |

- 结论：这四组断言不可能由**同一个** `normalizeUrl` / `titleSimilarity` 实现同时满足，说明它们分别指向不同模块（`src/app/news-dedup.ts`、`src/lib/dedup.ts` 与 `src/lib/normalize.ts` / `src/app/url-normalize.ts` 等）。修复必须**按模块逐个对齐**，禁止把语义收敛到单一实现，也禁止删改测试。
- 相似度阈值：`titleSimilarity` 目前对「轻微改写」给不出 > 0.9 的分数，需在归一化（NFKC + 小写 + 标点转空格 + 压缩空白）之后改用以字符级编辑距离或字符 bigram 相似度计算，并保留空串边界。
- 状态：**待实现**（需按模块读取原文后逐块修改）。

## 3. 分页元数据 `totalPages`

- `tests/api-news.part6.test.ts` 期望缺省查询下 `totalPages >= 1`；node 侧用例又断言空结果 `totalPages === 0`。
- 需在 API 契约文档中明确「空结果为 0」的唯一口径，并让对应实现与该口径一致；两处断言若确实指向同一函数，则属于需要按契约收敛的口径冲突，修复实现前必须先确认归属模块。
- 状态：**待确认 / 待验证**。

## 4. ArXiv 解析器

- `tests/news-collector-jqz.part6.test.ts`：摘要仍带 `<p>` 标签（`stripHtml` 未应用）、`maxItems` 未生效。
- 修复方向：解析 `summary` 后统一走 `stripHtml` 并压缩空白，再按 `maxItems` 截断；XML 非法条目保持跳过。
- 状态：**待实现**。

## 5. 摘要长度约束

- `tests/summarize.part7.test.ts`：超长摘要未被截断到 200 字（实际 60）。需在解析模型输出后按码点截断到 200，并保留 50 字下限校验；超长截断不应降级为 `failed`。
- 状态：**待实现**。

## 6. 未运行 / 待验证清单

- `npm run typecheck`：**未验证**（本轮未改动源码）。
- `npm run build`：**未验证**。
- `npm run test`（vitest 31 个文件 + node 16 个文件）：**未验证**。
- 验收标准 AC1–AC7 均未在本轮重新取证。

## 7. 范围与安全

- 未触碰 `.github/`、`deploy/`、`CODEOWNERS`、`scripts/` 与任何凭据 / 环境变量文件。
- 未新增 `.tsx` 文件（路径策略不允许）。
- 未删除、未跳过、未改写任何既有测试用例。
