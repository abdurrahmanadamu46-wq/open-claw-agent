# cccback-master 借鉴分析报告

> **分析时间**：2026-04-01  
> **项目来源**：`E:\alwyn\claude code\cccback-master`（Claude Code 核心源码，TypeScript）  
> **分析范围**：coordinator/ · tools/AgentTool/ · services/compact/ · remote/ · bridge/ · skills/ · services/mcp/ · services/SessionMemory/  
> **对照对象**：openclaw-agent 当前架构（commander + 10龙虾 + edge-runtime + dragon-senate-saas-v2）

---

## 一、项目定性：这是什么

cccback-master 是 **Anthropic Claude Code 的完整前端+编排核心**，是一个极度成熟的工业级 AI 编排系统，代码量在 100k+ 行 TS 以上。

| 层 | cccback-master 对应模块 | 我们对应模块 |
|----|------------------------|-------------|
| 编排大脑 | `coordinator/coordinatorMode.ts` | `commander_router.py` + `commander_graph_builder.py` |
| 子代理执行 | `tools/AgentTool/AgentTool.tsx` | 10只龙虾 + `lobster_runner.py` |
| 上下文压缩 | `services/compact/compact.ts` | ❌ 未实现 |
| 远程会话 | `remote/RemoteSessionManager.ts` | `edge-runtime/wss_receiver.py` |
| 桥接层 | `bridge/` | ❌ 未实现 |
| 技能系统 | `skills/` | ❌ 未实现 |
| MCP 集成 | `services/mcp/` | `provider_registry.py` 部分实现 |
| 记忆系统 | `services/SessionMemory/` | 部分实现 |

---

## 二、最值得借鉴的设计（按优先级排序）

---

### 🔴 B01【P0】Coordinator 模式 — commander 的完整编排协议

**来源**：`coordinator/coordinatorMode.ts`

**核心设计**：
```typescript
// Coordinator 模式下：
// 1. commander 只做任务分解和结果整合，不做执行
// 2. 所有子 Agent 通过 AgentTool 异步并行启动
// 3. 结果以 <task-notification> XML 格式回传
// 4. commander 通过 SendMessage 工具继续已完成的 Agent 的上下文

getCoordinatorSystemPrompt() → 完整的 System Prompt（100+ 行）
// 关键规则：
// - 并行优先：并行是你的超能力（Parallelism is your superpower）
// - 结果不要预测，等待真实回传
// - 验证是第二层 QA，实现是第一层
// - Research/Synthesis/Implementation/Verification 四阶段工作流
```

**我们目前的缺口**：
- `commander_router.py` 缺少完整的 System Prompt 协议
- 龙虾任务完成后没有结构化的 `<task-notification>` 回传格式
- 缺少 Research → Synthesis → Implementation → Verification 四阶段工作流定义

**借鉴建议**：
```python
# 在 commander 的 System Prompt 中加入四阶段工作流定义
COMMANDER_WORKFLOW_PROTOCOL = """
## 任务工作流（4阶段）

| 阶段 | 执行者 | 目的 |
|------|--------|------|
| Research（情报） | radar + strategist（并行） | 了解问题，搜集信号 |
| Synthesis（综合） | commander（你）| 读取发现，制定具体执行规格 |
| Implementation（执行） | dispatcher + inkwriter + visualizer | 按规格执行，不自由发挥 |
| Verification（验收） | followup + abacus | 证明结果有效，不只是存在 |

### 并行是你的超能力
独立任务必须并行启动，不要串行等待。
"""

# 龙虾完成后的结构化通知格式
TASK_NOTIFICATION_TEMPLATE = """
<task-notification>
<task-id>{lobster_run_id}</task-id>
<status>completed|failed|killed</status>
<summary>{human_readable_summary}</summary>
<result>{lobster_final_output}</result>
<usage>
  <total_tokens>{tokens}</total_tokens>
  <tool_uses>{tool_count}</tool_uses>
  <duration_ms>{duration}</duration_ms>
</usage>
</task-notification>
"""
```

---

### 🔴 B02【P0】后台 Agent + 可热升级为后台 — 异步龙虾执行模型

**来源**：`tools/AgentTool/AgentTool.tsx`

