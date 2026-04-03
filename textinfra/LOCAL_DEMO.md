# ClawCommerce 本地 Demo 跑通指南

用 **docker-compose.local.yml** 和 **hosts** 在本地电脑跑通整站；老板看完满意再决定买服务器上生产。

---

## 1. 配置 hosts（必做）

把下面两行加到本机 hosts 文件，让浏览器用「域名」访问本地服务（和线上体验一致）：

```
127.0.0.1   app.clawcommerce.local   api.clawcommerce.local
```

**hosts 文件位置**：

- **Windows**：`C:\Windows\System32\drivers\etc\hosts`（需用管理员权限编辑）
- **macOS / Linux**：`/etc/hosts`

保存后无需重启；新开浏览器标签即可生效。

---

## 2. 一键启动（仅本仓：Redis + Agent + Web）

在**仓库根目录**执行：

```bash
docker compose -f textinfra/docker-compose.local.yml up -d
```

首次会构建 Agent 和 Web 镜像，稍等几分钟。之后启动约 10 秒内完成。

| 服务   | 本地访问地址                         | 说明           |
|--------|--------------------------------------|----------------|
| 前端   | http://app.clawcommerce.local:3001  | 商家控制台     |
| 后端 API | http://api.clawcommerce.local:3000 | **需在本机单独起**（见下） |
| Agent  | http://localhost:38789/health        | 内部健康检查   |
| Redis  | localhost:6379                       | 仅给 Agent 用  |

---

## 3. 后端（二选一）

### 方式 A：完整联调（本机起后端）

- 在本机 **3000 端口** 启动 NestJS 后端（小明提供的仓库）。
- 确保后端 `.env` 里：
  - `INTERNAL_API_SECRET` 与本地 compose 一致（默认 `super_secret_internal_token`）。
  - 可选：`AGENT_INTERNAL_URL=http://localhost:38789`（本机调 Agent）。
- 浏览器访问 **http://app.clawcommerce.local:3001** 时，前端会请求 **http://api.clawcommerce.local:3000**，hosts 会解析到本机 3000，即你的后端。
- Agent 容器内通过 `http://host.docker.internal:3000` 回传线索（Windows/Mac 均支持）。

### 方式 B：仅看前端（Mock，不启后端）

- 不配置后端，仅看 UI 与交互时，用 Mock 数据启动 Web：

```bash
# 先停掉已有 web 容器（若已 up 过）
docker compose -f textinfra/docker-compose.local.yml stop web

# 用 Mock 重新构建并启动（构建时注入 NEXT_PUBLIC_USE_MOCK=true）
NEXT_PUBLIC_USE_MOCK=true docker compose -f textinfra/docker-compose.local.yml up -d --build web
```

- 然后访问 **http://app.clawcommerce.local:3001**，列表/大盘等为 Mock 数据，无需后端。

---

## 4. 验证

1. 打开：**http://app.clawcommerce.local:3001**
2. 应看到商家控制台（大盘 / 任务 / 线索 / 配置向导等）。
3. 若为 Mock：数据为假数据；若已起后端：可登录后走真实接口。

---

## 5. 停止与清理

```bash
docker compose -f textinfra/docker-compose.local.yml down
# 需删数据卷时：
docker compose -f textinfra/docker-compose.local.yml down -v
```

---

## 6. 和「买服务器上生产」的关系

- 当前：**本地用 hosts + docker-compose.local.yml 跑通 = 零服务器成本，先给老板 Demo**。
- 若老板满意：再买服务器，把域名解析到服务器 IP，用带 Traefik 的 `docker-compose.staging.yml`（后端团队提供）上 HTTPS 与生产环境。
