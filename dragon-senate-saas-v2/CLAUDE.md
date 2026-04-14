# CLAUDE.md — Dragon Senate SaaS v2 AI 协作规范

> 版本：1.0.0  
> 生效日期：2026-04-14  
> 来源：基于 [Karpathy Guidelines](https://github.com/forrestchang/andrej-karpathy-skills) 定制，针对本项目做了覆盖和分级

---

## 快速参考

```bash
# 每次改动后必跑——全绿才算完成
PYTHONIOENCODING=utf-8 python scripts/run_smoke_suite.py --fast
# 期望：6 PASS  0 FAIL  0 SKIP
```

---

## 行为规则（分阶段生效）

### 规则 3：Surgical Changes — 立即全量生效 🔴

**只改被要求改的。不顺手重构。**

改代码时：
- 不「顺手」改相邻的代码、注释、格式
- 不重构没有坏掉的东西
- 匹配已有代码风格，即使你觉得另一种更好
- 发现不相关的问题：**报告，但不处理**

自己的改动产生了孤儿时：
- 移除**你的改动**造成的无用 import / 变量 / 函数
- 不删除改动前已存在的死代码，除非明确被要求

验证标准：**每一行改动都能直接追溯到用户的要求。**

#### 本项目冻结文件（额外约束）

以下文件改动需要特别谨慎，字段名和函数签名不得擅自修改：

| 文件 | 约束 |
|---|---|
| `app.py` | 只追加新端点，不重构已有函数；冻结 API 字段名见 `DELIVERY_BASELINE.md` |
| `dragon_senate.py` | 不改已有龙虾函数签名，新增功能用新函数 |
| `workflow_event_log.py` | 方法签名冻结，改前先确认参数名（`tokens_used` 不是 `tokens`） |
| `task_schema.py`（edge-runtime）| Pydantic 模型字段不得删除，新增字段必须有默认值 |

---

### 规则 4：Goal-Driven Execution — 立即全量生效 🔴

**定义可验证目标，循环直到通过。**

接到任务时，先把模糊描述转成可验证目标：

```
「修一下边缘心跳」
→「修改 wss_receiver.py 的 _handle_task，
   完成标准：test_edge_publish_heartbeat_inprocess.py PASS，
   且 run_smoke_suite.py --fast 仍然 6 PASS 0 FAIL」
```

多步任务先列计划：

```
1. [读] 确认 HeartbeatPayload 构造函数签名     → verify: python -c "from edge_heartbeat import HeartbeatPayload; print(HeartbeatPayload.__dataclass_fields__.keys())"
2. [改] 修改 _task_heartbeat_loop 发送频率     → verify: 目标函数存在且逻辑正确
3. [跑] run_smoke_suite.py --fast              → verify: 6 PASS 0 FAIL
```

#### 本项目的强制退出条件

| 场景 | 退出条件 |
|---|---|
| 改动 `dragon-senate-saas-v2/` 任意 `.py` | `run_smoke_suite.py --fast` → 6 PASS 0 FAIL |
| 改动 `edge-runtime/` 任意 `.py` | `test_edge_publish_heartbeat_inprocess.py` PASS |
| 改动 `web/src/` 任意 `.tsx/.ts` | `npx tsc --noEmit` 0 errors |
| 改动 `app.py` 端点 | 对应端点 `curl` 验证返回冻结字段 |

未达到退出条件时，**继续修，不要停下来等用户确认**。

#### Smoke Suite 覆盖范围声明

当前 12 个测试覆盖：核心链路、边缘心跳、鉴权、计费、Visualizer、FollowUp。

**未覆盖（全绿 ≠ 生产就绪）**：
- 并发竞态（两个边缘节点同时领取同一任务）
- 跨租户数据隔离
- WebSocket 断线重连中途的任务状态
- 超过 token 配额时的降级行为

---

### 规则 1：Think Before Coding — 核心文件生效 🟡

**在不确定时停下来，不要默默猜。**

以下情况必须先说清楚再动手：

- 对 `app.py`、`dragon_senate.py`、`commander_graph_builder.py` 的改动
- 改动会影响冻结 API 字段名的情况
- 同一个需求有多种实现路径时

具体做法：
- 有不确定的地方，先列假设，等确认
- 多种理解并存时，列出来让用户选，不要默默选一个
- 有更简单的方案，说出来，但等授权再做

**探索性代码、新脚本、测试文件**：不强制规则 1，可直接写。

---

### 规则 2：Simplicity First — 新模块生效 🟢

**够用就好，不加没要求的东西。**

新建模块时：
- 不加没被要求的功能
- 单次使用的代码不做抽象
- 没要求「灵活配置」就不加配置项
- 不处理不可能发生的场景

自问：「资深工程师看了会说这过度设计吗？」如果会，就简化。

**已有大文件（`app.py`、`dragon_senate.py`）豁免此规则**：  
不要因为规则 2 去重构这两个文件，它们受冻结合约保护，重构需要单独立项。

---

## 项目架构约束（不受规则版本控制，永久生效）

### 边界隔离

```
dragon-senate-saas-v2/   ← 云端：LLM 调用、任务调度、ArtifactStore
edge-runtime/            ← 边缘：浏览器自动化、发布执行，不调 LLM
web/                     ← 前端：只消费冻结 API，不直接访问 DB
```

**禁止**：`edge-runtime/` 内 import `dragon-senate-saas-v2/` 的任何模块（反向亦然）。

### LLM 模式切换

```bash
# mock 模式（CI / 前端联调）
LLM_MOCK_FORCE=true uvicorn app:app --port 8000

# cloud 模式
DEEPSEEK_API_KEY=sk-... uvicorn app:app --port 8000

# local 模式
LLM_FORCE_LOCAL=true LOCAL_LLM_MODEL=qwen3:8b uvicorn app:app --port 8000
```

**改动 LLM 路由相关代码（`llm_factory.py`、`llm_router.py`）前**，必须确认三种模式都能通过：
```bash
LLM_MOCK_FORCE=true python scripts/test_run_dragon_team_async_inprocess.py
```

### 冻结 API 字段（不得改名）

| 端点 | 冻结字段 |
|---|---|
| `POST /run-dragon-team` | `ok / run_id / status / content_package / strategy / copy / storyboard / execution_plan / artifact_count` |
| `GET /api/v1/ai/artifacts/job/{job_id}` | `ok / job_id / mission_id / status / artifact_count / artifact_index / artifacts` |
| `POST /run-dragon-team-async` | `ok / job_id / status / eta_sec` |

完整列表见 `DELIVERY_BASELINE.md`。

---

## 常用验证命令速查

```bash
# P0 核心验收（12 秒）
PYTHONIOENCODING=utf-8 python scripts/run_smoke_suite.py --fast

# 全量验收（35 秒）
PYTHONIOENCODING=utf-8 python scripts/run_smoke_suite.py

# 单项验收
PYTHONIOENCODING=utf-8 python scripts/test_workflow_event_log_resume_inprocess.py
PYTHONIOENCODING=utf-8 python scripts/test_edge_publish_heartbeat_inprocess.py

# 前端类型检查
cd web && npx tsc --noEmit

# 端点冒烟
curl -X POST http://localhost:8000/run-dragon-team \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"task_description":"smoke","user_id":"u1"}'
```

---

## 变更日志

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-04-14 | 1.0.0 | 初始版本。采用 Karpathy Guidelines 规则 3+4（全量）、规则 1（核心文件）、规则 2（新模块）；新增项目架构约束和冻结 API 字段表 |
