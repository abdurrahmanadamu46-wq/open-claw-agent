# CODEX TASK: SysPrompts P1 — Agent Loop + 执行摘要 + 能力模块注册

**来源**：SYSPROMPTS_BORROWING_ANALYSIS.md  
**优先级**：P1（高价值，立即落地）  
**借鉴自**：Manus Agent Loop / Windsurf toolSummary / Claude Code 最小执行原则  
**日期**：2026-04-02

---

## Task 1: 标准化 Agent Loop（升级 lobster_runner.py）

**借鉴**：Manus Agent loop.txt（2KB 精华，感知→选择→执行→观察→完成判断）

**当前问题**：`lobster_runner.py` 的执行流程不够标准化，缺少明确的循环边界和完成判断

**实现目标**：

```python
# dragon-senate-saas-v2/lobster_runner.py 升级点

class AgentLoop:
    """
    标准化 Agent 执行循环（参考 Manus Agent Loop 设计）
    LOOP {
      1. perceive(state)       - 感知线索/任务当前状态
      2. select_action(state)  - 选择下一步动作
      3. execute_tool(action)  - 调用工具执行
      4. observe(result)       - 观察执行结果
      5. check_done(result)    - 判断是否完成任务
      → 未完成则进入下一轮循环
    }
    """
    
    def __init__(self, lobster, task, max_rounds=10):
        self.lobster = lobster
        self.task = task
        self.max_rounds = max_rounds
        self.round = 0
        self.loop_log = []
    
    async def run(self):
        state = await self.perceive()
        while self.round < self.max_rounds:
            self.round += 1
            action = await self.select_action(state)
            result = await self.execute_tool(action)
            state = await self.observe(result, state)
            if await self.check_done(state, result):
                break
            await self.emit_loop_event(state, result)
        return self.loop_log
    
    async def perceive(self):
        """感知当前任务状态（线索信息/历史上下文/工具可用性）"""
        ...
    
    async def select_action(self, state):
        """LLM 选择下一步动作（返回 action_type + action_summary）"""
        ...
    
    async def execute_tool(self, action):
        """执行选定工具，记录 why 字段"""
        ...
    
    async def observe(self, result, prev_state):
        """观察工具执行结果，更新状态"""
        ...
    
    async def check_done(self, state, result):
        """判断任务是否完成（success/fail/continue）"""
        ...
```

**验收标准**：
- [ ] `lobster_runner.py` 引入 `AgentLoop` 类
- [ ] 每轮循环有完整的 perceive/select/execute/observe/check 五步
- [ ] 循环有 max_rounds 上限（防止无限循环）
- [ ] 每轮循环记录到 `loop_log`（含 round_id, action, result, done）
- [ ] 异常情况下循环优雅退出，不崩溃

---

## Task 2: 执行步骤摘要（action_summary 字段）

**借鉴**：Windsurf 的 `toolSummary` 设计（每个工具调用都有 2-5 字的摘要）

**当前问题**：`api_lobster_realtime.py` 的执行事件没有简短摘要，前端无法展示"正在做什么"

**实现目标**：

```python
# dragon-senate-saas-v2/api_lobster_realtime.py 升级

# 每个龙虾执行步骤必须包含 action_summary
STEP_EVENT_SCHEMA = {
    "step_id": str,           # 步骤 ID
    "round": int,             # 第几轮循环
    "action_type": str,       # 工具类型（read_lead / send_msg / generate_content）
    "action_summary": str,    # 2-5 字摘要（"分析线索" / "撰写消息" / "发送中"）
    "why": str,               # 执行原因（参考 Windsurf "explain why before calling tool"）
    "status": str,            # pending / running / done / failed
    "started_at": str,
    "finished_at": str,
    "result_preview": str,    # 执行结果预览（前50字）
}

# 标准 action_summary 枚举（龙虾专用，中文 2-5 字）
ACTION_SUMMARY_MAP = {
    "read_lead_profile":     "分析线索",
    "search_memory":         "查询记忆",
    "generate_message":      "撰写消息",
    "send_message":          "发送消息",
    "update_lead_status":    "更新状态",
    "create_content":        "生成内容",
    "schedule_followup":     "安排跟进",
    "query_knowledge_base":  "查询知识库",
    "call_lobster":          "协作龙虾",
    "wait_reply":            "等待回复",
}
```

