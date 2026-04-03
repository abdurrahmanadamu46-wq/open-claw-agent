"""
api_lobster_realtime.py — 龙虾实时通信 API 路由
=================================================
新增端点（供 app.py 通过 include_router 挂载）：

  GET  /api/lobster/notifications       SSE：龙虾任务完成通知流
  GET  /api/lobster/foreground          前台任务列表
  POST /api/lobster/{run_id}/background 将指定任务推到后台
  POST /api/lobster/background-all      将所有前台任务推到后台
  POST /api/lobster/{run_id}/cancel     取消指定任务

  GET  /api/session/{session_id}/compaction-stats  Token 使用统计
  POST /api/session/{session_id}/compact           手动触发压缩

灵感来源：
  cccback-master remote/RemoteSessionManager.ts  — SSE 通知推送
  cccback-master services/compact/compact.ts     — 压缩状态 API

挂载方式（在 app.py 中）：
  from api_lobster_realtime import router as realtime_router
  app.include_router(realtime_router, prefix="")
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import asdict, dataclass, field
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

logger = logging.getLogger("api_lobster_realtime")

router = APIRouter(tags=["lobster-realtime"])

# ---------------------------------------------------------------------------
# 全局通知队列（龙虾后台完成 → SSE 推送）
# 初始化时创建，run_lobster_with_background_support 会往里塞通知
# ---------------------------------------------------------------------------

_notification_queue: asyncio.Queue | None = None
_step_event_queue: asyncio.Queue | None = None


ACTION_SUMMARY_MAP = {
    "load_system_prompt": "载入提示",
    "load_user_prompt": "解析任务",
    "generate_response": "生成回复",
    "reasoning_iteration": "分析任务",
    "execute_tools_iteration": "执行工具",
    "read_lead_profile": "分析线索",
    "search_memory": "查询记忆",
    "generate_message": "撰写消息",
    "send_message": "发送消息",
    "update_lead_status": "更新状态",
    "create_content": "生成内容",
    "schedule_followup": "安排跟进",
    "query_knowledge_base": "查询知识",
    "call_lobster": "协作龙虾",
    "wait_reply": "等待回复",
}


@dataclass(slots=True)
class LobsterStepEvent:
    step_id: str
    lobster_id: str
    round: int = 0
    action_type: str = ""
    action_summary: str = ""
    why: str = ""
    status: str = "done"
    started_at: float = field(default_factory=time.time)
    finished_at: float = field(default_factory=time.time)
    result_preview: str = ""
    task_id: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _compact_text(text: str, limit: int = 80) -> str:
    normalized = " ".join(str(text or "").split())
    return normalized[:limit]


def build_action_summary(action_type: str, fallback: str = "处理中") -> str:
    key = str(action_type or "").strip()
    if key in ACTION_SUMMARY_MAP:
        return ACTION_SUMMARY_MAP[key]
    if key.startswith("reasoning_iteration"):
        return ACTION_SUMMARY_MAP["reasoning_iteration"]
    if key.startswith("execute_tools_iteration"):
        return ACTION_SUMMARY_MAP["execute_tools_iteration"]
    return fallback[:5]


def get_notification_queue() -> asyncio.Queue:
    """获取全局通知队列（懒初始化）"""
    global _notification_queue
    if _notification_queue is None:
        _notification_queue = asyncio.Queue(maxsize=1000)
    return _notification_queue


def get_step_event_queue() -> asyncio.Queue:
    global _step_event_queue
    if _step_event_queue is None:
        _step_event_queue = asyncio.Queue(maxsize=2000)
    return _step_event_queue


async def publish_step_event(
    *,
    lobster_id: str,
    action_type: str,
    round: int = 0,
    why: str = "",
    status: str = "done",
    result_preview: str = "",
    task_id: str = "",
    started_at: float | None = None,
    finished_at: float | None = None,
) -> None:
    event = LobsterStepEvent(
        step_id=f"step_{int(time.time() * 1000)}_{lobster_id}",
        lobster_id=lobster_id,
        round=round,
        action_type=action_type,
        action_summary=build_action_summary(action_type),
        why=_compact_text(why, 120),
        status=status,
        started_at=started_at or time.time(),
        finished_at=finished_at or time.time(),
        result_preview=_compact_text(result_preview, 120),
        task_id=task_id,
    )
    await get_step_event_queue().put(event)


# ---------------------------------------------------------------------------
# SSE 通知端点（仿 cccback RemoteSessionManager WebSocket 推送）
# ---------------------------------------------------------------------------

@router.get("/api/lobster/notifications")
async def lobster_notifications(request: Request):
    """
    SSE 端点：实时推送龙虾任务完成通知。

    前端订阅方式：
        const es = new EventSource('/api/lobster/notifications');
        es.addEventListener('task_notification', (e) => {
            const xml = e.data;
            // 解析 <task-notification> XML
        });

    事件类型：
        task_notification — 龙虾任务完成（XML 格式）
        ping              — 心跳（每5秒，防连接超时）
    """
    queue = get_notification_queue()

    async def event_generator():
        last_ping = time.time()
        while True:
            # 检测客户端断开
            if await request.is_disconnected():
                logger.info("[SSE] 客户端断开连接")
                break

            # 每5秒发送心跳
            if time.time() - last_ping > 5.0:
                yield f"event: ping\ndata: {int(time.time())}\n\n"
                last_ping = time.time()

            try:
                # 非阻塞获取通知（100ms 超时）
                from lobster_pool_manager import TaskNotification

                notification: TaskNotification = await asyncio.wait_for(
                    queue.get(), timeout=0.1
                )

                # 推送 XML 格式的 task-notification
                xml_data = notification.to_xml()
                yield f"event: task_notification\ndata: {xml_data}\n\n"

                logger.info(
                    "[SSE] 推送通知：%s status=%s",
                    notification.task_id,
                    notification.status,
                )

            except asyncio.TimeoutError:
                pass  # 继续等待
            except Exception as e:
                logger.error("[SSE] 推送异常：%s", e)
                break

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # Nginx 不缓冲
        },
    )


@router.get("/api/lobster/steps")
async def lobster_step_events(request: Request):
    """
    SSE 端点：实时推送龙虾步骤摘要事件。

    事件类型：
      lobster_step — 标准化步骤摘要（含 action_summary / why / result_preview）
      ping         — 心跳
    """
    queue = get_step_event_queue()

    async def event_generator():
        last_ping = time.time()
        while True:
            if await request.is_disconnected():
                break
            if time.time() - last_ping > 5.0:
                yield f"event: ping\ndata: {int(time.time())}\n\n"
                last_ping = time.time()
            try:
                event: LobsterStepEvent = await asyncio.wait_for(queue.get(), timeout=0.1)
                payload = json.dumps(event.to_dict(), ensure_ascii=False)
                yield f"event: lobster_step\ndata: {payload}\n\n"
            except asyncio.TimeoutError:
                pass
            except Exception as exc:  # noqa: BLE001
                logger.error("[SSE] step event push failed: %s", exc)
                break

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# 前台任务管理端点（仿 cccback registerAgentForeground）
# ---------------------------------------------------------------------------

@router.get("/api/lobster/foreground")
async def list_foreground_tasks():
    """
    列出当前所有前台运行中的龙虾任务。
    前端轮询此端点，超过2秒的任务显示"后台化"按钮。
    """
    from lobster_pool_manager import get_foreground_registry

    registry = get_foreground_registry()
    tasks = registry.to_dict_list()

    return {
        "ok": True,
        "foreground_count": len(tasks),
        "tasks": tasks,
        "hint_threshold_sec": 2.0,
    }


@router.post("/api/lobster/{run_id}/background")
async def push_to_background(run_id: str):
    """
    将指定任务推到后台（用户点击"后台化"按钮时调用）。
    立即返回，任务继续在后台执行，完成后通过 SSE 推送通知。
    """
    from lobster_pool_manager import get_foreground_registry

    registry = get_foreground_registry()
    success = registry.background_one(run_id)

    if not success:
        raise HTTPException(
            status_code=404,
            detail=f"前台任务 {run_id} 不存在或已完成",
        )

    return {
        "ok": True,
        "run_id": run_id,
        "status": "backgrounded",
        "message": f"任务 {run_id} 已推到后台，完成后将推送通知",
    }


@router.post("/api/lobster/background-all")
async def push_all_to_background():
    """
    将所有前台任务一键推到后台（用户按 ESC 时调用）。
    仿 cccback 按 ESC 后台化所有 Agent 的行为。
    """
    from lobster_pool_manager import get_foreground_registry

    registry = get_foreground_registry()
    count = registry.background_all()

    return {
        "ok": True,
        "backgrounded_count": count,
        "message": f"已将 {count} 个前台任务推到后台",
    }


@router.post("/api/lobster/{run_id}/cancel")
async def cancel_task(run_id: str):
    """取消指定龙虾任务"""
    from lobster_pool_manager import get_foreground_registry

    registry = get_foreground_registry()
    success = registry.cancel(run_id)

    return {
        "ok": success,
        "run_id": run_id,
        "status": "cancelled" if success else "not_found",
    }


# ---------------------------------------------------------------------------
# 并行龙虾启动端点
# ---------------------------------------------------------------------------

@router.post("/api/lobster/parallel")
async def run_parallel_lobsters(request: Request):
    """
    并行启动多个龙虾任务。

    请求体：
    {
        "tasks": [
            {"lobster_id": "dispatcher", "prompt": "...", "description": "发布账号A"},
            {"lobster_id": "radar", "prompt": "...", "description": "情报收集"}
        ],
        "max_concurrent": 3
    }

    返回：立即返回所有任务的 run_id 列表，
    实际执行异步进行，完成后通过 SSE 推送通知。
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="无效的 JSON 请求体")

    raw_tasks = body.get("tasks", [])
    max_concurrent = int(body.get("max_concurrent", 2))

    if not raw_tasks:
        raise HTTPException(status_code=400, detail="tasks 列表不能为空")

    from lobster_pool_manager import LobsterTask, get_foreground_registry
    from lobster_runner import LobsterRunSpec, LobsterRunner

    tasks = [
        LobsterTask(
            lobster_id=t.get("lobster_id", "commander"),
            prompt=t.get("prompt", ""),
            description=t.get("description", t.get("lobster_id", "任务")),
            meta=t.get("meta"),
        )
        for t in raw_tasks
    ]

    # 所有任务直接以后台模式启动
    queue = get_notification_queue()
    registry = get_foreground_registry()

    launched: list[dict[str, Any]] = []
    for task in tasks:
        fg = registry.register(task.run_id, task.lobster_id, task.description)
        fg.background_event.set()  # 直接后台
        launched.append({
            "run_id": task.run_id,
            "lobster_id": task.lobster_id,
            "description": task.description,
            "status": "launched",
        })

    # 异步触发并行执行
    async def _run_all():
        try:
            from llm_router import LLMRouter
            llm_router = LLMRouter()
            runner = LobsterRunner(llm_router)

            from lobster_pool_manager import run_parallel
            await run_parallel(
                tasks=tasks,
                runner=runner,
                max_concurrent=max_concurrent,
                notification_queue=queue,
            )
        except Exception as e:
            logger.error("[parallel] 并行执行异常：%s", e)

    asyncio.create_task(_run_all())

    return {
        "ok": True,
        "launched": launched,
        "max_concurrent": max_concurrent,
        "message": f"已并行启动 {len(tasks)} 个龙虾任务，完成后通过 SSE 推送通知",
    }


