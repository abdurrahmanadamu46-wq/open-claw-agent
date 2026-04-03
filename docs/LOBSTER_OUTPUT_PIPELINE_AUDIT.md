# 龙虾产出链路全景审计
> 2026-04-01 | 实事求是，哪段通了，哪段断了，一条一条说清楚

---

## 🗺️ 完整链路图

```
你（老板）
   ↓ 下达任务
[大脑/commander_graph_builder.py]
   ↓ 调度分解
[龙虾们执行]
   ↓ 每步产出物
[产出物存储] ← 这里是问题所在
   ↓ 汇聚
[可视化看板] ← 这里目前几乎没有
   ↓ 发布
[边缘端/edge-runtime] → 平台（抖音/小红书/微信）
   ↓ 数据回流
[abacus分析] → [全团队复盘]
```

---

## ✅ 已经打通的部分

### 1. 任务调度层（完整）
- `commander_graph_builder.py` → 构建任务DAG，分配给各龙虾
- `lobster_mailbox.py` → 龙虾间消息收发（单播+广播，SQLite持久化）✅
- `lobster_task_dag.py` → 任务依赖管理 ✅
- `workflow_event_log.py` → **每一步执行都有事件记录（SQLite）** ✅
  - step_started / step_completed / step_failed 全部有记录
  - 支持断点续跑（get_resume_point）
  - 支持get_timeline()查询完整时间线

### 2. 执行记录层（完整）
- `llm_call_logger.py` → 每次LLM调用记录（tokens/模型/延迟）✅
- `audit_logger.py` → 审计日志 ✅
- `workflow_event_log.py` → 步骤事件溯源 ✅
- `tenant_audit_log.py` → 租户级操作日志 ✅

### 3. 边缘发布层（完整）
- `edge-runtime/marionette_executor.py` → 边缘端执行发布动作 ✅
- `edge-runtime/wss_receiver.py` → 接收中心下发的任务 ✅
- `edge-runtime/edge_heartbeat.py` → 边缘心跳上报 ✅
- `media_post_pipeline.py` → 媒体后制处理流程 ✅

### 4. 数据存储（完整）
- `data/workflow_event_log.sqlite` → 工作流事件（已有）✅
- `data/lobster_mailbox.sqlite` → 龙虾通信记录 ✅
- `dragon_auth.db` / `dragon_billing.db` → 认证/计费 ✅
- `observability_api.py` → 可观测性API（已有接口）✅

---

## ❌ 断掉的部分（这是你看不到的根因）

### 断点1：龙虾产出物没有统一落地位置
```
问题：
  inkwriter 写完文案 → 目前只在LLM响应里，没有写到统一的"产出物仓库"
  visualizer 做完图 → 文件在本地，没有注册到可查的索引
  radar 发出情报包 → 通过Mailbox发给strategist，但没有存到可回溯的地方
  
现有代码只有：
  lobster_runner.py → 执行龙虾并返回结果（但结果存哪里？没有统一规范）
  lobster_session.py → 会话上下文（但产出物没有独立持久化）

缺少的：
  ❌ artifact_store（产出物仓库）：按任务ID/龙虾/时间存储每次产出物
  artifact_validator.py 存在但只做格式校验，不做存储
```

### 断点2：没有"你能看到的"可视化入口
```
问题：
  workflow_event_log.py 有 get_timeline() API → 但没有前端页面调用它
  observability_api.py 有监控接口 → 但没有Dashboard把它展示出来
  
现有代码：
  observability_api.py → 有 /metrics /health /timeline 接口 ✅
  api_lobster_realtime.py → 有实时推送接口（WebSocket）✅
  
缺少的：
  ❌ 前端Dashboard页面（能看到10只龙虾状态/当前任务/产出物）
  ❌ 产出物浏览器（能看到每个任务产出了什么）
```

### 断点3：产出物到发布的链路不自动
```
问题：
  inkwriter产出文案 → visualizer要手动来取（通过Mailbox，但没有自动触发）
  visualizer产出视频 → dispatcher要手动来取
  
现有代码：
  lobster_mailbox.py → 消息可以发，但下一个龙虾要主动来receive()
  webhook_event_bus.py → 有事件总线，但没有绑定"产出物完成→自动触发下一龙虾"
  
缺少的：
  ❌ 产出物事件钩子：当产出物写入后，自动通知下游龙虾
  （webhook_event_bus.py 有基础设施，但没有连上产出物系统）
```

### 断点4：abacus看不到完整数据回路
```
问题：
  发布后的平台数据（互动量/完播率）没有自动回流到abacus
  abacus目前只能手动查，没有自动汇聚
  
现有代码：
  research_radar_fetchers.py → 有抓取能力
  research_radar_store.py → 有存储结构
  
缺少的：
  ❌ 发布后自动触发数据抓取的定时任务
  ❌ 数据回流→abacus→自动更新skills.json的闭环
```

