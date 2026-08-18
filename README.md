<img width="2968" height="1860" alt="1c8ccaff0b7d693b3ff2b8a8bff788ea" src="https://github.com/user-attachments/assets/36dbb1d3-d3c8-43a3-b9f3-5b1b66be30e7" />


# Read Visualization

个人微信读书可视化站点：从微信读书 Agent 网关拉取书架、划线与阅读统计，在无限画布与金句卡片中呈现阅读人格、分类关系与时间趋势。

**发布模式：** 密钥与模型只在服务端配置。访客无法在页面上填写 API Key 或切换模型。适合挂在个人域名（例如 Vercel + Cloudflare 子域名）作为作品页。

## 功能

- **微信读书同步**：服务端 SQLite 缓存 + 增量同步；刷新后先展示库内数据，后台补全划线。
- **无限画布**：阅读成长馆、趋势面板、关系轨迹、认知景观（拖拽 / 缩放）。
- **年度阅读人格**：服务端调用分析模型（默认 xAI `grok-4-5`）生成 MBTI、年度问题与说明；打开页面后自动分析。
- **金句卡片**：多种卡片样式；仅展示能在当前样式中**完整排版**的划线（过长摘录自动跳过）。
- **阅读日历热力图**：贡献图样式，**仅显示最近 6 个自然年**。
- **移动端**：顶栏 **图谱 / 划线** 切换全屏画布与卡片视图。

## 架构概览

**Express** 同时提供 API 与静态前端（生产）或 Vite 中间件（开发）。微信读书请求经服务端代理；默认 `WEREAD_SERVER_SYNC=1` 时，浏览器只调 snapshot/sync，不持有网关 Token。

```
浏览器 (React)
  │  POST /api/weread/snapshot   ← 从 data/weread.db 组装
  │  POST /api/weread/sync       ← 后台增量同步（202）
  │  GET  /api/weread/sync/status
  │  POST /api/weread/analyze    ← 服务端模型（XAI / ANALYSIS_* / GEMINI）
  ▼
Express (server.ts + server/sync/*)
  │  SyncOrchestrator · wereadGateway（限流 / 重试）
  ▼
SQLite（本地 `data/weread.db` 或 Vercel 上的 Turso / libSQL）
  ▼
WeRead Agent Gateway
```

### 同步策略（增量）

| 数据 | 接口 | 策略 |
|------|------|------|
| 书架目录 | `/user/notebooks` | 游标分页；指纹变更的书才拉划线 |
| 划线 | `/book/bookmarklist` | 默认全书全量替换 |
| 阅读统计 | `/readdata/detail` | `stats_cache`，TTL 约 20 分钟 |
| 补全 | — | 未成功的书后台继续拉取 |

首次冷库可能较慢；之后 stale-while-revalidate。AI 分析结果缓存在**浏览器 localStorage**，不入库。

更完整的同步设计见 [`docs/design-server-sync-cache.md`](docs/design-server-sync-cache.md)。

## 技术栈

React 19 · TypeScript · Vite · Express · Tailwind CSS · Motion · Lucide · libSQL / Turso

## 本地运行

```bash
npm install
cp .env.example .env   # 填入 WEREAD_API_KEY 等
npm run dev
```

默认：http://localhost:3000

### 环境变量（仅服务端）

| 变量 | 说明 |
|------|------|
| `WEREAD_API_KEY` | **必需**。微信读书网关 Token |
| `WEREAD_API_URL` | 网关地址（默认官方 Agent Gateway） |
| `WEREAD_SERVER_SYNC` | `1`（默认）SQLite 缓存；`0` 关闭 |
| `TURSO_DATABASE_URL` | **Vercel 必需**。Turso / libSQL 远程库 URL |
| `TURSO_AUTH_TOKEN` | **Vercel 必需**。Turso 鉴权 token |
| `CRON_SECRET` | 可选。保护 `GET /api/weread/cron`（Vercel Cron 会自动带上） |
| `XAI_API_KEY` | 可选。xAI 分析；默认 endpoint + 模型 **`grok-4-5`** |
| `ANALYSIS_API_KEY` / `ANALYSIS_API_ENDPOINT` / `ANALYSIS_API_MODEL` | 可选。覆盖通用分析提供方 |
| `GEMINI_API_KEY` | 可选。Gemini 后备 |
| `SERVER_SECRET` | 可选。加密存库 key（多账号 / 定时刷新） |
| `APP_URL` | 可选。站点公网 URL |
| `PORT` | 本地监听端口（Vercel 不使用） |

示例见 [`.env.example`](.env.example)。**不要**把真实密钥提交进仓库。

## 部署

需要可持久化的 SQLite（本地文件或 Turso）以及 Node 服务端。

**Vercel：** 构建前端，由 `server.ts` 提供 API 与 SPA。Vercel 磁盘不可持久化，生产必须配置 Turso。

```bash
npx vercel link --yes --project weread --scope tonyxsuns-projects
npx vercel env add WEREAD_API_KEY
npx vercel env add TURSO_DATABASE_URL
npx vercel env add TURSO_AUTH_TOKEN
npx vercel --prod
```

本地生产模式：

```bash
npm run build
npm start
```

| 场景 | 说明 |
|------|------|
| **Vercel（推荐）** | Express 入口 `server.ts`；Turso 存库；Hobby 每天一次 Cron（`GET /api/weread/cron`）。Pro 可把 `vercel.json` 的 schedule 改成 `*/20 * * * *` |
| **自定义域名** | 在 Vercel 添加域名，于 DNS（如 Cloudflare）配置 CNAME；Cloudflare 代理 SSL 用 Full / Full (strict) |
| **本地 / VPS** | 无 `TURSO_DATABASE_URL` 时写入 `data/weread.db` |

部署后自检：

```bash
curl -s https://your-host/api/weread/status
# → {"hasServerWereadKey":true}

curl -s https://your-host/api/analysis/status
# → hasServerAnalysisKey + serverModel（若配置了 XAI/ANALYSIS）
```

## 常用命令

```bash
npm run dev                 # 开发
npm run build               # 构建前端
npm run start               # 生产启动
npm run lint                # tsc --noEmit
npm run verify:publish      # 发布模式：无客户端密钥 + 双次启动探测
npm run verify:card-excerpts  # 金句卡片几何过滤（含本地 DB 样本）
npm run verify:card-dom     # Playwright：卡片 DOM 无裁切（需 playwright）
```

## 敏感信息

- 仅 `.env.example` 进库；真实 `.env` / 平台 Secret 不进 Git。
- 微信读书 Token、模型 API Key 只放服务端。
- 前端请求 snapshot/sync/analyze **不携带访客密钥**。