# ---------------------------------------------------------------------------
# 对话压缩状态端点（仿 cccback auto-compact stats）
# ---------------------------------------------------------------------------

@router.get("/api/session/{session_id}/compaction-stats")
async def get_compaction_stats(session_id: str):
    """
    查看指定会话的 Token 使用情况和压缩历史。
    前端可据此显示进度条（Token 使用率）。
    """
    from lobster_runner import get_compaction_context
    from conversation_compactor import ConversationCompactor

    ctx = get_compaction_context(session_id)
    compactor = ConversationCompactor(llm_router=None)  # type: ignore

    # 从 session_manager 获取消息（如果可用）
    messages: list[dict] = []
    try:
        from session_manager import get_session_manager
        session_mgr = get_session_manager()
        sessions = session_mgr.list_sessions()
        for s in sessions:
            if s.session_id == session_id:
                messages = s.messages or []
                break
    except Exception:
        pass

    stats = compactor.get_stats(messages)

    return {
        "ok": True,
        "session_id": session_id,
        "compaction_count": ctx.get("compaction_count", 0),
        "recent_files_tracked": len(ctx.get("recent_files", [])),
        "has_workflow": bool(ctx.get("current_workflow")),
        "skills_tracked": len(ctx.get("used_skills", [])),
        **stats,
    }


