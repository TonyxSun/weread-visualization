<img width="2968" height="1860" alt="1c8ccaff0b7d693b3ff2b8a8bff788ea" src="https://github.com/user-attachments/assets/36dbb1d3-d3c8-43a3-b9f3-5b1b66be30e7" />


# Read Visualization

一个用于整理和可视化个人阅读痕迹的 React 应用。它可以从微信读书网关或 Obsidian 笔记导入阅读数据，并把书籍、划线、分类、年度阅读人格和思想聚类呈现在可交互的画布中。

## 功能

- 微信读书数据导入：拉取阅读统计、书架笔记、划线和书籍封面。
- Obsidian 笔记导入：从本地 Markdown 阅读笔记生成同一套可视化视图。
- 无限画布：拖拽、缩放、查看书籍卡片、分类关系和阅读轨迹。
- 年度阅读人格：根据书籍与划线生成年度 MBTI、年度问题、视觉人格和说明文本。
- 多模型分析配置：支持兼容 OpenAI Responses、Chat Completions、Anthropic Messages、DeepSeek、Kimi、火山方舟等接口格式。
- 本地缓存：阅读数据、分析结果和连接配置保存在浏览器本地。
- **服务端持久化（可选）**：SQLite 本地库 + 增量同步，刷新后秒开画布，后台补全划线。

## 架构概览

应用由 **Express** 同时提供 API 与（开发模式下）**Vite** 前端。微信读书相关请求经 `/api/weread/proxy` 转发到网关；自 `WEREAD_SERVER_SYNC=1` 起，阅读数据优先走 **服务端 SQLite 缓存**，而不是每次刷新都从浏览器拉全量。

```
浏览器 (React)
  │  POST /api/weread/snapshot   ← 从 data/weread.db 组装，无网关 I/O（目标 <100ms）
  │  POST /api/weread/sync       ← 后台增量同步（202，可合并重复请求）
  │  GET  /api/weread/sync/status ← 轮询进度（catalog → stats → highlights → backfill）
  ▼
Express (server.ts + server/sync/*)
  │  SyncOrchestrator（每账号单任务互斥）
  │  wereadGateway（并发 2、间隔 400ms、最多 6 次重试，与 src/api.ts 一致）
  ▼
SQLite (data/weread.db, WAL)
  accounts · notebooks · highlights · book_notes_sync · sync_runs · stats_cache
  ▼
WeRead Agent Gateway (/user/notebooks, /book/bookmarklist, /readdata/detail, …)
```

### 同步策略（增量）

| 数据 | 接口 | 策略 |
|------|------|------|
| 书架目录 | `/user/notebooks` | `lastSort` 游标分页；按 `sort` + 笔记计数做指纹，**仅变更的书**拉划线 |
| 划线 | `/book/bookmarklist` | 默认全书 **全量替换**；可选 `WEREAD_BOOKMARKLIST_INCREMENTAL=1`（需网关验证） |
| 阅读统计 | `/readdata/detail` | `stats_cache` 表，TTL **20 分钟**（与定时刷新一致） |
| 补全 | — | `book_notes_sync.sync_status != ok` 的书在后台继续拉取 |

**用户体验：** 首次或冷库仍可能较慢；**第二次打开**先展示库内数据（stale-while-revalidate），顶部半透明进度条显示后台同步。AI 人格分析仍只存在 **浏览器 localStorage**，不入库。

### 账号与后台刷新

- 账号以 `SHA-256(apiKey)` 标识，库内不存明文 Token。
- 定时器每 60s 检查，超过 20 分钟未同步则触发 `POST /sync` 等价任务。
- 后台刷新凭证：`WEREAD_API_KEY` 环境变量（单用户），和/或 `SERVER_SECRET` + 加密存库的 key（多账号/无浏览器时）。

### 部署注意

- **需要** 长期运行的 Node 进程与可写 `data/` 目录：`npm run dev` / `npm run start`。
- **Netlify 静态发布**（仅 `dist/`）无法使用服务端同步；可设 `WEREAD_SERVER_SYNC=0` 回退为纯浏览器冷同步。

更完整的设计说明见 [`docs/design-server-sync-cache.md`](docs/design-server-sync-cache.md)。

## 技术栈

- React 19
- TypeScript
- Vite
- Express
- Tailwind CSS
- Motion
- Lucide React
- better-sqlite3（服务端阅读数据缓存）

## 本地运行

```bash
npm install
npm run dev
```

默认服务地址为 `http://localhost:3000`。

复制 `.env.example` 为 `.env`，按需配置：

| 变量 | 说明 |
|------|------|
| `WEREAD_API_KEY` | 微信读书网关 Token（服务端代理、定时刷新、及可选的浏览器数据加载后备）。设置后「数据源设置」面板的 API Key 可留空，由服务器回退读取 .env。 |
| `WEREAD_API_URL` | 网关地址（默认官方 Agent Gateway） |
| `WEREAD_SERVER_SYNC` | `1` 启用 SQLite 缓存（默认）；`0` 仅用浏览器全量拉取 |
| `SERVER_SECRET` | 可选，32+ 字符，用于加密存储 API Key 以支持无浏览器定时刷新 |
| `GEMINI_API_KEY` | 可选，服务端 Gemini 分析 |
| `XAI_API_KEY` / `ANALYSIS_API_KEY` | 可选，服务端外部模型分析（xAI Grok / OpenAI 等）。设置后浏览器「分析模型」面板的 Key 可留空，由服务器读取 .env（优先级：客户端提供 > 服务端 env）。支持 Responses/Chat 格式。 |

浏览器「数据源设置」中的 Token 会随 Authorization 头传给 snapshot/sync（若留空且服务端 .env 有 WEREAD_API_KEY 则自动使用服务端值）。与 `.env` 中的 key 应对同一账号以便后台刷新匹配。

## 常用命令

```bash
npm run dev      # 启动开发服务
npm run build    # 构建前端和服务端产物
npm run start    # 运行构建后的服务
npm run lint     # TypeScript 类型检查
```

## 敏感信息说明

- `.env*` 默认被忽略，只有 `.env.example` 会进入版本库。
- `dist/`、`node_modules/`、日志文件和系统文件不会进入版本库。
- 微信读书网关 Token、第三方模型 API Key 等信息只应保存在本地浏览器或私有环境变量中。
