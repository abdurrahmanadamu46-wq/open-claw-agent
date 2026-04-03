# Clawith 深度源码分析 — 与龙虾元老院的借鉴映射

> ?? ????????? `state.json / focus.json / Soul ???` ??????? **CODEX-AA-01** ? `working.json + SOUL.md + AGENTS.md + heartbeat.json` ?????


> **分析对象**: [dataelement/Clawith](https://github.com/dataelement/Clawith) — 开源多Agent协作平台
> **分析时间**: 2026-03-31
> **目的**: 识别可借鉴模式，映射到我们的 Commander + 9 龙虾 + SaaS 系统

---

## 一、Clawith 一句话定位

**Clawith** = 开源企业级多Agent协作平台。每个Agent有持久身份(soul.md)、长期记忆(memory.md)、私有工作空间、自主触发器(Aware)，Agent之间可建立关系并协作，形成"数字员工团队"。

---

## 二、架构全景对照

| 维度 | Clawith | 我们 (龙虾元老院) | 差异分析 |
|------|---------|-------------------|---------|
| **Agent 定位** | 通用"数字员工"，用户自定义角色 | 预设9只专业龙虾，角色固化 | Clawith灵活，我们专业。**互补而非替代** |
| **Agent 身份** | soul.md + memory.md + workspace 文件系统 | role-card.json + prompt-kit + memory-policy | Clawith 用文件系统做持久化身份，我们用结构化JSON |
| **Agent 协作** | A2A 双向关系表 + Participant 路由 + Plaza 市场 | Commander 中心化编排 + LangGraph DAG | Clawith 去中心化P2P，我们中心化编排 |
| **自主能力** | **Aware 引擎** (6种Trigger + Focus + 自适应) | ❌ 无自主触发能力 | **最大差距！** |
| **边缘计算** | OpenClaw Gateway (Poll-Report-Send) | edge-runtime (WSS + Marionette) | 我们更成熟，Clawith更简洁 |
| **多租户** | tenant_id 全表隔离 + RBAC + Organization | 基础 tenant_id，无完整 RBAC | Clawith 更成熟 |
| **IM 集成** | 飞书/钉钉/企微/Slack/Discord 全通道 | ❌ 无 IM 集成 | **重要差距** |
| **审批治理** | autonomy_policy L1/L2/L3 分级 | approval_gate + audit_logger | Clawith 的 L1/L2/L3 更精细 |
| **工具系统** | MCP Client + Smithery + 运行时发现 | skill_bindings 硬编码 | Clawith 可动态发现安装工具 |
| **Token 管控** | 日/月配额 + LLM调用次数限制 + 估算降级 | 基础 token 追踪 | Clawith 更完善 |
| **前端** | React 19 + Zustand + Linear-Style 暗色主题 | 规划中 | Clawith 前端成熟度高 |
| **技术栈** | FastAPI + SQLAlchemy async + PostgreSQL | FastAPI + SQLAlchemy async + SQLite | 一致性高，便于借鉴 |

---

## 三、高价值借鉴清单（按优先级排序）

### 🔴 P0 — Aware 自主意识引擎（我们完全缺失）

**Clawith 的做法**：
- `AgentTrigger` 模型：6种触发类型 (cron/once/interval/poll/on_message/webhook)
- `Focus Items`：Agent 维护结构化工作记忆（`[ ]`待办/`[/]`进行中/`[x]`完成）
- `Focus-Trigger Binding`：每个触发器通过 `focus_ref` 绑定到 Focus 项
- `trigger_daemon.py`：后台守护进程，周期性扫描触发条件
- `heartbeat.py`：Agent 心跳 + 自主唤醒
- 触发时伪造 SystemMessage 注入 WebSocket，唤醒 Agent 执行

**映射到我们**：
- **触须虾 Radar** 天然需要 `poll` 和 `cron` 触发（定时扫描热点）
- **回声虾 Echoer** 需要 `on_message` 触发（有新互动时自动回复）
- **跟进虾 FollowUp** 需要 `interval` 触发（定时检查跟进任务）
- **铁网虾 Catcher** 需要 `webhook` 触发（收到新线索时自动评估）

**建议**：为每只龙虾添加 Trigger 支持，让它们从"被动调用"变为"主动工作"。这是**商业化的关键差异化**。

**信息状态**：✅ 已确认事实（源码可验证）

---

### 🔴 P0 — Agent A2A 通信协议（我们只有 Commander 单向编排）

**Clawith 的做法**：
- `AgentAgentRelationship` 双向关系表 → 权限控制
- `send_message_to_agent()` / `send_file_to_agent()` → A2A 通信
- `Participant` 统一路由表 → 人和Agent都是参与者
- 关系检查防止 Prompt Injection 横向攻击

**映射到我们**：
- 龙虾之间目前通过 LangGraph 节点传递 `DragonState`，是**数据流**而非**对话**
- 如果龙虾能互相"聊天"，场景更丰富：
  - 触须虾发现竞品动作 → 主动@军师虾讨论对策
  - 铁网虾捕获高意向线索 → 主动@跟进虾启动跟进
  - 金算虾发现 ROI 异常 → 主动@回声虾调整策略

**建议**：在 `dragon_senate.py` 的 DAG 基础上，增加 A2A 消息通道。

**信息状态**：✅ 已确认事实

---

### 🟡 P1 — Autonomy Policy L1/L2/L3 分级（我们的审批粒度不够）

**Clawith 的做法**：
```python
autonomy_policy = {
    "read_files": "L1",           # 自由执行
    "write_workspace_files": "L2", # 执行后通知
    "send_feishu_message": "L2",   # 执行后通知
    "send_external_message": "L3", # 需要预先审批
    "modify_soul": "L3",           # 需要预先审批
    "financial_operations": "L3",  # 需要预先审批
    "delete_files": "L3",          # 需要预先审批
}
```
- L1 = 自由执行，无需通知
- L2 = 执行后自动通知人类
- L3 = 执行前必须人类审批

**映射到我们**：
- 我们的 `approval_gate.py` 是全有或全无的审批
- 每只龙虾应该有自己的 autonomy_policy：
  - 触须虾读取公开数据 → L1
  - 吐墨虾生成文案 → L1
  - 画皮虾调用 ComfyUI → L2
  - 点兵虾部署到边缘节点 → L2
  - 金算虾发起支付 → L3
  - 跟进虾发送客户消息 → L3

**建议**：在 `role-card.json` 中添加 `autonomyPolicy` 字段，在 `LobsterRunner` 执行前检查。

**信息状态**：✅ 已确认事实

---

### 🟡 P1 — Soul/Memory 持久化身份（我们的龙虾没有长期记忆）

**Clawith 的做法**：
```
agent_template/
├── soul.md           # 人格定义（Identity/Personality/Boundaries）
├── memory/           # 长期记忆目录
├── HEARTBEAT.md      # 心跳/自省记录
├── state.json        # 当前状态快照
├── todo.json         # Focus Items（待办/进行中/完成）
├── skills/           # Agent 自己创建的技能
├── workspace/        # 私有文件系统
└── daily_reports/    # 日报目录
```

每个 Agent 有独立的文件系统，soul.md 跨对话持久化。Agent 可以自己修改 memory.md。

**映射到我们**：
- 我们的 `role-card.json` 是静态的，没有运行时状态积累
- 每只龙虾应该有：
  - `soul.md` → 我们已有 role-card.json + prompt-kit，可增强
  - `memory/` → 对应 memory_consolidator，但需要持久化到文件系统
  - `state.json` → 当前工作状态（正在处理哪个客户/任务）
  - `focus.json` → Focus Items（龙虾的待办/进行中/完成）

**建议**：在 `packages/lobsters/lobster-{role}/` 下添加 runtime state 目录。

**信息状态**：✅ 已确认事实

---

### 🟡 P1 — Token 配额与 LLM 调用限制

**Clawith 的做法**：
- `max_tokens_per_day` / `max_tokens_per_month` → 日/月限额
- `max_llm_calls_per_day` → 每日调用次数限制
- `quota_guard.py` → 配额检查服务
- `token_tracker.py` → Token 追踪服务
- 当 Provider 不返回 usage 时，通过字符估算补充

**映射到我们**：
- `lobster_pool_manager.py` 已有 token 追踪，但无限额控制
- `provider_registry.py` 可以集成配额检查

**建议**：在 `LobsterRunner` 执行前增加配额检查 hook。

**信息状态**：✅ 已确认事实

---

### 🟢 P2 — Plaza 市场（Agent 发现/雇佣机制）

**Clawith 的做法**：
- `Plaza` 模型 → Agent 发布到市场
- 用户可以"雇佣"公开 Agent
- 雇佣后自动建立 AgentRelationship

**映射到我们**：
- 如果我们做 SaaS，客户可以选择启用哪些龙虾
- Plaza 概念 → "龙虾池市场"，客户按需开通不同龙虾组合

**信息状态**：✅ 已确认事实

---

### 🟢 P2 — IM 全通道集成

**Clawith 的做法**：
- 飞书 (`feishu_service.py` + `feishu_ws.py`)
- 钉钉 (`dingtalk_service.py` + `dingtalk_stream.py`)
- 企微 (`wecom_service.py` + `wecom_stream.py`)
- Discord (`discord_gateway.py`)
- `ChannelConfig` 统一配置模型
- 后端逻辑零修改，通道只是入口

**映射到我们**：
- 我们已有 `docs/CHINA_CHANNEL_EXPANSION_PLAN.md` 规划
- Clawith 的通道抽象层设计可以直接借鉴
- 关键洞察：**通道是入口，不是逻辑** → 我们的龙虾执行层不需要改

**信息状态**：✅ 已确认事实

---

### 🟢 P2 — 工具运行时发现与安装

**Clawith 的做法**：
- MCP Client (`mcp_client.py`) 支持 Smithery + ModelScope
- Agent 可以运行时发现、安装新工具
- `resource_discovery.py` → 资源发现服务
- `skill_creator_content.py` → Agent 自己创建新技能

**映射到我们**：
- 我们的 `skill_bindings` 是硬编码的
- 如果龙虾能自己发现/安装工具，自适应能力更强

**信息状态**：✅ 已确认事实

---

### 🟢 P2 — 50 轮 Tool-Calling Loop + 自保护

**Clawith 的做法**：
- LLM 执行最多 50 轮工具调用循环
- 80% 阈值时注入警告 SystemMessage
- 空参数拦截 → 不执行，返回错误让 LLM 自修复
- 硬参数校验防止 `write_file` 等危险操作

**映射到我们**：
- `LobsterRunner` 有 `max_tool_rounds` 但无自保护警告
- 可以借鉴 80% 阈值警告和空参数拦截

**信息状态**：✅ 已确认事实

---

## 四、信息状态分类

| 类别 | 内容 |
|------|------|
| **已确认事实** | Clawith 源码已完整读取：Agent模型/Trigger模型/架构规范/服务列表/soul.md模板 |
| **合理推测** | Clawith 的 Aware 引擎已生产验证（Discord社区活跃、GitHub Stars 可观） |
| **待确认信息** | Clawith 的 `collaboration.py` 和 `supervision_reminder.py` 未深入读取，可能有额外的协作监督模式 |

---

## 五、建议的 Codex 任务拆解

| 任务ID | 标题 | 优先级 | 算力 | 依赖 | 说明 |
|--------|------|--------|------|------|------|
| CODEX-CW-01 | **Aware 触发引擎** — 为龙虾添加 Trigger 系统 | P0 | 高 | 无 | 新建 `trigger_daemon.py` + `AgentTrigger` 模型，支持 cron/poll/interval |
| CODEX-CW-02 | **Autonomy Policy L1/L2/L3** — 龙虾分级自主权 | P0 | 中 | 无 | 在 role-card.json 添加 autonomyPolicy，LobsterRunner 执行前检查 |
| CODEX-CW-03 | **A2A 龙虾间通信** — 龙虾直接对话能力 | P1 | 高 | CODEX-CW-01 | 新建 `lobster_messenger.py`，支持 send_message_to_lobster |
| CODEX-CW-04 | **Soul 持久化** — 龙虾运行时状态积累 | P1 | 中 | 无 | 为每只龙虾添加 state.json + focus.json + memory/ |
| CODEX-CW-05 | **Token 配额守卫** — 日/月配额限制 | P1 | 低 | 无 | 在 LobsterRunner 添加配额检查 Hook |
| CODEX-CW-06 | **Tool Loop 自保护** — 50轮+80%警告+空参拦截 | P2 | 低 | 无 | 修改 LobsterRunner 工具循环 |
| CODEX-CW-07 | **IM 通道抽象层** — 统一消息入口 | P2 | 中 | 无 | 借鉴 ChannelConfig 模式 |

---

## 六、核心结论

### 结论
> **Clawith 最大的创新是 Aware 自主意识引擎 — 让 Agent 从"被动工具"变为"主动员工"。这是我们龙虾系统的最大差距，也是最大的借鉴机会。**

### 依据
1. Clawith 的 6 种 Trigger 类型 + Focus-Trigger 绑定 + 自适应调度，让 Agent 真正像人一样"自己安排工作"
2. 我们的龙虾目前是纯被动调用（用户提交 → Commander 编排 → 龙虾执行 → 返回结果）
3. 如果龙虾能自主触发，场景从"用户发起的营销任务"扩展到"龙虾自主监控/自主跟进/自主优化"

### 建议动作
1. **第一步**（本周）：在 `role-card.json` 中添加 `autonomyPolicy` 和 `defaultTriggers` 字段
2. **第二步**（下周）：实现 `trigger_daemon.py` 最小版本，支持 cron + interval 两种触发
3. **第三步**（第三周）：实现 A2A 龙虾间通信，让触发事件可以跨龙虾传递

---

## 七、交接摘要

```
本次分析了 dataelement/Clawith 多Agent协作平台源码。
核心发现：Clawith 的 Aware 自主意识引擎（6种Trigger + Focus + 自适应）
是我们龙虾系统最大的差距。
其次是 A2A 通信协议、L1/L2/L3 自主权分级、Soul/Memory 持久化。

已生成7个 Codex 任务建议 (CODEX-CW-01~07)。
最高优先级：CODEX-CW-01 (Aware 触发引擎) 和 CODEX-CW-02 (Autonomy Policy)。

Clawith 源码位于 _ref_clawith/ 临时目录，分析完可删除。
技术栈与我们高度一致 (FastAPI + SQLAlchemy async)，移植成本低。

与之前分析的竞品对比：
- NanoBot → 借鉴了执行引擎/Hook/记忆 (已落地)
- Mission Control → 借鉴了生命周期/审批/协议 (Codex任务已生成)
- Clawith → 应借鉴自主触发/A2A通信/自主权分级 (最高创新度)
```
