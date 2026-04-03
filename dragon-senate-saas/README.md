# 龙虾元老院 SaaS（大陆版）

基于 FastAPI + LangGraph + Docker，目标部署在阿里云 ECS（cn-shanghai）+ 阿里云 RDS PostgreSQL。

## 架构说明

- 单服务封装 9 只龙虾元老院流程：
  - `radar -> strategist -> (inkwriter || visualizer) -> dispatcher -> (echoer || catcher) -> abacus -> conditional(followup|feedback) -> feedback`
- 多用户隔离：
  - 每次请求使用 `thread_id = user_id`，由 Postgres checkpointer 持久化
- 登录鉴权：
  - `POST /auth/login` 获取 JWT
  - `POST /run-dragon-team` 需 Bearer Token，且默认要求 `user_id == 登录用户名`

## 一、阿里云购买步骤（ECS）

1. 地域选择：`华东2（上海）cn-shanghai`
2. ECS 规格建议：
   - 测试：2vCPU / 4GB
   - 小流量生产：4vCPU / 8GB 起
3. 系统镜像：Ubuntu 22.04 LTS
4. 公网带宽：按需（建议 3Mbps 起）
5. 绑定弹性公网 IP

## 二、RDS PostgreSQL 创建步骤

1. 创建 RDS PostgreSQL（推荐 15/16）
2. 创建数据库：`dragon_db`
3. 创建账号并授权数据库读写
4. 白名单配置：
   - 添加 ECS 的私网 IP（推荐）
   - 不建议直接放开 `0.0.0.0/0`
5. 拿到连接串填入 `.env` 的 `DATABASE_URL`

## 三、安全组配置（ECS）

放行入方向：

- `22/tcp`（SSH）
- `80/tcp`（HTTP，证书签发与跳转）
- `443/tcp`（HTTPS）

说明：`5432` 是 RDS 端口，不建议在 ECS 安全组对公网开放。

## 四、环境变量说明

见 `.env.example`：

- `DATABASE_URL`：阿里云 RDS PostgreSQL 连接串
- `OPENAI_API_KEY`：模型调用 key
- `CLAWHUB_KEYS`：各龙虾元老技能 key（JSON）
- `JWT_SECRET`：JWT 签名密钥
- `JWT_EXPIRE_MINUTES`：JWT 过期时间（分钟）
- `APP_USERS_JSON`：登录用户配置（JSON 数组）

## 五、本地测试（可选）

```bash
cp .env.example .env
docker compose up -d --build
curl http://127.0.0.1:8000/healthz
```

## 六、一键部署到 ECS

在 ECS 上执行：

```bash
git clone <你的仓库地址> /opt/dragon-senate-saas
cd /opt/dragon-senate-saas/dragon-senate-saas
bash deploy.sh
```

`deploy.sh` 会自动执行：

1. 安装 Docker / Docker Compose / Nginx / Certbot
2. 拉取最新代码
3. 引导填写 `.env`
4. `docker compose up -d --build`
5. 配置 Nginx 反代
6. 申请 Let's Encrypt 证书并启用 HTTPS

## 七、接口测试示例

1. 登录获取 JWT：

```bash
curl -X POST https://你的域名/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"change_me"}'
```

2. 调用 9 只龙虾协作：

```bash
curl -X POST https://你的域名/run-dragon-team \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <上一步token>" \
  -d '{
    "task_description":"给我做一轮小红书+抖音的种草转化计划，并识别高意向线索",
    "user_id":"admin"
  }'
```

3. 查询状态：

```bash
curl -H "Authorization: Bearer <token>" https://你的域名/status/admin
```
