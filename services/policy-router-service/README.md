# Policy Router Service（策略张量与上下文路由器）

龙虾元老院策略张量 + 上下文路由微服务：将「激进度 / 拟真度 / 转化导向」三维张量通过反馈闭环更新，并按 Agent 动态组装 Prompt，实现系统级呼吸感与自愈。

## 运行

```bash
# 本地（进程内状态）
pip install -r requirements.txt
cd policy-router-service && python -m uvicorn main:app --host 0.0.0.0 --port 8010

# 或直接
python main.py
```

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `REDIS_URL` | Redis 连接串，不设则使用进程内内存 | - |
| `REDIS_POLICY_KEY` | 策略张量存储键 | `lobster:policy:tensor` |
| `POLICY_LEARNING_RATE` | 张量更新学习率 η | `0.1` |
| `POLICY_LAMBDA_REWARD` | 转化奖励权重 λ₁ | `1.0` |
| `POLICY_LAMBDA_RISK` | 风险惩罚权重 λ₂ | `1.5` |
| `POLICY_HOST` / `POLICY_PORT` | 服务监听 | `0.0.0.0` / `8010` |

## API

- **GET /api/v1/policy/current** — 返回当前策略张量（管理后台 / 金算虾 / 铁网虾）
- **POST /api/v1/policy/feedback** — 上报转化/风控反馈，更新张量（Body: `FeedbackEvent`）
- **POST /api/v1/context/generate** — Agent 领取动态 Prompt（Body: `AgentPromptRequest`）

## Docker

```bash
docker build -t policy-router-service .
docker run -p 8010:8010 -e REDIS_URL=redis://redis:6379/0 policy-router-service
```

## 与龙虾元老院的关系

当金算虾察觉大促或铁网虾察觉风控水位上升时，调用 `/api/v1/policy/feedback` 更新全局张量；下一次各 Agent 调用 `/api/v1/context/generate` 时即可拿到新策略下的 Prompt（如吐墨虾从极速冲量切回深度养号、回声虾从硬广切回闲聊）。
