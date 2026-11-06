# Loop 16 CI 失败分析与修复计划

> 本文件只记录本轮 CI 失败的分析结论与待执行修复项，不含任何令牌、连接串或环境变量。

## 失败 1：`npm run typecheck` / `npm run build` — TS5097

- 现象：`tests/news-query.test.ts(4,30)`、`tests/news-query.test.ts(9,8)` 报 TS5097「An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled」。
- 根因：该 Node 原生测试文件用 `from '../src/app/news-query.ts'` 这类带 `.ts` 扩展名的写法，与仓库其余测试（不带扩展名）不一致；根 `tsconfig.json` 未开启 `allowImportingTsExtensions`。
- 修复：把两处 import 说明符末尾的 `.ts` 去掉（例如 `'../src/app/news-query'`）。不要改 `tsconfig.json`，也不要在测试里加 `// @ts-ignore` 掩盖类型错误。
- 状态：**未执行**。本轮上下文未提供 `tests/news-query.test.ts` 的完整内容，无法给出逐字唯一的 search/replace 片段，强行猜测会导致编辑不落盘，因此留到下一轮先读取再改。

## 失败 2：`npm run test` — `tests/news-list-view.part19.test.ts:87` `9 !== 10`

- 现象：用例「分页视图：共 N 条、空集 totalPages=1、页码窗口与链接」中 `assert.strictEqual(actual, expected)` 实际 9、期望 10。
- 定位方向（按可能性排序）：
  1. `src/app/news-list-view.ts` 的总页数用 `Math.floor(total / limit)` 而不是 `Math.ceil`，少算最后一页；
  2. 用 `items.length` 当 `total`（当前页条数），页数因此偏低；
  3. 页码窗口 [首, …, 当前±1, …, 尾] 的边界少收一页。
- 修复策略：以 `GET /api/news` 契约 `totalPages = ceil(total / limit)` 为准，空集按用例期望取 1；先读实现判断是用例旧期望还是实现缺陷，**优先改实现，不删改用例绕过**。
- 状态：**未执行**。`src/app/news-list-view.ts` 与 `tests/news-list-view.part19.test.ts` 均未在本轮上下文中提供。

## 下一轮返修的前置动作

1. 读 `tests/news-query.test.ts`，删除两处 `.ts` 扩展名。
2. 读 `src/app/news-list-view.ts` + `tests/news-list-view.part19.test.ts`，按契约修正分页总页数计算并补一条空集/整页边界用例。
3. 本地依次跑 `npm run typecheck`、`npm run build`、`npm run test`，三项全绿后再提交。

## 未验证项（不得视为通过）

- 本轮未运行任何命令：`typecheck`、`build`、`test` 的结果均未验证；两个失败点都仍未修复。
