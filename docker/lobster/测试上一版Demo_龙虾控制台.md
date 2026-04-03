# 测试「上一版」Demo：龙虾控制台（OpenClaw Gateway）

这里的 **上一版 demo** 指：**Docker 里自带技能的龙虾** 的 Web 控制台（端口 **18789**），不是本仓库 Next 网页（端口 3001）的「数据大盘 / 一键进入演示」。

---

## 1. 确认龙虾容器已启动

在仓库根目录执行：

```powershell
docker compose -f docker/lobster/docker-compose.yml ps
```

若未运行，执行：

```powershell
docker compose -f docker/lobster/docker-compose.yml up -d
```

---

## 2. 打开控制台

- **方式一**：双击 `docker/lobster/打开龙虾控制台.bat`，会打开 **http://localhost:18789/**
- **方式二**：浏览器直接访问 **http://localhost:18789/**

---

## 3. 若提示「需要配对」

在 PowerShell 执行：

```powershell
docker exec lobster-openclaw openclaw devices list
```

看到 Pending 的 requestId 后：

```powershell
docker exec lobster-openclaw openclaw devices approve --latest
```

回到浏览器刷新或再点「连接」。

---

## 4. 若提示「未授权：网关令牌不匹配」

从容器取 token，用带 token 的地址打开：

```powershell
docker exec lobster-openclaw cat /home/node/.openclaw/openclaw.json
```

在输出里找到 `"token": "xxxx"`，复制 `xxxx`，在浏览器打开：

**http://localhost:18789/#token=xxxx**

或在控制台 **Settings** 里粘贴同一 token，清除站点存储后重试。

---

## 5. 健康检查（可选）

- 浏览器打开：**http://localhost:18789/healthz** → 应返回 200
- 或：`curl http://localhost:18789/healthz`

---

## 小结

| 项目     | 说明 |
|----------|------|
| 上一版 demo 地址 | **http://localhost:18789/** |
| 端口     | 18789（可在 docker-compose 里用 `LOBSTER_GATEWAY_PORT` 改） |
| 功能     | WebChat 与龙虾对话，使用 CLI-Anything、RAG-Anything 等技能 |
| 详细说明 | 见同目录 `使用说明_接下来怎么办.md` |