**核心设计**（极其精妙）：
```typescript
// 1. 每个 Agent 启动时，立即注册为前台任务（foreground task）
const registration = registerAgentForeground({...})

// 2. 主循环用 Promise.race 同时监听：
// - Agent 执行结果
// - "后台化"信号（用户按 ESC 或 2s 超时）
const raceResult = await Promise.race([
  nextMessagePromise,
  backgroundSignal  // ← 热迁移到后台的关键
])

// 3. 一旦收到后台信号：
// - 立即返回 async_launched 结果（不等待完成）
// - 启动一个后台 void 协程继续执行
// - 完成后通过 enqueueAgentNotification 发送通知

// 4. 关键洞察：同步/异步模式统一接口！
// 同步完成 → 直接返回结果
// 后台化 → 返回 async_launched，稍后通知
// 两种模式对调用方完全透明
```

**我们目前的缺口**：
- 龙虾执行是纯同步阻塞，无法热迁移到后台
- 没有前台任务注册机制
- 没有任务 vs 后台任务的统一状态机

**借鉴建议**：
```python
# lobster_runner.py 新增状态
class LobsterExecutionMode(Enum):
    FOREGROUND = "foreground"   # 同步等待，2s后提示可后台化
    BACKGROUND = "background"   # 后台运行，完成后推送通知
    AUTO = "auto"               # 自动：前台超时后热迁移

# lobster_pool_manager.py 新增
class LobsterForegroundRegistry:
    """前台任务注册表，支持热迁移到后台"""
    async def register_foreground(self, run_id, lobster_id, ...) -> BackgroundSignal
    async def background_all(self)  # 将所有前台任务推到后台
    def unregister(self, run_id)
```

---

### 🔴 B03【P0】Compact 上下文压缩 — 防止 Token 无限膨胀的工业解

**来源**：`services/compact/compact.ts`（1500行）

**核心设计**：
```typescript
// 1. 压缩触发条件
shouldAutoCompact(): bool  // 当 preCompactTokenCount 超过阈值

// 2. 压缩流程
stripImagesFromMessages()         // 先去除图片（节省大量 token）
stripReinjectedAttachments()      // 去除会在压缩后重注入的 attachment

// 3. PTL（Prompt Too Long）重试
truncateHeadForPTLRetry()  // 压缩请求本身也可能超长，最多3次重试
// 策略：删除最旧的 API round 组，直到覆盖 tokenGap

// 4. 压缩后恢复（5类 attachment 自动重注入）
createPostCompactFileAttachments()  // 最近读取的文件（5个）
createPlanAttachmentIfNeeded()       // 当前 Plan 文件
createSkillAttachmentIfNeeded()      // 已使用的技能
createAsyncAgentAttachmentsIfNeeded() // 后台任务状态
getDeferredToolsDeltaAttachment()     // 工具列表差量

// 5. 压缩后 Token 核算
truePostCompactTokenCount = roughTokenCountEstimationForMessages([
  boundaryMarker,
  ...summaryMessages,
  ...attachments,
  ...hookMessages,
])
// → 预判下次是否会立即再次触发压缩（willRetriggerNextTurn）
```

**我们目前的缺口**：
- 完全没有对话压缩机制（G10 CODEX_TASK_FRESH_CONTEXT 只做了历史截断，没有做摘要）
- 没有压缩后的 5类 attachment 重注入
- 没有 PTL 重试机制

**借鉴建议**（关键是压缩后恢复，不只是截断）：
```python
# dragon-senate-saas-v2/conversation_compactor.py（新建）
class ConversationCompactor:
    """
    对话压缩器（仿 cccback compact.ts）
    
    工作流：
    1. 检测压缩触发条件（token > 阈值）
    2. 调用 LLM 生成摘要（forked agent）
    3. 清空 session history
    4. 重注入关键 attachment（文件/计划/技能/状态）
    5. 记录压缩边界标记
    """
    
    POST_COMPACT_MAX_FILES = 5
    POST_COMPACT_TOKEN_BUDGET = 50_000
    
    async def compact(self, messages: list, context: dict) -> CompactionResult:
        # Strip images（节省 token）
        clean_messages = self._strip_images(messages)
        
        # Generate summary（forked LLM call）
        summary = await self._generate_summary(clean_messages)
        
        # Restore attachments
        attachments = await self._restore_post_compact_attachments(context)
        
        return CompactionResult(
            boundary_marker=self._create_boundary(),
            summary_messages=[summary],
            attachments=attachments,
        )
    
    async def _restore_post_compact_attachments(self, context) -> list:
        """5类 attachment 自动重注入"""
        attachments = []
        # 1. 最近读取的文件
        attachments += await self._restore_recent_files(context)
        # 2. 当前计划（YAML workflow）
        attachments += self._restore_workflow_plan(context)
        # 3. 龙虾历史技能调用
        attachments += self._restore_skill_history(context)
        # 4. 后台任务状态
        attachments += await self._restore_background_lobster_status(context)
        return attachments
```

