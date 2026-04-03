# CODEX_TASK: 龙虾异步后台化

> **灵感来源**：cccback-master `tools/AgentTool/AgentTool.tsx` (Promise.race + background signal)  
> **优先级**：🔴 P0  
> **预估工作量**：2天  
> **负责模块**：lobster_runner + lobster_pool_manager + app.py

---

## 目标

将龙虾执行从纯同步阻塞升级为支持热迁移的异步模型：
- 龙虾启动后2秒内完成 → 同步返回结果（用户无感知）
- 超过2秒 → 前端提示"可后台化"，不阻塞主界面
- 用户确认后台 → 立即返回 `async_launched`，后台继续执行
- 完成后通过 SSE/WebSocket 推送 `<task-notification>`

---

## 核心改动

### 1. LobsterExecutionMode 枚举

```python
# dragon-senate-saas-v2/lobster_runner.py

from enum import Enum

class LobsterExecutionMode(Enum):
    FOREGROUND = "foreground"   # 同步等待，2s 后提示可后台化
    BACKGROUND = "background"   # 直接后台运行，完成后通知
    AUTO = "auto"               # 自动：前台超时后热迁移（默认）
```

### 2. LobsterForegroundRegistry

```python
# dragon-senate-saas-v2/lobster_pool_manager.py

import asyncio
from dataclasses import dataclass, field

@dataclass
class ForegroundTask:
    run_id: str
    lobster_id: str
    description: str
    started_at: float
    background_event: asyncio.Event = field(default_factory=asyncio.Event)
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)

class LobsterForegroundRegistry:
    """
    前台任务注册表，支持热迁移到后台
    仿 cccback registerAgentForeground / unregisterAgentForeground
    """
    
    def __init__(self):
        self._tasks: dict[str, ForegroundTask] = {}
    
    def register(self, run_id: str, lobster_id: str, description: str) -> ForegroundTask:
        task = ForegroundTask(
            run_id=run_id,
            lobster_id=lobster_id,
            description=description,
            started_at=asyncio.get_event_loop().time(),
        )
        self._tasks[run_id] = task
        return task
    
    def background_one(self, run_id: str):
        """将指定任务推到后台"""
        if task := self._tasks.get(run_id):
            task.background_event.set()
    
    def background_all(self):
        """将所有前台任务推到后台"""
        for task in self._tasks.values():
            task.background_event.set()
    
    def cancel(self, run_id: str):
        """取消指定任务"""
        if task := self._tasks.get(run_id):
            task.cancel_event.set()
    
    def unregister(self, run_id: str):
        self._tasks.pop(run_id, None)
    
    def list_foreground(self) -> list[ForegroundTask]:
        return list(self._tasks.values())
```

### 3. run_lobster_with_background_support

