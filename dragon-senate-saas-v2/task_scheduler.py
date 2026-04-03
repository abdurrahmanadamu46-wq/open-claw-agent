"""
Layer 2 task scheduler facade.

This module keeps backward compatibility with the existing cron scheduler while
exposing the higher-level names requested by the architecture plan:
- TaskScheduler
- SQLiteTaskStore
- TaskStateMachine
- RhythmController
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from cron_scheduler import CronScheduler
from cron_scheduler import ScheduleKind
from cron_scheduler import ScheduledTask
from cron_scheduler import SchedulerStore as SQLiteTaskStore
from task_state_machine import TaskStateMachine
from rhythm_controller import RhythmController


@dataclass(slots=True)
class DispatchDecision:
    task_id: str
    allowed: bool
    reason: str


class TaskScheduler:
    """Unified Layer 2 scheduler facade over the existing cron engine."""

    def __init__(
        self,
        executor: Callable[[ScheduledTask], Awaitable[str]],
        *,
        db_path: str = "data/scheduler.sqlite",
        state_path: str = "data/task_state_machine.json",
        rhythm_path: str = "data/rhythm_controller.json",
        check_interval: float = 10.0,
    ):
        self.db = SQLiteTaskStore(db_path)
        self.state_machine = TaskStateMachine(state_path)
        self.rhythm_controller = RhythmController(rhythm_path)
        self._cron = CronScheduler(self.db, executor, check_interval=check_interval)

    async def schedule_task(self, task: ScheduledTask, mode: str) -> ScheduledTask:
        task.kind = ScheduleKind(str(mode))
        self.state_machine.transition(task.task_id, "QUEUED", note=f"scheduled:{mode}")
        return self._cron.add_task(task)

    async def dispatch_to_edge(self, task_id: str) -> DispatchDecision:
        task = self.db.get_task(task_id)
        if task is None:
            return DispatchDecision(task_id=task_id, allowed=False, reason="task_not_found")
        if not task.enabled:
            return DispatchDecision(task_id=task_id, allowed=False, reason="task_disabled")
        if self.rhythm_controller.should_throttle(task.tenant_id):
            return DispatchDecision(task_id=task_id, allowed=False, reason="tenant_throttled")
        if not self.rhythm_controller.is_within_time_window(task.tenant_id):
            return DispatchDecision(task_id=task_id, allowed=False, reason="outside_time_window")
        self.state_machine.transition(task_id, "DISPATCHED", note="dispatch_to_edge")
        return DispatchDecision(task_id=task_id, allowed=True, reason="dispatched")

    async def tick(self) -> None:
        await self._cron._tick()  # noqa: SLF001

    async def run(self) -> None:
        await self._cron.run()

    def stop(self) -> None:
        self._cron.stop()