@router.post("/api/session/{session_id}/compact")
async def force_compact(session_id: str, request: Request):
    """
    手动触发对话压缩（调试/测试用）。
    生产环境中压缩由 check_and_compact_messages 自动触发。
    """
    from lobster_runner import get_compaction_context
    from conversation_compactor import ConversationCompactor

    # 尝试获取 llm_router
    try:
        from llm_router import LLMRouter
        llm_router = LLMRouter()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLMRouter 初始化失败：{e}")

    compactor = ConversationCompactor(llm_router=llm_router)
    ctx = get_compaction_context(session_id)

    # 从 session_manager 获取消息
    messages: list[dict] = []
    session_mgr_instance = None
    session_obj = None
    try:
        from session_manager import get_session_manager
        session_mgr_instance = get_session_manager()
        for s in session_mgr_instance.list_sessions():
            if s.session_id == session_id:
                messages = list(s.messages or [])
                session_obj = s
                break
    except Exception:
        pass

    if not messages:
        raise HTTPException(
            status_code=404,
            detail=f"会话 {session_id} 不存在或消息为空",
        )

    if not compactor.should_compact(messages):
        stats = compactor.get_stats(messages)
        return {
            "ok": True,
            "compacted": False,
            "reason": "Token 未超过触发阈值，无需压缩",
            **stats,
        }

    try:
        result = await compactor.compact(messages, ctx)
        new_messages = compactor.apply_compaction(result)

        # 持久化压缩后的消息（如果 session_manager 支持）
        if session_mgr_instance and session_obj:
            try:
                session_mgr_instance.replace_messages(session_id, new_messages)
            except Exception:
                pass  # 不是所有 session_manager 都支持 replace_messages

        ctx["compaction_count"] = ctx.get("compaction_count", 0) + 1

        return {
            "ok": True,
            "compacted": True,
            "session_id": session_id,
            "pre_tokens": result.pre_compact_token_count,
            "post_tokens": result.post_compact_token_count,
            "tokens_saved": result.pre_compact_token_count - result.post_compact_token_count,
            "will_retrigger": result.will_retrigger,
            "attachment_count": len(result.attachments),
            "compaction_count": ctx["compaction_count"],
        }

    except Exception as e:
        logger.exception("[Compact] 手动压缩失败 session=%s", session_id)
        raise HTTPException(status_code=500, detail=f"压缩失败：{e}")
