# BYOK 算力中台 — new-api

基于 [QuantumNous/new-api](https://github.com/QuantumNous/new-api) 的 OpenAI 兼容 API 网关，用于密钥池化、计费、多模型路由。

## 一键起飞

```bash
cd deploy/new-api
docker compose up -d
```

- **API 与管理后台**：http://localhost:3001  
- **OpenAI 兼容端点**：`http://localhost:3001/v1/chat/completions` 等

## 与 NestJS 对接

在 NestJS 环境变量中配置：

- `NEW_API_BASE_URL=http://localhost:3001`（或你的 new-api 地址）
- `NEW_API_TOKEN=<在 new-api 后台生成的统一 Token>`

后端 `LlmService` 会自动将 LLM 请求发往 new-api，并在 Header 中带上 Token。

## 生产注意

- 修改 `docker-compose.yml` 中 PostgreSQL 与 Redis 的默认密码
- 在 new-api 后台创建 Token 并写入 `NEW_API_TOKEN`
