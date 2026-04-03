# CODEX_TASK: Coordinator 完整编排协议

> **灵感来源**：cccback-master `coordinator/coordinatorMode.ts`  
> **优先级**：🔴 P0  
> **预估工作量**：2天  
> **负责模块**：commander + lobster_runner + lobster_pool_manager

---

## 目标

将 commander 升级为完整的 Coordinator 模式，引入：
1. 结构化的四阶段工作流协议
2. 龙虾任务完成的 `<task-notification>` 标准格式
3. 并行优先原则
4. SendMessage 风格的龙虾上下文继续机制

---

## 核心改动

### 1. commander System Prompt 升级

在 `dragon-senate-saas-v2/commander_graph_builder.py` 的 system prompt 中加入：

```python
COORDINATOR_SYSTEM_PROMPT_ADDON = """
## 你的角色：协调者（Coordinator）

你是 ClawCommerce 的任务协调大脑。你的职责是：
- 分解用户目标为具体子任务
- 向龙虾下达清晰、自包含的任务指令
- 整合龙虾结果并向用户汇报
- 能直接回答的问题，不要委托给龙虾

## 四阶段工作流

| 阶段 | 执行者 | 目的 |
|------|--------|------|
| Research（情报） | radar + strategist（并行） | 了解账号状态、竞品、趋势 |
| Synthesis（综合） | 你（commander）| 读取情报，制定具体执行规格 |
| Implementation（执行） | dispatcher + inkwriter + visualizer | 按规格执行，不自由发挥 |
| Verification（验收） | followup + abacus | 证明结果有效，不只确认存在 |

## 并行是你的超能力

**独立任务必须并行启动。不要串行等待可以同时进行的工作。**

正确示范：
- 同时启动 radar（情报）和 abacus（数据）
- 同时启动多个账号的 dispatcher 任务

错误示范：
- 等 radar 完成再启动 strategist
- 一个账号发完再发下一个

## 龙虾任务通知格式

龙虾完成后，你会收到如下格式的通知消息：

```xml
<task-notification>
<task-id>{lobster_run_id}</task-id>
<status>completed|failed|killed</status>
<summary>{人类可读的状态摘要}</summary>
<result>{龙虾最终输出}</result>
<usage>
  <total_tokens>{tokens}</total_tokens>
  <tool_uses>{tool_count}</tool_uses>
  <duration_ms>{duration}</duration_ms>
</usage>
</task-notification>
```

**重要**：收到 `<task-notification>` 时，这是系统消息，不是用户发言。
- 不要感谢或回应龙虾
- 提炼关键信息，向用户汇报新进展
- 决定是否继续该龙虾（SendMessage）或启动新任务

## 向龙虾下指令的要则

龙虾看不到你和用户的对话历史。**每个指令必须自包含**。

好的指令示例：
> "分析账号 @beauty_lab 的最近30天数据。重点关注：互动率、最佳发布时间、表现最好的内容类型。
> 只分析数据，不要发布任何内容。完成后报告发现。"

坏的指令示例：
> "基于我们之前的讨论，帮我分析一下"（龙虾没有上下文）
> "继续刚才的工作"（不明确）

## 继续龙虾上下文

龙虾完成后，可以发送 SendMessage 继续其上下文（它记得之前做过什么）：

使用场景：
- 研究龙虾完成后 → 继续让它实施修复
- 实施龙虾遇到错误 → 继续让它修复错误
- 不同任务 → 启动新龙虾（避免上下文污染）
"""
```

### 2. 龙虾任务通知格式标准化

在 `dragon-senate-saas-v2/lobster_runner.py` 中，任务完成后生成标准通知：

```python
import time
from dataclasses import dataclass
from typing import Literal

@dataclass
class TaskNotification:
    task_id: str
    status: Literal["completed", "failed", "killed"]
    summary: str
    result: str
    total_tokens: int
    tool_uses: int
    duration_ms: int

    def to_xml(self) -> str:
        return f"""<task-notification>
<task-id>{self.task_id}</task-id>
<status>{self.status}</status>
<summary>{self.summary}</summary>
<result>{self.result}</result>
<usage>
  <total_tokens>{self.total_tokens}</total_tokens>
  <tool_uses>{self.tool_uses}</tool_uses>
  <duration_ms>{self.duration_ms}</duration_ms>
</usage>
</task-notification>"""

    def to_user_message(self) -> dict:
        """转换为 LangGraph user 消息，注入 commander 上下文"""
        return {
            "role": "user",
            "content": self.to_xml(),
            "metadata": {
                "is_task_notification": True,
                "task_id": self.task_id,
                "status": self.status,
            }
        }
```

