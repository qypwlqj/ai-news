# CI 失败分诊（Loop 12，run #41208606664）

本文件只做**失败定位与处置结论**记录，不宣称任何未在本机运行过的检查已通过。

结论一句话：三个 job 全部失败，可归为 **2 个根因族 + 4 个独立断言偏差**；其中「归一化/相似度」根因存在**多份互相冲突的实现与互相冲突的测试期望**，必须先冻结唯一语义再改代码，否则任一侧修好会打爆另一侧。

## 1. build / typecheck（同一根因，必先修）

```
.next/types/validator.ts: Type 'typeof import("src/app/page")' does not satisfy 'AppPageConfig<"/">'
.next/types/validator.ts: Type 'typeof import("src/app/news/[id]/page")' does not satisfy 'AppPageConfig<"/news/[id]">'
  Type '({...}) => Promise<Response>' is not assignable to 'ComponentType<any>'
```

- 根因：`src/app/page.ts` 与 `src/app/news/[id]/page.ts` 的**默认导出返回 `Promise<Response>`**（把 App Router 的 page 当成了 Route Handler 写）。Next.js 16 的 page 契约要求默认导出返回 `ReactNode`/`Promise<ReactNode>`，因此 `next typegen` 生成的类型校验直接失败；`next build` 因同一个 validator 也失败。
- 处置：两个文件都改为**返回 JSX**。已有的 HTML 渲染层（`src/app/news-ui.ts` 的 `renderHomePage` / `newsCardHtml` 等）不要丢，改为在 page 内返回元素（例如直接把渲染结果作为组件树使用，或用其数据函数 + 组件渲染），**不要**在 page 里 `new Response(...)`。
- 404 场景不要 `new Response(..., { status: 404 })`，用 `notFound()`（已有 `src/app/not-found.tsx`）或 `notFound` 兜底；错误场景不要返回 5xx 响应体，交给页面内 StateBlock 渲染（设计稿「错误态与空态」已定义）。
- 这条不修，build/typecheck 两个 job 必红，与本轮其余修复无关。

## 2. 归一化 / 标题相似度：存在**互相冲突**的实现与测试

失败用例分属不同文件、期望互相矛盾：

| 用例 | 期望 | 位置（触发方） |
| --- | --- | --- |
| `dedup.part3` > drops tracking params… | `https://example.com/a/?…` → `https://example.com/a?a=1&b=2`（路径尾 `/` 去掉） | 归一化实现 A |
| `news-dedup.part1` > 根路径保留 `/` | `https://example.com` → `https://example.com/` | 归一化实现 B |
| `news-dedup.part1` > 空串与非 http(s) | `ftp://example.com/a` → `''` | 实现 B |
| `spec.part1` > 空值与非法 URL | `'not a url'` **原样返回**；`ftp://…` **原样返回** | 实现 C |
| `news-dedup.part1` / `store` / `spec.part1` > 相似度 | 轻微改写需 `> 0.9`；`titleSimilarity('','')` 需 `0` | 各实现阈值/空值分支不一致 |

- 根因：仓库里同时存在 `src/lib/normalize.ts`、`src/lib/dedup.ts`、`src/app/news-dedup.ts`、`src/app/url-normalize.ts` 等多份归一化/相似度实现，不同测试文件引用了不同实现，且期望值互斥（非 http(s) 是丢弃还是原样、尾斜杠去不去）。
- 处置（按顺序，勿跳步）：
  1. 在 `docs/news-primitives.md` 冻结唯一语义（建议：仅 http/https；主机小写、去默认端口、去 fragment、去 `utm_*`/`fbclid` 等追踪参数、查询参数按键排序；**路径非根时去掉尾斜杠，根路径保留 `/`**；非 http(s) 与非法输入返回 `''`），并声明这是**唯一契约**。
  2. 其它实现全部改为 re-export，只保留一份实现，避免「改一处绿、另一处红」。
  3. 与冻结语义不符的测试断言（例如要求非 http(s) 原样返回的）随契约一并订正——这是**对齐契约**，不是删测试。
  4. `titleSimilarity`：空/空归一化串一律返回 `0`（否则空标题会被当成完全重复，直接把大批条目判重丢弃）；阈值比较用 `> 0.9`，仅标点/大小写差异必须为 `1`。