---

## 🔧 修复方案（优先级排序）

### P0：建立产出物统一存储（先解决"存哪里"）

**新建 `artifact_store.py`（复用已有SQLite模式）：**
```python
# 每次龙虾完成一个任务，必须调用：
artifact_store.save(
    run_id="...",
    lobster="inkwriter",
    artifact_type="copy",   # copy/brief/intel/visual/publish_result
    content="...",          # 文案内容
    meta={"platform": "douyin", "version": 3}
)

# 你查询时：
artifact_store.list(run_id="...", lobster="inkwriter")
# → 看到inkwriter这个任务产出了什么
```

**需要改动的地方：**
- `lobster_runner.py`：执行完后调用 `artifact_store.save()`
- `workflow_event_log.step_completed()`：附上 artifact_id

---

### P1：打通产出物→下游触发（解决"自动流转"）

**用现有的 `webhook_event_bus.py`，绑定产出物事件：**
```python
# inkwriter存完产出物后，事件总线自动触发：
event_bus.emit("artifact.created", {
    "lobster": "inkwriter",
    "artifact_type": "copy",
    "artifact_id": "...",
    "next_lobster": "visualizer"  # 自动通知下一个
})

# visualizer订阅 artifact.created 事件，收到后自动开始工作
```

---

### P2：建立可视化Dashboard（解决"你能看到"）

**最快方案：用现有 `observability_api.py` 的接口，加一个HTML页面：**

当前已有接口：
```
GET /api/v1/workflow/{run_id}/timeline  → 工作流事件时间线
GET /api/v1/lobsters/status             → 龙虾状态
GET /api/v1/metrics                     → 全局指标
WS  /api/v1/lobster/realtime            → 实时推送
```

**只需要新建一个单页HTML（不需要框架），调用这些接口：**
```
┌─────────────────────────────────────────┐
│  Dragon Senate 指挥中心                  │
├─────────────────────────────────────────┤
│  当前任务：美妆推广 run-xxx              │
│  进度：████████░░ 8/14 步               │
│                                         │
│  龙虾状态：                             │
│  ✅ radar    → 已完成 情报包已发出      │
│  ✅ strategist → 已完成 brief已发出    │
│  🔄 inkwriter → 执行中 (3min)          │
│  ⏳ visualizer → 等待                  │
│  ⏳ dispatcher → 等待                  │
│                                         │
│  产出物：                               │
│  [情报包] [策略brief] [文案v1/v2/v3]    │
│                                         │
│  实时日志：                             │
│  09:15:03 inkwriter 开始生成标题        │
│  09:15:07 inkwriter 完成版本1           │
└─────────────────────────────────────────┘
```

---

### P3：数据回流闭环（解决"abacus能看到发布结果"）

**用现有 `cron_scheduler.py` + `research_radar_fetchers.py`：**
```python
# 发布成功后，设置定时器（30分钟/6小时/24小时后抓数据）
workflow_event_log.set_timer(
    run_id=run_id,
    fire_at_iso="30分钟后",
    signal_name="fetch_publish_metrics",
    payload={"post_url": "...", "platform": "douyin"}
)

# timer触发后，自动抓互动数据 → 写入abacus的知识库
```

---

## 📊 链路现状总结

| 链路段 | 状态 | 说明 |
|--------|------|------|
| 任务下达→龙虾调度 | ✅ 已打通 | commander_graph_builder + lobster_mailbox |
| 龙虾执行记录 | ✅ 已打通 | workflow_event_log完整记录每步 |
| 龙虾间消息传递 | ✅ 已打通 | lobster_mailbox单播+广播 |
| 产出物统一存储 | ❌ 未打通 | 缺artifact_store，产出物散落各处 |
| 产出物→下游自动触发 | ❌ 未打通 | 有event_bus基础设施但没连上 |
| 可视化Dashboard | ❌ 未打通 | 有API但无前端页面 |
| 发布→数据回流→abacus | ❌ 未打通 | 有基础组件但没串起来 |
| 边缘端发布执行 | ✅ 已打通 | marionette_executor + wss_receiver |

---

## 🎯 最小可行行动（让你今天就能看到东西）

**第一步（30分钟=1天）：建 `artifact_store.py`**
→ 龙虾每次完成任务写产出物，你能查到

**第二步（30分钟=1天）：建 `dashboard.html`**  
→ 调用现有observability_api接口，你能看到实时状态

**第三步（1小时=2天）：连 `webhook_event_bus.py`**
→ 产出物完成自动触发下一龙虾，不需要手动

完成这3步，**从你下达任务到最终发布的整条链路就可视化了**。

---

*审计时间：2026-04-01 | 实事求是，不粉饰，哪里断了说哪里*
