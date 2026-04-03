# 运行与验证手册（Run & Verify）

Last Updated: 2026-03-26

## 1) 最小启动链路
```powershell
npm run module:up:control
npm run module:ps
```

预期：`web/backend/ai-subservice/postgres/redis/qdrant/ollama` 为 `Up` 或 `healthy`。

## 2) 常用命令
```powershell
# 状态
npm run module:ps

# 启停
npm run module:up:control
npm run module:down:control

# 仅 AI 链路
npm run module:up:ai

# 发布前回归
npm run module:test:release

# 合同校验
npm run contracts:validate

# F 盘备份同步
npm run backup:f:sync
```

## 3) HTTP 冒烟检查
```powershell
curl http://127.0.0.1:3301
curl http://127.0.0.1:48789/autopilot/status
curl http://127.0.0.1:18000/healthz
curl http://127.0.0.1:18000/docs
```

## 4) 鉴权与 API 检查
```powershell
# 登录拿 token
$payload = @{ username='admin'; password='change_me' } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:48789/auth/login' -ContentType 'application/json' -Body $payload
$token = $login.access_token

# 调后台受保护接口
Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:48789/api/v1/ai/health?tenant_id=tenant_demo' -Headers @{ Authorization = "Bearer $token" }
```

## 5) 常见问题与处理
1. Backend 探活不是 `/health`，用 `/autopilot/status`。
2. AI 子服务探活是 `/healthz`，不是 `/health`。
3. 飞书回调 URL invalid，先跑：
```powershell
python dragon-senate-saas-v2/scripts/preflight_feishu_callback.py --url https://api.sflaw.store/webhook/chat_gateway
```
4. 前端改动后页面无变化，先确认容器是否重建：
```powershell
docker compose up -d --build web
```
5. 若 C 盘空间紧张，先执行 F 盘备份同步，再做清理：
```powershell
npm run backup:f:sync
```

## 6) 交接最小验收标准
- 能启动并访问 5 个入口（见 Start Here）。
- 能完成一次登录并访问受保护接口。
- 能跑一条 release 回归并记录结果。
- 能将当前修改同步到 F 盘备份目录。