```python
# dragon-senate-saas-v2/lobster_runner.py

FOREGROUND_HINT_DELAY_SEC = 2.0  # 2秒后提示可后台化

async def run_lobster_with_background_support(
    self,
    lobster_id: str,
    prompt: str,
    description: str,
    mode: LobsterExecutionMode = LobsterExecutionMode.AUTO,
    on_background_hint: Callable | None = None,
    on_complete: Callable[[TaskNotification], None] | None = None,
) -> TaskNotification | AsyncLaunchedResult:
    """
    带后台化支持的龙虾执行（仿 cccback AgentTool sync→async 热迁移）
    
    Returns:
        - TaskNotification: 同步完成（2秒内）
        - AsyncLaunchedResult: 已后台化，完成后通过 on_complete 回调
    """
    run_id = f"run-{uuid4().hex[:8]}"
    start_ms = int(time.time() * 1000)
    
    # 注册为前台任务
    fg_task = self.registry.register(run_id, lobster_id, description)
    
    # 直接后台模式
    if mode == LobsterExecutionMode.BACKGROUND:
        fg_task.background_event.set()
    
    # 后台提示 coroutine（2s 后触发）
    async def background_hint_trigger():
        await asyncio.sleep(FOREGROUND_HINT_DELAY_SEC)
        if on_background_hint and not fg_task.background_event.is_set():
            on_background_hint(run_id, description)
    
    # 龙虾实际执行 coroutine
    lobster_future = asyncio.create_task(
        self._execute_lobster(lobster_id, prompt, run_id)
    )
    
    hint_task = asyncio.create_task(background_hint_trigger())
    
    try:
        # Promise.race：龙虾完成 vs 后台化信号
        background_signal = asyncio.create_task(
            fg_task.background_event.wait()
        )
        
        done, _ = await asyncio.wait(
            [lobster_future, background_signal],
            return_when=asyncio.FIRST_COMPLETED,
        )
        
        if lobster_future in done:
            # 同步完成（2秒内）
            hint_task.cancel()
            background_signal.cancel()
            result = lobster_future.result()
            notification = TaskNotification(
                task_id=run_id,
                status="completed",
                summary=f"{description} 完成",
                result=result.output,
                total_tokens=result.usage.total_tokens,
                tool_uses=result.usage.tool_uses,
                duration_ms=int(time.time() * 1000) - start_ms,
            )
            return notification
        
        else:
            # 后台化信号触发 → 热迁移到后台
            hint_task.cancel()
            background_signal.cancel()
            
            # 启动后台 task 继续执行
            async def background_continuation():
                try:
                    result = await lobster_future
                    notification = TaskNotification(
                        task_id=run_id,
                        status="completed",
                        summary=f"{description} 完成（后台）",
                        result=result.output,
                        total_tokens=result.usage.total_tokens,
                        tool_uses=result.usage.tool_uses,
                        duration_ms=int(time.time() * 1000) - start_ms,
                    )
                except Exception as e:
                    notification = TaskNotification(
                        task_id=run_id,
                        status="failed",
                        summary=f"{description} 失败：{str(e)}",
                        result="",
                        total_tokens=0,
                        tool_uses=0,
                        duration_ms=int(time.time() * 1000) - start_ms,
                    )
                finally:
                    self.registry.unregister(run_id)
                
                if on_complete:
                    on_complete(notification)
                
                # 推送到 SSE 流
                await self.notification_queue.put(notification)
            
            asyncio.create_task(background_continuation())
            
            return AsyncLaunchedResult(
                run_id=run_id,
                lobster_id=lobster_id,
                description=description,
                output_file=f"/tmp/lobster-output-{run_id}.json",
            )
    
    except asyncio.CancelledError:
        lobster_future.cancel()
        hint_task.cancel()
        raise
    
    finally:
        self.registry.unregister(run_id)
```

### 4. SSE 通知推送端点

```python
# dragon-senate-saas-v2/app.py

from sse_starlette.sse import EventSourceResponse

@app.get("/api/lobster/notifications")
async def lobster_notifications(request: Request):
    """
    SSE 端点：推送龙虾任务完成通知
    前端订阅此端点，接收 <task-notification> XML
    """
    async def event_generator():
        while True:
            if await request.is_disconnected():
                break
            try:
                # 非阻塞取通知（100ms 超时）
                notification = await asyncio.wait_for(
                    pool_manager.notification_queue.get(),
                    timeout=0.1,
                )
                yield {
                    "event": "task_notification",
                    "data": notification.to_xml(),
                }
            except asyncio.TimeoutError:
                # 心跳
                yield {"event": "ping", "data": ""}
    
    return EventSourceResponse(event_generator())

@app.post("/api/lobster/{run_id}/background")
async def push_to_background(run_id: str):
    """用户手动将任务推到后台"""
    pool_manager.registry.background_one(run_id)
    return {"status": "backgrounded", "run_id": run_id}

@app.post("/api/lobster/background-all")
async def push_all_to_background():
    """将所有前台任务推到后台"""
    pool_manager.registry.background_all()
    return {"status": "all_backgrounded"}
```

### 5. 前台任务状态 API

```python
@app.get("/api/lobster/foreground")
async def list_foreground_tasks():
    """列出当前前台任务（前端用于显示后台化提示）"""
    tasks = pool_manager.registry.list_foreground()
    return {
        "tasks": [
            {
                "run_id": t.run_id,
                "lobster_id": t.lobster_id,
                "description": t.description,
                "elapsed_sec": asyncio.get_event_loop().time() - t.started_at,
            }
            for t in tasks
        ]
    }
```

---

## 验收标准

- [ ] 龙虾执行2秒内完成 → 同步返回 TaskNotification，用户无感知
- [ ] 超过2秒 → 前端收到后台化提示（通过 on_background_hint 回调）
- [ ] 用户点击"后台化" → 立即返回 AsyncLaunchedResult，后台继续
- [ ] 龙虾后台完成 → SSE 推送 task-notification XML
- [ ] `/api/lobster/notifications` SSE 端点正常工作
- [ ] background_all() 能将所有前台任务一键推到后台
- [ ] 后台任务失败 → 仍然推送 failed 状态的 task-notification

---

## 与现有代码的关系

- 扩展 `lobster_runner.py` 的 `run_lobster` 方法
- 扩展 `lobster_pool_manager.py` 添加 registry
- 在 `app.py` 新增3个 API 端点
- 与 G04（Retry+Escalate）协同：后台任务失败时触发升级逻辑
