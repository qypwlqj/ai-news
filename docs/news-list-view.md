# 首页列表视图模块（本段新增）

本段提供首页列表「取数之后的展示层」纯函数，页面层（`src/app/page.ts`）在后续段接入，不改动接口契约。

## `src/app/news-list-view.ts`

- `resolveListCategory` / `resolveListDate` / `resolveListPage`：URL 参数校验。未知分类（含 `constructor`、`__proto__` 等原型链键）返回 `null` 即「全部」；非法日期与页码静默回退默认值（页面层不返回 400）。
- `buildListHref` / `buildCategoryHref`：URL 同步；`page=1` 不写进 URL；切换分类重置 `page=1` 并保留 `date`，支持前进后退与分享。
- `sortNewsItemsForDisplay`：固定 `publishedAt DESC, id DESC`，非法时间置后，同键稳定，避免翻页抖动。
- `buildPaginationView`：`共 N 条`（取服务端 `total`）、`prevHref`/`nextHref`、页码窗口（首尾 + 当前 ±1，溢出 `gap`）；`totalPages` 缺省按 `max(1, ceil(total/limit))`，`limit` 默认 20。

## `src/components/SummaryBlock.ts`

摘要三态：`ok` 输出摘要（HTML 转义、按码点截断 200）；`pending` 输出「摘要生成中…」并带 `aria-busy="true"`；`failed` 或 `summary` 为空输出「摘要生成失败，可点击标题阅读原文」。未知 `summaryStatus` 降级中性展示原值文本，条目不因此消失（AC5）。

## `src/components/StateBlock.ts`

承接 `empty` / `error` / `notfound`：空态给出「今日暂无资讯」+ 切换分类提示，`role="status"`；错误态 `role="alert"`，只展示截断 200 字的脱敏 `message`（连接串、`Bearer` 令牌、`*token*=` 等一律替换为 `[已脱敏]`）与合法 `requestId`，操作链接仅接受站内 `/` 或 `http(s)` 绝对地址，`javascript:` 与 `//host` 直接丢弃。

测试：`tests/news-list-view.part19.test.ts`。