**前端对接**：
```
WebSocket 实时推送格式：
{
  "type": "lobster_step",
  "lobster_id": "dispatcher-laojian",
  "action_summary": "撰写消息",
  "status": "running",
  "round": 2
}

→ 前端在龙虾执行卡片上实时显示：
  [老健] 📝 撰写消息... (第2步/共5步)
```

**验收标准**：
- [ ] 所有龙虾执行步骤事件包含 `action_summary` 字段
- [ ] `ACTION_SUMMARY_MAP` 覆盖所有常见动作类型
- [ ] 前端 WebSocket 订阅能接收并渲染 `action_summary`
- [ ] `why` 字段在执行日志中可查（便于调试）

---

## Task 3: 龙虾最小执行原则（职责红线机制）

**借鉴**：Claude Code 2.0 的核心原则：
- "Do what has been asked; nothing more, nothing less."
- "NEVER create files unless absolutely necessary."
- "Minimize output tokens as much as possible."

**当前问题**：龙虾有时会超出职责范围执行额外操作，导致任务扩散

**实现目标**：

```python
# dragon-senate-saas-v2/lobster_boundary_guard.py（新建）

class LobsterBoundaryGuard:
    """
    龙虾职责边界守卫
    确保龙虾只做分配到的任务，不主动扩展范围
    """
    
    # 每只龙虾的"不做什么"清单
    FORBIDDEN_ACTIONS = {
        "dispatcher-laojian": [
            "generate_content",    # 老健不写内容，只分配任务
            "send_message",        # 老健不发消息，只调度
            "update_lead_status",  # 老健不改线索状态
        ],
        "inkwriter-moxiaoya": [
            "send_message",        # 墨小雅只写内容，不发送
            "update_lead_status",  # 墨小雅不改状态
            "schedule_followup",   # 墨小雅不安排跟进
        ],
        "followup-xiaochui": [
            "generate_content",    # 小锤只跟进，不生产内容
            "create_campaign",     # 小锤不创建活动
        ],
        # ... 其他龙虾
    }
    
    def check_action(self, lobster_id: str, action_type: str) -> bool:
        """检查动作是否在该龙虾的职责范围内"""
        forbidden = self.FORBIDDEN_ACTIONS.get(lobster_id, [])
        if action_type in forbidden:
            raise BoundaryViolationError(
                f"龙虾 {lobster_id} 尝试执行禁止动作 {action_type}，已拒绝"
            )
        return True
    
    def check_output_size(self, lobster_id: str, output: str, max_tokens: int = 2000):
        """检查输出是否过长（参考 Claude Code 的 minimize output tokens）"""
        token_count = len(output) // 4  # 估算
        if token_count > max_tokens:
            raise OutputTooLargeError(
                f"龙虾 {lobster_id} 输出 {token_count} tokens，超出限制 {max_tokens}"
            )
```

**验收标准**：
- [ ] 新建 `lobster_boundary_guard.py`
- [ ] 所有 9 只龙虾的 FORBIDDEN_ACTIONS 完整定义
- [ ] `lobster_runner.py` 在每次执行前调用 `boundary_guard.check_action()`
- [ ] 违反边界时记录审计日志 + 通知 Commander
- [ ] 输出 token 超限时截断并警告

---

## Task 4: 能力 Module 注册表（参考 Manus Modules.txt）

**借鉴**：Manus 的 Modules.txt（12KB，每个能力是独立 Module，可组合调用）

**当前问题**：龙虾的能力分散在各个文件，没有统一的模块注册中心

**实现目标**：

