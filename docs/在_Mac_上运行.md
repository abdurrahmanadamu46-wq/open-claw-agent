# 在 Mac 上运行本项目

在 Mac 上只需用 **终端 (Terminal)** 执行对应命令即可，无需运行任何 `.bat` 文件。

---

## 一、环境准备

| 依赖 | 说明 |
|------|------|
| **Node.js** | 版本 **≥ 20**（推荐用 nvm：`nvm install 20 && nvm use 20`） |
| **npm** | 随 Node 自带 |
| **Redis**（可选） | 仅在后端 / Agent 需要时用；可用 `brew install redis` 或 Docker |

---

## 二、只跑前端演示（最常见）

不连后端、用 Mock 数据看完整控制台与边缘算力池、战术发射台等：

```bash
cd web
npm install
cp .env.local.example .env.local
npm run dev
```

浏览器打开终端里显示的 **Local 地址**（如 `http://localhost:3000`），若 3000 被占用会依次尝试 3001、3002…。

- 演示入口：`http://localhost:端口/demo.html`
- 边缘算力池：`http://localhost:端口/fleet`
- 战术狙击发射台：`http://localhost:端口/missions/manual-publish`
- 全息数字员工：`http://localhost:端口/agents/cabinet`

---

## 三、跑后端（NestJS + Redis）

需要扫码绑定或 VIP 连调时：

```bash
# 1. 启动 Redis（二选一）
brew services start redis
# 或 Docker：
docker run -d -p 6379:6379 redis:7-alpine

# 2. 后端
cd backend
npm install
export REDIS_HOST=127.0.0.1
export REDIS_PORT=6379
export JWT_SECRET=your-secret
npm run start:dev
```

后端默认 HTTP 在 `http://localhost:3000`（或你设置的 `PORT`），WebSocket 路径为 `/agent-cc`。

> **说明**：Mac 上设置环境变量用 `export`，不要用 Windows 的 `set`。

---

## 四、前端连真实后端（可选）

在 **web** 目录下：

```bash
cp .env.local.example .env.local
```

编辑 `.env.local`，关闭 Mock 并指向后端：

- `NEXT_PUBLIC_USE_MOCK=false`
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:3000`（与后端端口一致）

然后 `npm run dev`，前端会请求该后端。

---

## 五、Agent 引擎（节点池 + Redis）

若要跑 Agent 核心（节点管理、Redis 锁等）：

```bash
# 确保 Redis 已启动（见第三节）
export REDIS_URL=redis://localhost:6379
npm install
npm run build
npm run server
```

Dashboard API：`GET http://localhost:38789/api/agent/nodes/status`（端口以实际为准）。

---

## 六、Mac 与 Windows 差异速查

| 项目 | Windows | Mac |
|------|---------|-----|
| 环境变量 | `set VAR=value` | `export VAR=value` |
| 多命令顺序执行 | `cmd1 && cmd2` | `cmd1 && cmd2`（相同） |
| 复制文件 | `copy a b` | `cp a b` |
| 启动脚本 | `启动演示控制台.bat` | 直接在项目根或 `web` 下执行上述 `npm` 命令 |
| VIP 客户端 | `scripts/vip-build/启动VIP客户端.bat` | `cp scripts/vip-build/.env.vip.example scripts/vip-build/.env.vip` 后编辑，再在仓库根目录执行 `npm run vip:run` |

---

## 七、常见问题

- **端口被占用**：Next.js 会自动尝试下一端口，看终端里打印的 `Local: http://localhost:xxxx`。
- **Redis 连接失败**：确认 Redis 已启动（`redis-cli ping` 应返回 `PONG`），且 `REDIS_HOST` / `REDIS_PORT` 或 `REDIS_URL` 与实际情况一致。
- **权限错误**：若 `npm install` 报权限问题，不要用 `sudo`，可改用 `nvm` 或把 npm 全局目录权限修好。

按上述步骤即可在 Mac 上完整运行并测试本项目。
