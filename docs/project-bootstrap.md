# 工程初始化与质量测试

需要 Node.js 24。安装使用 `npm ci`；开发使用 `npm run dev`。

验证入口：

- `npm test`：分别执行使用 Vitest 和 node:test 的测试文件，任一失败整体失败，零测试也失败。
- `npm run typecheck`：TypeScript 严格类型检查。
- `npm run build`：Next.js 生产构建。

CI 对未合并 PR 的当前 head 提交执行以上三个检查；也支持在业务分支上手动触发。

初始化 PR 合入主分支后，把主分支更新到现有业务 PR，再在 7x24 恢复质量测试。业务 PR 仍需通过测试及验收后合并。这个初始化 PR 提供工程基础，不代表现有业务代码已经通过验证。

当前数据层使用 `pg`，定时器使用 `node-cron`；凭据通过运行环境提供，初始化不创建数据库或配置任何生产凭据。
