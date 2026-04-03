# NanoBot 架构分析 & 对 OpenClaw-Agent 的启示

> 分析时间：2026-03-31 03:20 UTC+8
> 分析范围：github.com/HKUDS/nanobot v0.1.4.post6
> 本文定位：给我们的 Dragon Senate / Edge-Runtime / SaaS 系统提供可借鉴方案

---

## 一、NanoBot 是什么？

### 已确认事实
- **定位**：OpenClaw 的超轻量重新实现，号称"99% fewer lines of code"
- **语言**：纯 Python（agent/providers/channels/tools），仅 WhatsApp bridge 用 TypeScript
- **架构核心**：`AgentLoop → AgentRunner → LLMProvider` 三层，通过 `MessageBus` 路由消息
- **渠道支持**：Telegram / Discord / WeChat / Feishu / DingTalk / Slack / Matrix / Email / QQ / WhatsApp / Wecom / Mochat（共 13 个）
- **LLM 提供商**：OpenRouter / OpenAI / Anthropic / DeepSeek / Gemini / Groq / MiniMax / VolcEngine / Ollama / vLLM / OVMS 等 17+
- **工具系统**：内建 read_file / write_file / edit_file / list_dir / exec / web_search / web_fetch / message / spawn / cron，外接 MCP
- **记忆系统**：MEMORY.md（长期事实）+ HISTORY.md（可搜索日志），基于 token 预算自动归纳
- **技能系统**：`skills/` 目录放 SKILL.md，支持 workspace 覆盖，渐进加载
- **部署**：pip install / Docker / systemd，支持多实例并行

### 合理推测
- 核心代码约 3000-5000 行（不含渠道适配器）
- 单进程 async 架构，适合个人助手场景，不适合高并发 SaaS
- 无边缘运行时（edge-runtime）概念，所有执行在服务端

---

## 二、核心架构详解

### 2.1 Agent Loop（核心引擎）

```
InboundMessage → MessageBus → AgentLoop._dispatch()
  → SessionManager.get_or_create()
  → ContextBuilder.build_messages() (history + memory + skills + runtime)
  → AgentRunner.run()
    → LLMProvider.chat_stream_with_retry()
    → ToolRegistry.execute() (可并发)
    → 循环直到无 tool_calls 或达到 max_iterations
  → MemoryConsolidator.maybe_consolidate_by_tokens()
  → OutboundMessage → MessageBus → Channel.send()
```

**关键设计**:
| 特性 | 实现 | 评价 |
|------|------|------|
| 并发控制 | `asyncio.Semaphore(3)` + per-session Lock | ✅ 简洁有效 |
| 流式输出 | Hook 模式，`on_stream` / `on_stream_end` | ✅ 解耦良好 |
| 工具执行 | 支持并发 `asyncio.gather` | ✅ 性能优化 |
| 错误恢复 | 3 次失败后 raw archive | ✅ 降级策略 |
| MCP 集成 | 懒连接，自动注册为 native tools | ✅ 透明 |

### 2.2 Hook 系统（生命周期扩展点）

```python
AgentHook:
  before_iteration(context)     # 每轮 LLM 调用前
  on_stream(context, delta)     # 流式内容 delta
  on_stream_end(context)        # 流结束
  before_execute_tools(context) # 工具执行前
  after_iteration(context)      # 每轮结束
  finalize_content(context)     # 最终内容处理
```

**启示**：这个 Hook 设计非常优雅，值得我们在 Dragon Senate 的 Lobster 执行流中借鉴。

### 2.3 记忆系统

```
Token 预算控制:
  budget = context_window - max_completion - safety_buffer
  target = budget / 2
  
如果 estimated_tokens > budget:
  1. 找到 user-turn 边界
  2. 提取 chunk → LLM summarize → save_memory tool
  3. 写入 MEMORY.md + HISTORY.md
  4. 更新 session.last_consolidated
  5. 最多 5 轮归纳
  
失败降级:
  连续 3 次 LLM 归纳失败 → raw dump 到 HISTORY.md
```

### 2.4 渠道抽象

```python
BaseChannel(ABC):
  start()           # 启动监听
  stop()            # 停止
  send(msg)         # 发送消息
  send_delta()      # 流式分块
  is_allowed()      # 权限检查
  _handle_message() # 接收→Bus
  login()           # 交互式登录
```

### 2.5 Provider 注册表

```python
ProviderSpec:
  name, keywords, env_key, display_name, default_api_base
  is_gateway, detect_by_key_prefix, detect_by_base_keyword
  model_overrides, supports_max_completion_tokens
```

添加新 provider 只需 2 步：加 ProviderSpec + 加 config field。

---

## 三、与 OpenClaw-Agent 对比分析

### 3.1 架构对比

| 维度 | NanoBot | OpenClaw-Agent (我们) |
|------|---------|---------------------|
| **语言** | 纯 Python | TypeScript + Python 混合 |
| **代码量** | ~5K 行 | ~50K+ 行 |
| **架构模式** | 单体 async | 微服务 + 边缘分离 |
| **Agent 循环** | `AgentRunner.run()` 统一 | 分散在多处 |
| **渠道** | 13 个内建 | 待开发 |
| **边缘运行时** | ❌ 无 | ✅ WSS + Context Navigator + Marionette |
| **多 Agent** | SubagentManager (后台任务) | Dragon Senate (角色化龙虾) |
| **记忆** | 基于 token 的 MEMORY.md | 待完善 |
| **工具扩展** | MCP + Skills | MCP (规划中) |
| **部署** | pip/docker 单实例 | Docker Compose 多服务 |
| **SaaS 能力** | ❌ 个人工具 | ✅ 多租户目标 |

### 3.2 NanoBot 做得好的（我们应借鉴的）

