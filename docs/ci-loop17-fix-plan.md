# Loop 17 CI 失败处理记录

对应 run #41586730010：3 个 job（test / build / typecheck）全部失败。下文逐项说明处理状态。

## 1. typecheck + build：TS5097（已修复）

- 报错：`tests/news-query.test.ts(4,30)` 与 `(9,8)` 提示 `An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled`。
- 原因：该 node 测试文件的两处导入说明符带 `.ts` 后缀，而仓库 `tsconfig` 未开启 `allowImportingTsExtensions`，`tsc --noEmit`（typecheck job）与 `next build` 的类型检查（build job）同时失败。
- 处理：改为与其他测试文件一致的扩展名无关写法：
  - `'../src/app/news-query.ts'` → `'../src/app/news-query'`
  - `'../src/app/news-api-types.ts'` → `'../src/app/news-api-types'`
- 未做：未修改 `tsconfig.json`（不在允许改动目录内），未删除或跳过任何用例，未改动业务代码与接口契约。
- 待验证：需在 CI 中重新跑 `npm run typecheck`、`npm run build` 与 `npm run test` 确认三处均通过；本地未执行。

## 2. test：`分页视图：共 N 条、空集 totalPages=1、页码窗口与链接`（未修复，待复核）

- 现象：`tests/news-list-view.part19.test.ts:87` 严格相等断言，actual `9`、expected `10`；同一次运行中其余 138 个 node 用例与 31 个 vitest 文件全部通过。
- 该用例所在实现与夹具本轮未完整读取，因此未做盲改，避免把真实缺陷掩盖为断言放宽。
- 复核口径（分页契约，来自 `GET /api/news` 接口契约，不得放宽）：
  1. `limit` 默认 20，UI 不暴露修改入口；
  2. `totalPages = max(1, ceil(total / limit))`，空集为 1；
  3. 页码窗口在页数较少时全量展开，页数多时保留首尾页 + 当前页邻域 + 省略号；
  4. 页码链接数量必须与窗口定义严格一致，不含 off-by-one。
- 两种候选成因，需对照 `src/app/news-list-view.ts` 与用例夹具逐行确认：
  - ① 页码窗口计算 off-by-one（循环边界 `<` / `<=` 或窗口长度公式少 1）；
  - ② 夹具入库时被标题相似度 > 0.9 的软去重命中，实际 `total` 比预期少 1。
- 处理原则：定位到根因后修正实现或夹具，不放宽断言、不删除用例。

## 3. 安全与边界

- 不改动 `.github/`、`scripts/`、`deploy/`、`CODEOWNERS` 等治理与 CI 文件。
- 文档、日志、响应中不出现任何令牌、连接串或环境变量值。
- 未把本轮未执行的检查（typecheck / build / test）宣称为通过。