---

### 🟠 B04【P1】Worktree 隔离 — 龙虾文件操作沙箱

**来源**：`tools/AgentTool/AgentTool.tsx`（`isolation: 'worktree'`）

**核心设计**：
```typescript
// Agent 启动时，可以指定 isolation: 'worktree'
// → 自动创建 git worktree 副本
// → Agent 在独立分支上操作文件，不影响主目录
// → 完成后检测是否有变更（hasWorktreeChanges）
// → 无变更 → 自动删除 worktree
// → 有变更 → 保留 worktree，返回 worktreePath + worktreeBranch

const worktreeInfo = await createAgentWorktree(slug)
// worktreeInfo.worktreePath → agent 的工作目录
// worktreeInfo.headCommit → 检测变更的基准点
```

**我们的应用场景**：
- dispatcher 龙虾执行发布操作时，在隔离的"草稿"环境中构建
- inkwriter 生成文案时，不污染主目录的文案库
- edge 节点的账号操作沙箱

**借鉴建议**：
```python
# edge-runtime 的操作隔离
class AccountOperationSandbox:
    """
    为每次边缘执行创建操作隔离环境
    - 避免并行账号操作相互干扰
    - 失败时自动回滚
    """
    async def __aenter__(self) -> 'SandboxContext':
        self.sandbox_id = uuid4().hex[:8]
        return SandboxContext(self.sandbox_id)
    
    async def __aexit__(self, exc_type, exc, tb):
        if exc_type:
            await self.rollback()
        else:
            await self.commit()
```

---

### 🟠 B05【P1】Skill 系统 — 龙虾技能动态加载

**来源**：`skills/` + `tools/SkillTool/`

**核心设计**：
```typescript
// bundledSkills.ts 内置技能
// loadSkillsDir.ts  从磁盘加载自定义技能（Markdown 文件）
// SkillTool → 龙虾可以 /commit /verify /batch 调用技能

// 技能格式（Markdown 文件 + YAML frontmatter）：
// ---
// description: "运行测试并验证"
// ---
// 步骤1：...
// 步骤2：...

// 压缩后自动恢复：createSkillAttachmentIfNeeded()
// 防止技能过大：POST_COMPACT_MAX_TOKENS_PER_SKILL = 5000
```

**我们的应用场景**：
- 小红书/抖音/快手 SOP（标准操作程序）作为技能文件存储
- 龙虾可以动态调用 `/sop_xhs_launch` `/sop_douyin_comment` 等
- 技能文件可以被运营人员修改，无需改代码

**借鉴建议**：
```python
# dragon-senate-saas-v2/sop_loader.py（新建）
class SOPLoader:
    """
    SOP 技能加载器（仿 cccback skills/loadSkillsDir.ts）
    
    目录结构：
    sops/
      xhs_post_launch.md   # 小红书发帖 SOP
      douyin_comment.md    # 抖音互动 SOP
      batch_publish.md     # 批量发布 SOP
    
    龙虾调用方式：
    dispatcher.invoke_sop("xhs_post_launch", context={"account": "..."})
    """
    
    SOP_DIR = "./sops"
    
    def load_all_sops(self) -> dict[str, SOP]:
        sops = {}
        for path in Path(self.SOP_DIR).glob("*.md"):
            sop = self._parse_sop(path)
            sops[sop.name] = sop
        return sops
    
    def _parse_sop(self, path: Path) -> SOP:
        content = path.read_text()
        # 解析 YAML frontmatter
        frontmatter, body = self._split_frontmatter(content)
        return SOP(
            name=path.stem,
            description=frontmatter.get("description", ""),
            steps=body,
            platforms=frontmatter.get("platforms", []),
        )
```

