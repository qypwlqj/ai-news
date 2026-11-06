# AI DAILY · 每日 AI

面向微信小程序的 AI 资讯阅读应用。前端使用 **Taro 4 + React 18 + Tailwind CSS 3 + TypeScript**；采集、摘要生成和 API 运行于独立 Node.js 服务。当前交付以本地开发为目标，不需要已有 AppID 或线上域名。

## 本地启动

使用 Node.js 24，在仓库根目录执行：

```sh
npm ci
npm run dev:server
```

后端监听 `http://127.0.0.1:3000`。另开终端启动小程序编译：

```sh
npm run dev:weapp
```

在微信开发者工具导入 **`apps/miniapp` 目录**，使用测试号/游客模式；工程配置指向 `dist/weapp`，AppID 暂为 `touristappid`。首次使用开发者工具可能需要微信扫码登录。本地 HTTP 调试已配置不校验请求域名；真机不能通过 `127.0.0.1` 访问电脑服务。

后端默认内存仓储，没有采集数据时显示真实空态，重启会丢失数据。仅填写 `DATABASE_URL` 尚不会启用 PostgreSQL。

## 先看 UI

浏览器预览复用同一套 Taro 页面：

```sh
TARO_APP_DEMO=true npm run dev:h5
```

打开 `http://127.0.0.1:5173`。预览数据是明确标记的虚构示例，不写入后端，也不会调用模型。小程序模拟器也可使用 `TARO_APP_DEMO=true npm run dev:weapp`；切回真实 API 时停止该进程，再不带此变量启动。默认构建不包含示例文章。

真实 API 联调：保持 `npm run dev:server` 运行，再执行不带示例变量的 `npm run dev:h5` 或 `npm run dev:weapp`。

## 页面与交互

- **今日**：重点资讯、横向分类、下拉刷新、触底分页。
- **发现**：五类主题、三个信息源，直达筛选结果。
- **搜索**：关键词、分类、来源、北京时间日期组合筛选。
- **详情**：中文摘要、来源与时间、微信分享、复制原文链接。
- **关于**：阅读方式与摘要说明。

暖白与鼠尾草绿构成阅读界面，使用本地插画和原生底部导航，适配安全区与单手操作。

## 项目结构

```text
apps/miniapp/                 Taro 小程序与 H5 开发预览
  src/pages/                 今日、发现、搜索、详情、关于
  src/components/            资讯卡片、分类、加载与空态
  src/domain/                参数与数据校验、分页请求状态
  src/services/              Taro.request 与隔离的示例数据
apps/server/                  独立 HTTP API、采集、摘要、仓储
  src/server.ts              Node 服务入口与本地 CORS
  src/http.ts                API 路由
  src/api/                   原有 Request/Response 接口处理器
  src/lib/                   当前活动业务链路
  src/app/news-*             待收敛的历史业务实现
packages/contracts/           两端共享的 DTO、分类和来源字典
```

后端不依赖 Next.js 或 React，小程序不导入后端代码。

## 环境配置

参考 `apps/miniapp/.env.example` 和 `apps/server/.env.example`，复制到各自目录的 `.env` 后修改，修改后重启进程。

| 所属   | 变量                                         | 用途                                               |
| ------ | -------------------------------------------- | -------------------------------------------------- |
| 小程序 | `TARO_APP_API_BASE_URL`                      | API 地址，默认 `http://127.0.0.1:3000`，编译时写入 |
| 小程序 | `TARO_APP_DEMO`                              | 仅本地示例，默认 `false`                           |
| 后端   | `HOST` / `PORT`                              | 默认 `127.0.0.1:3000`                              |
| 后端   | `CORS_ORIGINS`                               | H5 可访问的来源，默认允许本地 5173                 |
| 后端   | `CRON_SECRET`                                | 采集入口鉴权                                       |
| 后端   | `LLM_API_KEY` / `LLM_MODEL` / `LLM_BASE_URL` | 摘要服务配置；未配置时保留文章并标记摘要失败       |

模型密钥、数据库连接串和采集令牌只能保存在后端，不得加入小程序变量。接口路径保持 `/api/news`、`/api/news/:id`、`/api/categories`、`/api/health`、`/api/collect-runs`、`/api/cron/collect`。

## 构建与验证

```sh
npm run typecheck
npm test
npm run build
npm run verify:weapp
npm run build:h5
```

微信产物：`apps/miniapp/dist/weapp`；后端产物：`apps/server/dist/server.mjs`，用 `npm run start:server` 启动。`verify:weapp` 检查页面、图标、Tailwind 转换、示例隔离与后端依赖隔离。

Taro 全部包锁定同一版本。Tailwind 3 与 weapp-tailwindcss 4 适配 Taro 当前 Vite 4 链路，升级应同时验证生成的 WXSS 和 H5。

## 交付边界与后续

当前未发布。真实采集与模型调用需要配置后端，本轮验证使用替身，不产生模型费用。生产前还需完成 PostgreSQL 仓储接线、跨实例采集锁、实际调度注册和健康检查语义修正；证据见 [重构评估](docs/refactor-review.md)。

发布时需要真实 AppID、部署后的 HTTPS API、微信后台 request 合法域名和真机验证，并关闭示例模式、恢复域名校验。历史 `architecture/spec/runbook` 文档描述的是早期方案，**本 README 与迁移评估为当前启动依据**。

- [重构评估与小程序迁移](docs/refactor-review.md)
- [接口契约](docs/api.md)
- [历史数据模型](docs/data-model.md)