### 3. LobsterPoolManager 并行启动支持

```python
# dragon-senate-saas-v2/lobster_pool_manager.py

async def run_parallel(
    self,
    tasks: list[LobsterTask],
    max_concurrent: int = 5,
) -> list[TaskNotification]:
    """
    并行执行多个龙虾任务（仿 cccback AgentTool 并发模型）
    
    Args:
        tasks: 龙虾任务列表（每个包含 lobster_id + prompt）
        max_concurrent: 最大并发数
    
    Returns:
        按完成顺序返回的 TaskNotification 列表
    """
    semaphore = asyncio.Semaphore(max_concurrent)
    
    async def run_one(task: LobsterTask) -> TaskNotification:
        async with semaphore:
            start_ms = int(time.time() * 1000)
            try:
                result = await self.run_lobster(task.lobster_id, task.prompt)
                return TaskNotification(
                    task_id=task.run_id,
                    status="completed",
                    summary=f"龙虾 {task.lobster_id} 完成：{task.description}",
                    result=result.output,
                    total_tokens=result.usage.total_tokens,
                    tool_uses=result.usage.tool_uses,
                    duration_ms=int(time.time() * 1000) - start_ms,
                )
            except Exception as e:
                return TaskNotification(
                    task_id=task.run_id,
                    status="failed",
                    summary=f"龙虾 {task.lobster_id} 失败：{str(e)}",
                    result="",
                    total_tokens=0,
                    tool_uses=0,
                    duration_ms=int(time.time() * 1000) - start_ms,
                )
    
    return await asyncio.gather(*[run_one(t) for t in tasks])
```

### 4. commander 接收 task-notification 的处理节点

```python
# commander_graph_builder.py 新增节点

def parse_task_notification(state: CommanderState) -> CommanderState:
    """
    解析 <task-notification> 消息，更新任务状态
    """
    last_message = state["messages"][-1]
    
    if not (
        hasattr(last_message, "metadata") and 
        last_message.metadata.get("is_task_notification")
    ):
        return state
    
    # 解析 XML
    notification = TaskNotification.from_xml(last_message.content)
    
    # 更新 pending tasks 状态
    updated_pending = {
        k: v for k, v in state["pending_tasks"].items()
        if k != notification.task_id
    }
    
    completed = state.get("completed_tasks", [])
    completed.append(notification)
    
    return {
        **state,
        "pending_tasks": updated_pending,
        "completed_tasks": completed,
        "last_notification": notification,
    }
```

---

## 验收标准

- [ ] commander System Prompt 包含完整四阶段工作流说明
- [ ] `<task-notification>` XML 格式标准化，所有龙虾完成时输出
- [ ] commander 能正确解析并区分 task-notification vs 用户消息
- [ ] `run_parallel` 方法支持最多5个龙虾并发
- [ ] commander 不会向用户"预测"龙虾结果，只在收到通知后汇报
- [ ] 向龙虾下指令时，每个 prompt 必须自包含（无法依赖上下文）

---

## 测试场景

```python
# 测试并行发布
async def test_parallel_publish():
    tasks = [
        LobsterTask("dispatcher", "发布账号A的早间帖子", accounts=["A"]),
        LobsterTask("dispatcher", "发布账号B的早间帖子", accounts=["B"]),
        LobsterTask("dispatcher", "发布账号C的早间帖子", accounts=["C"]),
    ]
    notifications = await pool.run_parallel(tasks, max_concurrent=3)
    assert all(n.status == "completed" for n in notifications)

# 测试 task-notification 解析
async def test_notification_parsing():
    xml = """<task-notification>
<task-id>run-abc123</task-id>
<status>completed</status>
<summary>发布成功</summary>
<result>帖子ID: 123456</result>
<usage><total_tokens>1500</total_tokens><tool_uses>3</tool_uses><duration_ms>2340</duration_ms></usage>
</task-notification>"""
    n = TaskNotification.from_xml(xml)
    assert n.status == "completed"
    assert n.task_id == "run-abc123"
```