---

### 🟠 B06【P1】Session Memory 自动提炼 — 龙虾的"隐性学习"

**来源**：`services/SessionMemory/sessionMemory.ts`

**核心设计**：
```typescript
// 在每次会话结束后，自动提炼关键记忆
// 写入 .claude/memory/ 目录

// 提炼内容：
// - 用户的偏好和习惯
// - 已解决的技术问题和解法
// - 账号特征（哪些内容表现好）
// - 失败模式（哪些操作曾经出错）
```

**我们的应用场景**：
- 龙虾自动记住"账号A 发美妆内容表现更好"
- 自动记住"周二下午3点发布效果最好"
- 自动记住"这个客户不喜欢用emoji"
- 这些记忆跨会话持久化，不需要用户重复说明

**借鉴建议**：
```python
# dragon-senate-saas-v2/session_memory_extractor.py（新建）
class SessionMemoryExtractor:
    """
    会话记忆提炼器（仿 cccback SessionMemory）
    
    在任务完成后，LLM 分析本次会话，提炼关键"记忆片段"：
    - 账号特征
    - 用户偏好
    - 成功模式
    - 失败教训
    """
    
    EXTRACT_SYSTEM_PROMPT = """
    你是 ClawCommerce 的记忆提炼专家。
    分析本次会话，提炼以下类型的关键记忆：
    1. 账号特征（哪些内容/时间/风格表现更好）
    2. 用户偏好（喜欢的表达方式，不喜欢的风格）
    3. 成功模式（什么操作带来了好结果）
    4. 失败教训（什么操作要避免）
    
    输出 JSON：{"memories": [{"type": "...", "content": "...", "confidence": 0.8}]}
    """
    
    async def extract(self, session_messages: list, tenant_id: str) -> list[Memory]:
        raw = await self.llm.ainvoke(
            system=self.EXTRACT_SYSTEM_PROMPT,
            user=f"会话内容：{session_messages[-10:]}"  # 最后10条
        )
        return self._parse_memories(raw)
    
    async def persist(self, memories: list[Memory], tenant_id: str):
        """持久化到 SQLite 记忆库"""
        for m in memories:
            await self.memory_db.upsert(m, tenant_id=tenant_id)
```

---

### 🟠 B07【P1】RemoteSessionManager — 云边通信的工业标准

**来源**：`remote/RemoteSessionManager.ts`

**核心设计**：
```typescript
class RemoteSessionManager {
  // WebSocket 接收消息（持续连接）
  // HTTP POST 发送消息（无状态）
  
  // 关键：Permission 请求/响应流程
  // CCR(边缘) → control_request(can_use_tool) → 前端确认 → control_response
  
  // 重连机制
  reconnect()  // 容器重启后强制重连
  
  // 中断机制
  cancelSession()  // 发送 interrupt 信号，不关闭连接
  
  // 查看者模式（只读）
  viewerOnly: boolean  // 不发送 ESC，不更新标题
}
```

**我们的缺口**：
- `wss_receiver.py` 没有结构化的 permission 请求/响应协议
- 没有"查看者模式"（运营人员实时观察龙虾操作）
- 没有容器重启后的强制重连逻辑

**借鉴建议**：
```python
# edge-runtime/remote_session_manager.py（重构）
class RemoteSessionManager:
    """
    仿 cccback RemoteSessionManager
    """
    
    async def handle_control_request(self, request: dict):
        """处理中控下发的权限请求"""
        subtype = request["request"]["subtype"]
        
        if subtype == "can_use_tool":
            # 向前端推送权限确认请求（黄线确认）
            await self.push_permission_ui(request)
        elif subtype == "interrupt":
            # 中断当前执行（不断开连接）
            await self.interrupt_current_execution()
    
    async def send_control_response(self, request_id: str, behavior: str):
        """响应权限请求"""
        response = {
            "type": "control_response",
            "response": {
                "subtype": "success",
                "request_id": request_id,
                "response": {"behavior": behavior}
            }
        }
        await self.ws.send(json.dumps(response))
```

---

### 🟠 B08【P1】Bridge 层 — 本地进程与远程会话的通信总线

**来源**：`bridge/bridgeMain.ts` + `bridge/sessionRunner.ts`

