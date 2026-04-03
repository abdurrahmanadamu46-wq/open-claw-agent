# ClawCommerce 架构底线：前端与 Agent 禁止直连

> PM 研发协同指令 v1.12 — 人员调整后边界不退让

---

## 铁律（小军紧箍咒）

- **前端（Next.js/React）** 只能和后端对话：必须且只能调用小明提供的 **NestJS REST API**（即前端 `src/services/` 的 baseURL 只能是后端地址）。
- **Agent（Node/Playwright）** 也只能和后端对话：只接收后端的任务调度（HTTP POST /internal/campaign/execute），并把线索 POST 给后端的**内网 API**（/api/internal/leads）。

**禁止**：前端向 Agent 发起跨域请求或 WebSocket 连接。  
**原因**：鉴权、日志、扩容均以后端为唯一中台；前端直连 Agent 会导致中台堡垒失效。

---

## 数据流（唯一合法路径）

```
前端 UI  --(仅 REST)-->  后端 NestJS  --(BullMQ + HTTP)-->  Agent
                              ^                                  |
                              |    线索 POST /api/internal/leads |
                              +----------------------------------+
```

- 前端：只调 `NEXT_PUBLIC_API_BASE_URL`（后端），不配置、不感知 Agent 地址。
- Agent：只认 `BACKEND_INTERNAL_URL`、`INTERNAL_API_SECRET`，不对外暴露给前端。
