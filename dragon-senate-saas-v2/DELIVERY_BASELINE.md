# Dragon Senate SaaS v2 — 交付基线 (Delivery Baseline)

> 文件日期：2026-04-14（最后更新）  
> 状态：P0 全绿 · P1 全绿 · 可演示 · AI 协作规范已接入

---

## 一键验收

```bash
# 进入项目目录
cd dragon-senate-saas-v2

# P0 核心验收（约 12 秒）
PYTHONIOENCODING=utf-8 python scripts/run_smoke_suite.py --fast

# 全量验收（约 35 秒）
PYTHONIOENCODING=utf-8 python scripts/run_smoke_suite.py

# 单项验收
PYTHONIOENCODING=utf-8 python scripts/test_workflow_event_log_resume_inprocess.py
PYTHONIOENCODING=utf-8 python scripts/test_edge_publish_heartbeat_inprocess.py
```

**期望输出**：
```
Results:  6 PASS  0 FAIL  0 SKIP  | Total ~12s     # --fast
Results: 12 PASS  0 FAIL  0 SKIP  | Total ~35s     # full
```

---

## 三种运行模式

### 模式 A：mock-LLM（CI / 前端联调，无 GPU 无 Key）

```bash
LLM_MOCK_FORCE=true uvicorn app:app --port 8000
```

验收：
```bash
curl -X POST http://localhost:8000/run-dragon-team \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"task_description":"hotel smoke test","user_id":"u1"}'
# → status=completed, content_package 有内容
```

### 模式 B：cloud-LLM（DeepSeek / DashScope）

```bash
DEEPSEEK_API_KEY=sk-... uvicorn app:app --port 8000
# 或
DASHSCOPE_API_KEY=sk-... uvicorn app:app --port 8000
```

### 模式 C：local-LLM（Ollama）

```bash
LLM_FORCE_LOCAL=true LOCAL_LLM_MODEL=qwen3:8b uvicorn app:app --port 8000
# 先确认：ollama list | grep qwen3
```

---

## 冻结 API 合约

下列端点字段名不再变动，前端可直接消费：

| 端点 | 冻结字段 |
|---|---|
| `POST /run-dragon-team` | `ok / run_id / status / content_package / strategy / copy / storyboard / execution_plan / artifact_count` |
| `POST /run-dragon-team-async` | `ok / job_id / status / eta_sec` |
| `GET /run-dragon-team-async/{job_id}` | `ok / job_id / status / progress / result` |
| `GET /api/v1/ai/artifacts/job/{job_id}` | `ok / job_id / mission_id / status / artifact_count / artifact_index / artifacts` |
| `POST /industry-kb/dissect-and-ingest` | `ok / ingested_count / skipped / quality_gate_passed` |
| `GET /api/v1/ai/execution-monitor/snapshot` | `ok / runs / total / active_count` |

---

## P0 完成清单

| 任务 | 文件 | 状态 |
|---|---|---|
| mock-LLM / real-LLM 统一运行模式 | `llm_factory.py` + `.env.example` | ✅ |
| 云端主链 contract 冻结 | `app.py` (18063 行～) | ✅ |
| 工作流事件日志 + 断点恢复 | `workflow_event_log.py` + API | ✅ |
| 边缘执行闭环 — 心跳 30s 保活 | `edge-runtime/wss_receiver.py` | ✅ |
| EdgeTaskBundle schema 验证 | `edge-runtime/task_schema.py` | ✅ |
| HeartbeatMonitor stalled 检测 | `edge-runtime/edge_heartbeat.py` | ✅ |

## P1 完成清单

| 任务 | 文件 | 状态 |
|---|---|---|
| 视频合成 → ArtifactStore | `dragon_senate.py` L433 | ✅ |
| 语音合成 → ArtifactStore | `voice_orchestrator.py` L106 | ✅ |
| 回归脚本套件（12 个） | `scripts/` | ✅ |
| 一键 smoke runner | `scripts/run_smoke_suite.py` | ✅ |

---

## 回归测试套件（12 个）

```
P0 核心（6）：
  test_workflow_event_log_resume_inprocess.py   WorkflowEventLog 断点恢复
  test_edge_publish_heartbeat_inprocess.py      边缘心跳 + stalled 检测
  test_run_dragon_team_async_inprocess.py       龙虾团队异步端到端
  test_industry_kb_dissect_ingest_inprocess.py  行业知识库摄取
  test_media_post_pipeline_inprocess.py         媒体发布管线
  test_visualizer_industry_workflow_inprocess.py Visualizer 行业路由

P1 扩展（6）：
  test_billing_commercialization_inprocess.py   计费商业化
  test_followup_deterministic_spawn_inprocess.py FollowUp 子任务拆分
  test_campaign_graph_publish_gate_inprocess.py  审批门
  test_policy_bandit_template_ab_inprocess.py    Policy Bandit A/B
  test_kernel_chain_inprocess.py                 Kernel 链路
  test_m1_auth_jwt_inprocess.py                  JWT 鉴权
```

---

## 边缘执行闭环架构

```
云端 dispatcher 龙虾
  └─ 推送 EdgeTaskBundle (task_schema.py)
       ↓ WebSocket (wss_receiver.py)
边缘 WSSReceiver
  ├─ _task_heartbeat_loop()  ← 每 30s 向云端发 task_progress
  └─ _task_handler()         ← 调用 marionette_executor / content_publisher
       ↓ 完成/失败
  _send_completed(success=True/False)
       ↓
云端 HeartbeatMonitor (edge_heartbeat.py)
  ├─ get_stalled_tasks(timeout_sec=90)  ← 超时未心跳 → stalled
  └─ check_and_handle_stalled()         ← 每分钟由 scheduler 调用
```

---

## 动态配置热加载

通过 `DynamicConfig` 管理，无需重启即可生效的参数：

```bash
# 查看当前动态配置
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/v1/ai/dynamic-config

# 热更新（admin 角色）
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"LLM_TEMPERATURE","value":"0.5"}' \
  http://localhost:8000/api/v1/ai/dynamic-config
```

---

## 变更日志

| 日期 | 变更内容 | 影响文件 |
|---|---|---|
| 2026-04-13 | P0/P1 全部验收通过；smoke suite 12 项全绿；边缘心跳保活接入 | `wss_receiver.py` / `workflow_event_log.py` / `app.py` / `scripts/` |
| 2026-04-14 | 接入 Karpathy Guidelines（规则 3+4 全量，规则 1 核心文件，规则 2 新模块）；新建两个 `CLAUDE.md` | `dragon-senate-saas-v2/CLAUDE.md` / `edge-runtime/CLAUDE.md` |