**核心设计**：
```
Bridge 层的职责：
- 本地 CLI 进程 ↔ 远程 WebSocket 会话 的双向消息翻译
- poll config（定期从服务端拉取配置变更）
- JWT 鉴权（trustedDevice.ts）
- 流量门控（flushGate.ts：批量消息后再 flush）
- 容量唤醒（capacityWake.ts：资源空闲时唤醒）
```

**我们的应用场景**：
- openclaw 中控 ↔ edge 节点之间的通信中间件
- 统一处理鉴权、重试、消息格式转换

**借鉴建议**：
```python
# 中间层（dragon-senate-saas-v2/bridge/）
# bridge_config.py    配置定期拉取
# bridge_auth.py      JWT 鉴权
# flush_gate.py       消息批量 flush（防止频繁小包）
# capacity_wake.py    空闲唤醒机制
```

---

### 🟡 B09【P2】Auto-compact 触发策略 — 精细的 Token 预算管理

**来源**：`services/compact/autoCompact.ts`

**关键指标**：
```typescript
// 触发阈值计算
autoCompactThreshold = maxContextTokens - safetyBuffer
// 不只看消息 token，还要加 system prompt + tools schema

// 压缩后预判
willRetriggerNextTurn = truePostCompactTokenCount >= autoCompactThreshold
// 如果压缩后立即超过阈值 → 报警（避免无限压缩循环）

// Token 细粒度分析
analyzeContext(messages) → {
  userMessageTokens,
  assistantMessageTokens,
  toolUseTokens,
  imageTokens,
  ...
}
```

---

### 🟡 B10【P2】MCP 多服务器管理 — 工具动态注册/注销

**来源**：`services/mcp/MCPConnectionManager.tsx`

**核心设计**：
```typescript
// MCP 服务器状态
type MCPClientState = 'pending' | 'connected' | 'failed' | 'authenticated'

// 工具等待机制：Agent 等待 MCP 服务器连接完成（最多30秒）
if (hasPendingRequiredServers) {
  await waitForMCPConnection(requiredServers, 30_000)
}

// 工具权限过滤
filterAgentsByMcpRequirements()  // 确保 Agent 需要的 MCP 都已连接
```

**我们的应用场景**：
- dispatcher 龙虾依赖特定平台的 MCP 工具（小红书 API / 抖音 API）
- 如果 MCP 未连接，等待或报错，不默默失败

---

## 三、关键 Pattern 总结表

| Pattern | cccback 实现 | 我们目前 | 借鉴建议 |
|---------|------------|---------|---------|
| 并行 Agent 启动 | AgentTool 多实例并发 | 龙虾串行 | `asyncio.gather` 并行龙虾 |
| 结构化任务通知 | `<task-notification>` XML | 无结构化格式 | 定义龙虾完成通知格式 |
| 热升级到后台 | `Promise.race` + background signal | 无 | `asyncio.create_task` 后台化 |
| 对话压缩 | 完整 compaction pipeline | 无 | 实现 `ConversationCompactor` |
| 压缩后恢复 | 5类 attachment 自动重注入 | 无 | 随压缩一起实现 |
| PTL 重试 | `truncateHeadForPTLRetry` | 无 | 压缩失败时截断重试 |
| Worktree 隔离 | Git worktree per Agent | 无 | 账号操作沙箱 |
| Skill 动态加载 | Markdown 技能文件 | 无 | SOP 技能系统 |
| 会话记忆提炼 | SessionMemory 自动提炼 | 部分实现 | 会话结束后自动提炼 |
| 权限请求/响应 | control_request/control_response | 无协议 | 云边权限协议 |
| MCP 等待机制 | 30s 等待 MCP 连接 | 无 | Provider 就绪等待 |
| Token 分析 | `analyzeContext` 细粒度 | 无 | Token 细分监控 |

---

## 四、针对我们各层的具体借鉴建议

### 4.1 大脑层（commander + 10龙虾）

**最重要的借鉴**：

1. **给 commander 完整的 Coordinator System Prompt**（B01）
   - 明确 Research/Synthesis/Implementation/Verification 四阶段
   - 强调并行优先原则
   - 定义龙虾任务完成的 `<task-notification>` XML 格式

2. **实现龙虾异步后台化**（B02）
   - 龙虾执行超过2秒 → 自动提示可后台化
   - 不阻塞主 commander 循环
   - 完成后通过通知渠道回传