- 这条同时解释 `store.test.ts` 的 `titleSimilarity(base, slight) > 0.9` 失败。

## 3. `GET /api/news` 空集时 `totalPages` 应为 1

```
tests/api-news.part6.test.ts: expected 0 to be greater than or equal to 1  (body.totalPages)
```

- 根因：`totalPages` 用了 `Math.ceil(total / limit)`，`total=0` 时为 `0`。
- 处置：统一为 `totalPages = Math.max(1, Math.ceil(total / limit))`，`hasNext = page < totalPages` 不变；`items` 仍可为空数组（空数组不是错误）。注意另一份用例显式断言「无数据时 totalPages=0」，两条断言**互斥**，需在同一次改动里按契约择一并订正另一条。

## 4. 采集夹具被自身去重规则打死（`api-news.part10` 的 `seeded` 断言）

```
api-news.part10.test.ts:40  assert.strictEqual(inserted, true) → false
```

- 根因：夹具生成 25 条标题高度雷同（同一批词重排），命中「标题相似度 > 0.9 判重」，于是第 N 条被丢，`seeded` 的 `inserted === true` 断言失败。这是**夹具与去重规则的冲突**，不是去重逻辑 bug。
- 处置：按 `tests/collect.part8.test.ts` 已采用的做法，让夹具标题带**唯一后缀**（序号/来源名），保证彼此相似度 < 0.9；不要为了跑通用例去放宽去重阈值（会污染 AC3）。

## 5. ArXiv 解析：excerpt 未剥 HTML、`maxItems` 语义不清

```
news-collector-jqz.part6: actual '<p>一段中文摘要</p>' expected '一段中文摘要'
news-collector-jqz.part6: maxItems 用例长度不符
```

- 根因 1：`summary` 字段直接落原文，未做 `stripHtml` + 实体解码 + 空白压缩（`src/lib/sources/parse.ts` 已有 `stripHtml`，未被 arxiv 采集器调用）。
- 根因 2：`maxItems` 在「先过滤非法条目」还是「先截断」上的顺序不一致，导致上限用例拿到的条数偏移。
- 处置：解析顺序固定为 `解析 → 校验（id/title/时间）→ stripHtml(excerpt) → slice(0, maxItems)`；`maxItems<=0` 返回空数组。

## 6. 摘要截断未按码点截到 200

```
summarize.part7: expected 200, actual 60
```

- 根因：摘要长度校验/截断用的是 `String.length`（UTF-16 单元）且存在「过短即判非法」的早退分支，超长输入在截断前就被判失败返回短串。
- 处置：长度统一用 `[...summary].length` 计码点；先 `trim` → 超 200 码点则 `slice` 到 200 → 再校验 50–200；不合法才降级 `failed`。

## 7. 本轮处置状态

- **已定位**：上述 6 项根因（build/typecheck 同根因计 1 项）。
- **未修复（需文件级改动，本轮未取到相关文件全文）**：`src/app/page.ts`、`src/app/news/[id]/page.ts`、归一化/相似度实现、`totalPages` 计算、arxiv 解析、摘要截断、`api-news.part10` 夹具。
- **未运行**：`npm run build`、`npm run typecheck`、`npm run test` 本轮均未执行，**不得视为通过**。合并前必须以本地三命令全绿为准。
- **互斥断言清单（必须一次性对齐，勿分次提交）**：
  1. 非 http(s) URL：丢弃 `''` vs 原样返回。
  2. 路径尾斜杠：`/a` vs `/a/`；根路径是否保留 `/`。
  3. 空集 `totalPages`：`0` vs `1`。

## 8. 与需求的关系

以上修复均不改变 `GET /api/news`、`GET /api/news/{id}`、`GET /api/categories`、`POST /api/cron/collect`、`GET /api/collect-runs*` 的字段与状态码语义；`summary_status=failed` 条目继续照常返回（AC5），默认 `limit=20` 不变（AC6）。不涉及 `.github/`、`deploy/`、`CODEOWNERS`。