#### ⭐ P0 - 立即可借鉴

1. **AgentRunner 的统一循环模式**
   - 将 LLM 调用 → 工具执行 → 结果合并 抽象为一个通用 `run(spec)` 方法
   - 我们的 Lobster 也应该有一个统一的 `LobsterRunner`

2. **Hook 生命周期系统**
   - `before_iteration / on_stream / before_execute_tools / after_iteration / finalize_content`
   - 可以直接移植到 Dragon Senate 的 Lobster 执行引擎

3. **Token 预算记忆归纳**
   - `MemoryConsolidator.maybe_consolidate_by_tokens()` 的设计
   - 自动在 token 超限时归纳历史，保留 user-turn 边界
   - 我们的会话管理急需这个

4. **Provider 注册表模式**
   - `ProviderSpec` + 自动路由，2 步添加新 provider
   - 比我们的硬编码方式好得多

#### ⭐ P1 - 下个迭代可借鉴

5. **Skills 渐进加载**
   - 不是把所有技能塞进 context，而是先给摘要，需要时 `read_file` 加载
   - 节省 token

6. **BaseChannel 抽象 + 流式支持**
   - `supports_streaming` 属性 + `send_delta` 方法
   - 未来我们加渠道时直接用

7. **Slash 命令路由器**
   - `CommandRouter` 独立于 Agent 逻辑，支持优先级命令（如 /stop）
   - 对 SaaS 管理命令有用

### 3.3 NanoBot 不能做的（我们的差异化优势）

| 能力 | 说明 |
|------|------|
| **边缘运行时** | NanoBot 没有 edge-runtime 概念，不能在客户机器上执行 |
| **多 Agent 角色化协作** | NanoBot 的 SubagentManager 只是后台任务，不是角色化龙虾 |
| **SaaS 多租户** | NanoBot 是个人工具，无租户隔离/计费/配额 |
| **可视化操作** | NanoBot 无 Marionette/屏幕操控 |
| **审计日志** | NanoBot 无 audit_logger，我们有 |
| **前端控制台** | NanoBot 纯 CLI/Bot，我们有 Web Dashboard |

---

## 四、具体可采纳的行动建议

### 行动 1：为 Dragon Senate 添加统一 LobsterRunner

**来源**：NanoBot 的 `AgentRunner`
**工作量**：中（约 2 天）

```python
# 在 dragon-senate-saas-v2/ 下新增
class LobsterRunner:
    """统一的 Lobster 执行引擎"""
    async def run(self, spec: LobsterRunSpec) -> LobsterRunResult:
        # LLM 调用 → 工具执行 → 结果合并的统一循环
        # 每个 Lobster 只需提供 spec (prompt, tools, model)
```

### 行动 2：在 Edge-Runtime 加入 Token 预算记忆

**来源**：NanoBot 的 `MemoryConsolidator`
**工作量**：低（约 1 天）

```python
# 在 edge-runtime/ 下新增 memory_consolidator.py
# 当 WSS 会话 token 接近上限时自动归纳历史
```

### 行动 3：Provider 注册表模式

**来源**：NanoBot 的 `ProviderSpec` + `registry.py`
**工作量**：中（约 1.5 天）

```python
# 统一管理所有 LLM provider 的配置、路由、降级
# 替代当前的硬编码方式
```

### 行动 4：Hook 生命周期接口

**来源**：NanoBot 的 `AgentHook`
**工作量**：低（约 0.5 天）

```python
# 为 Lobster 执行流添加生命周期钩子
# 方便审计日志、流式输出、性能监控
```

---

## 五、不建议采纳的设计

| 设计 | 原因 |
|------|------|
| 单体 async 架构 | 我们需要微服务+边缘分离 |
| JSON 文件作为配置 | 我们需要数据库管理的多租户配置 |
| 文件系统 session 存储 | 不适合 SaaS 扩展 |
| WhatsApp bridge (Node.js) | 额外的语言依赖 |

---

## 六、代码行数参考

```
nanobot/agent/loop.py      ~380 行  核心循环
nanobot/agent/runner.py     ~180 行  执行引擎
nanobot/agent/memory.py     ~280 行  记忆系统
nanobot/agent/skills.py     ~200 行  技能加载
nanobot/agent/context.py    ~?   行  上下文构建
nanobot/channels/base.py    ~160 行  渠道抽象
nanobot/providers/registry.py ~?  行  Provider 注册
nanobot/agent/tools/        ~10 文件  工具实现
```

核心引擎约 1200 行，非常精简。

---

## 七、交接摘要

### 本次完成
- ✅ 克隆并分析了 NanoBot v0.1.4.post6 完整源码
- ✅ 提炼出 7 个核心架构组件的设计模式
- ✅ 与 OpenClaw-Agent 做了详细对比
- ✅ 给出 4 个具体可执行的借鉴建议

### 关键结论
> **NanoBot 是一个精心设计的个人 AI 助手框架，其 AgentRunner、Hook 系统和 Memory Consolidator 的设计模式可以直接移植到我们的项目中。但它缺乏边缘运行时、多 Agent 协作、SaaS 多租户等能力——这些正是我们的差异化价值。**

### 下一步建议
1. **立即**：将 LobsterRunner (借鉴 AgentRunner) 加入 Dragon Senate
2. **本周**：将 MemoryConsolidator 加入 Edge-Runtime 会话管理
3. **下周**：引入 ProviderSpec 注册表模式统一 LLM 管理
4. **持续**：保持对 NanoBot 社区的跟踪，特别是 MCP 和 Skills 的演进

### 参考文件位置
- NanoBot 源码：`f:\openclaw-agent\openclaw_ref_nanobot\`
- 本分析文档：`f:\openclaw-agent\docs\NANOBOT_ANALYSIS.md`
