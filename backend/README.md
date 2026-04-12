# ClawCommerce NestJS Backend — Device Auth + Redis Ticket

## Redis Ticket 生命周期

| 状态 | 说明 |
|------|------|
| **PENDING** | Tauri 已取 ticket，展示二维码，等手机扫码 |
| **SCANNED** | （可选）本版未用，可后续加 |
| **CONFIRMED** | 授权完成即 **Burn**：Redis key 删除，JWT 经 WS 下发 |

## 运行

```bash
cd backend
npm install
# 需本地 Redis。若用 docker-compose.backend.yml（端口 6380）则：
set REDIS_HOST=127.0.0.1
set REDIS_PORT=6380
set JWT_SECRET=your-secret
# 默认端口 38789；若被占用：set PORT=39888
npm run start:dev
```

默认 HTTP `http://localhost:3000`，WebSocket 路径 **`/agent-cc`**（Socket.io）。

## API

### 1. 申请绑定 Ticket（Tauri，无需登录）

```http
POST /api/v1/devices/bind-ticket
Content-Type: application/json

{ "machine_code": "MAC_A1_B2_C3_D4" }
```

响应：`ticket_id`、`expires_in: 300`、`ws_room`。

### 2. Tauri WebSocket 进房等待

连接 `http://localhost:3000/agent-cc` 后发送：

```json
{ "ticket_id": "TICKET_XXX" }
```

事件名：**`client.auth.listen`**（Socket.io 消息体为上述 JSON）。

### 3. 确认绑定（控制台 JWT）

```http
POST /api/v1/devices/confirm-bind
Authorization: Bearer <控制台用户JWT，payload 含 tenantId>
Content-Type: application/json

{ "ticket_id": "TICKET_XXX" }
```

成功后 Tauri 所在房间收到 **`server.auth.success`**：

```json
{
  "message": "授权成功",
  "access_token": "...",
  "tenant_id": "..."
}
```

## 目录

- `src/device-auth/device-auth.controller.ts` — REST
- `src/device-auth/device-auth.service.ts` — Redis + JWT + Burn
- `src/gateway/agent-cc.gateway.ts` — `client.auth.listen` + `emitAuthSuccess`
- `src/device/device.service.ts` — DB 占位，可换 TypeORM
- `src/auth/jwt-auth.guard.ts` — confirm-bind 鉴权