3. **对话压缩系统**（B03）
   - 这是最大的技术缺口，直接影响长任务执行能力
   - Token 超过 80k 时自动压缩
   - 压缩后自动恢复5类关键 attachment

### 4.2 SaaS 系统（dragon-senate-saas-v2）

**新增模块**：
- `conversation_compactor.py`（B03）
- `sop_loader.py`（B05，SOP 技能系统）
- `session_memory_extractor.py`（B06，会话记忆提炼）

### 4.3 云边调度层（中间层）

**重构目标**：
- 引入 Bridge 层概念（B08）
- 实现结构化的 control_request/control_response 协议（B07）
- 添加 JWT 鉴权和消息批量 flush

### 4.4 边缘执行端（edge-runtime）

**改进目标**：
- `wss_receiver.py` → 实现 `RemoteSessionManager` 模式（B07）
- 添加账号操作沙箱（B04 worktree 思路）
- 支持"查看者模式"（运营实时监控）

### 4.5 前端

**新增 UI 组件**：
- 龙虾任务后台化提示（2s后显示）
- 任务通知面板（接收 `<task-notification>`）
- 会话压缩进度指示器
- 记忆提炼展示（"本次会话学到了什么"）
- SOP 技能列表展示

---

## 五、优先落地清单（新增 CODEX_TASK）

| 优先级 | CODEX_TASK 文件名 | 核心内容 | 预估工作量 |
|--------|-----------------|---------|-----------|
| 🔴 P0 | `CODEX_TASK_COORDINATOR_PROTOCOL.md` | commander 完整编排协议 + task-notification 格式 | 2天 |
| 🔴 P0 | `CODEX_TASK_LOBSTER_BACKGROUND.md` | 龙虾异步后台化 + 热迁移 | 2天 |
| 🔴 P0 | `CODEX_TASK_CONVERSATION_COMPACT.md` | 对话压缩 + 5类 attachment 恢复 | 3天 |
| 🟠 P1 | `CODEX_TASK_SOP_SKILL_LOADER.md` | SOP 技能动态加载系统 | 1天 |
| 🟠 P1 | `CODEX_TASK_SESSION_MEMORY.md` | 会话记忆自动提炼 + 持久化 | 2天 |
| 🟠 P1 | `CODEX_TASK_CLOUD_EDGE_BRIDGE.md` | 云边通信 Bridge 层重构 | 2天 |
| 🟡 P2 | `CODEX_TASK_ACCOUNT_SANDBOX.md` | 账号操作沙箱（Worktree 思路） | 2天 |

---

## 六、与现有 CODEX_TASK 的关系

| cccback 借鉴点 | 与现有 CODEX_TASK 关系 |
|--------------|----------------------|
| B01 Coordinator Protocol | 扩展现有 commander_graph_builder.py |
| B02 Background Lobster | 与 G04 Retry+Escalate 协同（后台化也需要 escalation） |
| B03 Conversation Compact | 与 G10 Fresh Context 协同（Fresh Context 是简化版） |
| B05 SOP Skill | 与 G11 YAML Workflow 协同（技能 = 步骤级 workflow） |
| B06 Session Memory | 与 G12 Proactive Intent 协同（记忆 → 意图预测） |
| B07 Remote Session | 与 G06 DLP Scan 协同（云边通信需要 DLP） |

---

## 七、差距总结

cccback-master 代表了工业级 AI 编排的最高水平。我们目前的最大差距是：

1. **编排协议**：我们有龙虾角色定义，但没有完整的 Coordinator 编排协议（commander 怎么下令、龙虾怎么汇报、四阶段工作流）
2. **对话压缩**：这是长任务的核心能力，cccback 有完整的 1500 行实现，我们完全空白
3. **异步执行**：所有龙虾目前都是同步阻塞的，无法后台化
4. **技能系统**：没有 SOP 动态加载，运营无法自助修改操作步骤
5. **会话记忆**：没有自动提炼和持久化，每次任务从零开始

---

*分析时间：2026-04-01 | 基于 cccback-master 源码深度分析*  
*涉及文件：coordinator/coordinatorMode.ts / tools/AgentTool/AgentTool.tsx / services/compact/compact.ts / remote/RemoteSessionManager.ts / bridge/ / skills/*
