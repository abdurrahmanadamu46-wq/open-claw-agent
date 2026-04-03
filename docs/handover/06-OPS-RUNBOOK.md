# 06-OPS-RUNBOOK（运维排障手册）

Last Updated: 2026-03-26

## 1. 服务职责一览

- `web`：前端控制台（3001 -> 本地映射 3301）
- `backend`：统一 API 网关（38789 -> 本地映射 48789）
- `ai-subservice`：龙虾元老院 AI 子服务（8000 -> 本地映射 18000）
- `postgres`：业务数据
- `redis`：队列/缓存
- `qdrant`：向量检索
- `ollama`：本地模型

## 2. 标准排障流程（5 步）

1. 看容器状态
```powershell
npm run module:ps
```

2. 看后端是否活着
```powershell
curl http://127.0.0.1:48789/autopilot/status
```

3. 看 AI 子服务健康
```powershell
curl http://127.0.0.1:18000/healthz
```

4. 看前端是否可访问
```powershell
curl http://127.0.0.1:3301
```

5. 看关键日志
```powershell
docker compose logs --tail=200 backend
docker compose logs --tail=200 ai-subservice
docker compose logs --tail=200 web
```

## 3. 高频故障与处理

### A. 前端打开白屏
- 先确认 `web` 容器正常。
- 再确认 API 地址是否连通。
- 最后重建 web 镜像：
```powershell
docker compose up -d --build web
```

### B. 登录失败/拒绝连接
- 检查 backend 端口映射是否还在 48789。
- 检查本地数据库是否可用。
- 重新拉起 control 链路：
```powershell
npm run module:down:control
npm run module:up:control
```

### C. 飞书回调 URL invalid
- 先执行预检脚本：
```powershell
python dragon-senate-saas-v2/scripts/preflight_feishu_callback.py --url https://api.sflaw.store/webhook/chat_gateway
```
- 检查 DNS -> HTTPS -> challenge -> 签名，必须按顺序。

### D. 页面显示但数据不更新
- 判定为“展示态/伪数据残留”风险。
- 必须将页面改为真实 API 联动或明确空态提示。

## 4. 商业化切真预检

### Payment
```powershell
npm run preflight:payment
```

### Notifications
```powershell
npm run preflight:notifications
```

### Feishu callback
```powershell
npm run preflight:feishu
```

### Supporting runbooks
- `docs/handover/10-PAYMENT-CUTOVER-RUNBOOK.md`
- `docs/handover/11-NOTIFICATION-CUTOVER-RUNBOOK.md`
- `docs/handover/12-FEISHU-CUTOVER-RUNBOOK.md`

## 4.1 本机缓存清理

### Dry run
```powershell
npm run system:cleanup:caches
```

### Apply
```powershell
npm run system:cleanup:caches:apply
```

默认清理项：
- `AppData\\Local\\pip\\Cache`
- `AppData\\Local\\npm-cache`
- `AppData\\Local\\CrashDumps`
- `AppData\\Local\\Temp` 中超过 3 天的内容

默认不会清理：
- `C:\\Users\\Administrator\\.ollama`
- `AppData\\Local\\ms-playwright`

原因：这些目录可能仍被本地模型调试链路或回归环境使用，需人工确认后再删。

## 4.2 大目录迁移到 F 盘

### 通用迁移脚本
```powershell
powershell -ExecutionPolicy Bypass -File scripts/system/migrate-dir-to-f.ps1 -SourcePath "<C-path>" -TargetPath "<F-path>"
```

### 当前已迁移
- `C:\\Users\\Administrator\\.ollama -> F:\\openclaw-agent\\models\\ollama-home`
- `C:\\Users\\Administrator\\AppData\\Local\\ms-playwright -> F:\\openclaw-agent\\cache\\ms-playwright`
- 工作区热备：`F:\\openclaw-agent\\workspace`

### 【SKIP_TEMP】
- 当前活动工作区本体联接切换未执行。
原因：当前 Codex 会话和 git/workspace 正在使用 `C:\\Users\\Administrator\\Desktop\\openclaw-agent`，硬切会增加中断风险。
- Docker WSL data 未迁移。
原因：需要停 Docker/WSL，建议在维护窗口执行 `scripts/docker/pin-docker-data-to-f.ps1`。

## 5. 回滚SOP

1. 记录当前分支和变更文件。
2. 备份当前状态（建议先同步 F 盘）。
3. 回滚到最近可用 commit。
4. 重跑：`module:up:control` + `module:test:release`。
5. 在 `SKIP_TEMP.md`/`PROJECT_STATE.md`写明事故与回滚结论。

## 6. 值班原则
- 不直接在生产做破坏性操作。
- 高风险动作先审批后执行。
- 所有修复必须带回归命令与证据。