```python
# dragon-senate-saas-v2/module_registry.py（新建）

MODULE_REGISTRY = {
    "lead_reader": {
        "module_id": "lead_reader",
        "name": "线索读取器",
        "description": "读取和分析线索的基本信息、历史记录、标签",
        "inputs": ["lead_id"],
        "outputs": ["lead_profile", "contact_history", "tags"],
        "available_to": ["dispatcher", "radar", "catcher", "followup"],
        "avg_tokens": 800,
        "avg_latency_ms": 500,
    },
    "message_generator": {
        "module_id": "message_generator",
        "name": "消息生成器",
        "description": "根据线索画像和策略生成个性化消息",
        "inputs": ["lead_profile", "strategy", "voice_style"],
        "outputs": ["message_text", "message_type"],
        "available_to": ["inkwriter", "echoer"],
        "avg_tokens": 1500,
        "avg_latency_ms": 2000,
    },
    "memory_searcher": {
        "module_id": "memory_searcher",
        "name": "记忆搜索器",
        "description": "在 mem0 中搜索历史记忆和偏好",
        "inputs": ["query", "tenant_id", "lead_id"],
        "outputs": ["memories", "relevance_scores"],
        "available_to": ["all"],
        "avg_tokens": 600,
        "avg_latency_ms": 300,
    },
    # ... 其他模块
}

class ModuleRegistry:
    def get_module(self, module_id: str) -> dict:
        return MODULE_REGISTRY.get(module_id)
    
    def get_available_modules(self, lobster_id: str) -> list:
        return [m for m in MODULE_REGISTRY.values() 
                if lobster_id in m["available_to"] or "all" in m["available_to"]]
    
    def estimate_cost(self, module_id: str, count: int = 1) -> dict:
        """估算模块执行成本"""
        m = MODULE_REGISTRY[module_id]
        return {
            "tokens": m["avg_tokens"] * count,
            "latency_ms": m["avg_latency_ms"] * count,
        }
```

**验收标准**：
- [ ] 新建 `module_registry.py`，覆盖至少 10 个核心模块
- [ ] 每个模块定义 inputs/outputs/available_to/avg_tokens
- [ ] `lobster_runner.py` 在执行前通过 registry 查询可用模块
- [ ] SaaS 后台有 `/api/modules` 端点展示所有模块（运营可见）
- [ ] Commander 在任务规划时参考 module registry 估算执行成本

---

## Task 5: 边缘截图回传（marionette 执行可见性）

**借鉴**：Windsurf 的 `capture_browser_screenshot` + `capture_browser_console_logs`（边缘浏览器操作可观测）

**当前问题**：`marionette_executor.py` 执行浏览器操作但不回传截图，运营无法确认执行效果

**实现目标**：

```python
# edge-runtime/marionette_executor.py 升级

class MarionetteExecutor:
    
    async def execute_with_screenshot(self, action: dict) -> dict:
        """
        执行浏览器动作并自动截图回传
        参考 Windsurf 的 capture_browser_screenshot 工具
        """
        result = await self.execute(action)
        
        # 关键步骤自动截图
        if action.get("capture_screenshot", False) or self._is_critical_action(action):
            screenshot = await self.capture_screenshot()
            await self.upload_screenshot(screenshot, action_id=action["id"])
            result["screenshot_url"] = screenshot["url"]
            result["screenshot_ts"] = screenshot["timestamp"]
        
        return result
    
    def _is_critical_action(self, action: dict) -> bool:
        """关键动作自动触发截图（发送消息/提交表单/登录）"""
        critical_types = ["send_message", "submit_form", "login", "click_payment"]
        return action.get("type") in critical_types
    
    async def capture_screenshot(self) -> dict:
        """截取当前浏览器页面截图"""
        # 使用 Selenium/Playwright 截图
        ...
    
    async def upload_screenshot(self, screenshot: dict, action_id: str):
        """上传截图到云端，通知 Commander"""
        # 上传到 OSS/MinIO
        # 通过 WSS 通知云端
        await self.wss_client.send({
            "type": "edge_screenshot",
            "action_id": action_id,
            "url": screenshot["url"],
            "node_id": self.node_id,
        })
```

**验收标准**：
- [ ] `marionette_executor.py` 支持 `execute_with_screenshot()` 方法
- [ ] 关键动作（发消息/提交表单）自动触发截图
- [ ] 截图上传到对象存储，返回可访问 URL
- [ ] 云端 Commander 通过 WSS 接收截图通知
- [ ] SaaS 后台执行记录中可查看截图（时间线视图）

---

## 联动关系

```
Task 1 (Agent Loop)
  ↓ 每轮循环产生步骤事件
Task 2 (action_summary)
  ↓ 步骤事件带职责检查
Task 3 (Boundary Guard)
  ↓ 执行时通过 Module Registry 查询可用模块
Task 4 (Module Registry)
  ↓ 边缘执行关键步骤截图
Task 5 (Screenshot)
  ↓ 全部回传到 SaaS 后台实时展示
```

---

*借鉴来源：Manus Agent Loop + Windsurf toolSummary + Claude Code 2.0 | 2026-04-02*
