"""
LobsterTaskWaiter — 带超时+Dead Lobster 恢复的等待循环
======================================================
灵感来源：ClawTeam-OpenClaw (team/waiter.py TaskWaiter)
借鉴要点：
  - 等待所有龙虾任务完成（带超时、进度回调）
  - 每轮：① 收消息 ② 检测死亡龙虾+任务恢复 ③ 检查完成率 ④ 进度通知
  - WaitResult：汇总最终状态（completed/timeout/interrupted）
  - 可选 on_progress / on_message / on_dead_lobster 回调

使用方式：
    waiter = LobsterTaskWaiter(
        dag=dag,
        mailbox=mailbox,
        coordinator_name="coordinator",
        team_id="run-001",
        timeout=300,
        on_progress=lambda r: print(f"进度: {r.progress_pct}%"),
    )
    result = waiter.wait()
    if result.status == "completed":
        print("✅ 所有任务完成")
"""

from __future__ import annotations

import signal
import time
from dataclasses import dataclass, field
from typing import Callable, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from lobster_task_dag import LobsterTaskDAG
    from lobster_mailbox import LobsterMailbox, LobsterMessage


# ─────────────────────────────────────────────────────────────────
# WaitResult
# ─────────────────────────────────────────────────────────────────

@dataclass
class WaitResult:
    """等待结果（对应 ClawTeam WaitResult）"""
    status:            str    = "unknown"      # completed / timeout / interrupted / error
    elapsed:           float  = 0.0
    total:             int    = 0
    completed:         int    = 0
    in_progress:       int    = 0
    pending:           int    = 0
    blocked:           int    = 0
    failed:            int    = 0
    dead_lobsters:     list   = field(default_factory=list)
    recovered_tasks:   list   = field(default_factory=list)
    messages_received: int    = 0
    polls:             int    = 0

    @property
    def progress_pct(self) -> float:
        if self.total == 0:
            return 0.0
        return round(self.completed / self.total * 100, 1)

    @property
    def is_all_done(self) -> bool:
        return self.completed > 0 and self.completed >= self.total and self.in_progress == 0 and self.pending == 0

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "elapsed_s": round(self.elapsed, 1),
            "total": self.total,
            "completed": self.completed,
            "in_progress": self.in_progress,
            "pending": self.pending,
            "blocked": self.blocked,
            "failed": self.failed,
            "progress_pct": self.progress_pct,
            "dead_lobsters": self.dead_lobsters,
            "recovered_tasks": self.recovered_tasks,
            "messages_received": self.messages_received,
            "polls": self.polls,
        }


# ─────────────────────────────────────────────────────────────────
# LobsterTaskWaiter
# ─────────────────────────────────────────────────────────────────

class LobsterTaskWaiter:
    """
    等待龙虾团队完成所有任务（对应 ClawTeam TaskWaiter）。

    每个 poll 周期执行：
    1. 从 Mailbox 收取并处理消息（on_message 回调）
    2. 检测死亡龙虾，恢复其持有任务（on_dead_lobster 回调）
    3. 刷新任务统计（DAG 摘要）
    4. 若进度变化，调用 on_progress 回调
    5. 检查是否全部完成 / 超时 / 被中断
    6. 等待 poll_interval 秒后重复
    """

    def __init__(
        self,
        dag: "LobsterTaskDAG",
        mailbox: "LobsterMailbox",
        coordinator_name: str,
        team_id: str,
        poll_interval: float = 5.0,
        timeout: Optional[float] = None,           # None = 无超时
        dead_lobster_threshold_s: float = 60.0,    # 无心跳多久视为死亡
        on_message: Optional[Callable[["LobsterMessage"], None]] = None,
        on_progress: Optional[Callable[["WaitResult"], None]] = None,
        on_dead_lobster: Optional[Callable[[str, list[str]], None]] = None,
        on_complete: Optional[Callable[["WaitResult"], None]] = None,
    ) -> None:
        self._dag = dag
        self._mailbox = mailbox
        self._coordinator = coordinator_name
        self._team_id = team_id
        self._poll_interval = poll_interval
        self._timeout = timeout
        self._dead_threshold = dead_lobster_threshold_s
        self._on_message = on_message
        self._on_progress = on_progress
        self._on_dead_lobster = on_dead_lobster
        self._on_complete = on_complete
        self._interrupted = False

    def wait(self) -> WaitResult:
        """
        阻塞等待直到：所有任务完成 / 超时 / 收到 SIGINT。
        返回 WaitResult 汇总。
        """
        result = WaitResult()
        start_ts = time.time()
        last_progress = -1

        # 安装 SIGINT 优雅中断
        original_handler = signal.getsignal(signal.SIGINT)
        def _sigint(sig, frame):
            self._interrupted = True
        try:
            signal.signal(signal.SIGINT, _sigint)
        except (OSError, ValueError):
            pass  # 非主线程无法安装 signal

        try:
            while True:
                result.polls += 1
                elapsed = time.time() - start_ts
                result.elapsed = elapsed

                # ① 处理消息
                try:
                    msgs = self._mailbox.receive(
                        self._coordinator, team_id=self._team_id, limit=50
                    )
                    result.messages_received += len(msgs)
                    if self._on_message:
                        for m in msgs:
                            try:
                                self._on_message(m)
                            except Exception:
                                pass
                except Exception:
                    pass

                # ② 检测死亡龙虾 + 任务恢复
                try:
                    dead = self._mailbox.get_dead_lobsters(
                        team_id=self._team_id,
                        threshold_s=self._dead_threshold,
                    )
                    for lobster_name in dead:
                        if lobster_name not in result.dead_lobsters:
                            result.dead_lobsters.append(lobster_name)
                            recovered = self._dag.recover_dead_lobster(lobster_name)
                            result.recovered_tasks.extend(recovered)
                            if self._on_dead_lobster:
                                try:
                                    self._on_dead_lobster(lobster_name, recovered)
                                except Exception:
                                    pass
                except Exception:
                    pass

                # ③ 刷新任务统计
                try:
                    summary = self._dag.get_dag_summary(self._team_id)
                    result.total       = summary.get("total", 0)
                    result.completed   = summary.get("completed", 0)
                    result.in_progress = summary.get("in_progress", 0)
                    result.pending     = summary.get("pending", 0)
                    result.blocked     = summary.get("blocked", 0)
                    result.failed      = summary.get("failed", 0)
                except Exception:
                    pass

                # ④ 进度回调
                if self._on_progress and result.progress_pct != last_progress:
                    last_progress = result.progress_pct
                    try:
                        self._on_progress(result)
                    except Exception:
                        pass

                # ⑤ 检查终止条件
                if self._interrupted:
                    result.status = "interrupted"
                    break

                if self._timeout and elapsed >= self._timeout:
                    result.status = "timeout"
                    break

                if result.is_all_done:
                    result.status = "completed"
                    break

                # ⑥ 等待下一轮
                time.sleep(self._poll_interval)

        finally:
            # 恢复 SIGINT 处理
            try:
                signal.signal(signal.SIGINT, original_handler)
            except (OSError, ValueError):
                pass

        result.elapsed = time.time() - start_ts

        # 完成回调
        if self._on_complete:
            try:
                self._on_complete(result)
            except Exception:
                pass

        return result


# ─────────────────────────────────────────────────────────────────
# 便捷函数
# ─────────────────────────────────────────────────────────────────

def wait_for_team(
    dag,
    mailbox,
    coordinator_name: str,
    team_id: str,
    timeout: float = 600,
    poll_interval: float = 5.0,
    verbose: bool = True,
) -> WaitResult:
    """
    便捷等待函数（适合在工作流引擎中直接调用）。

    示例：
        result = wait_for_team(dag, mailbox, "coordinator", "run-001", timeout=300)
        if result.status == "completed":
            print("✅ 14步工作流全部完成")
    """
    def _progress(r: WaitResult):
        if verbose:
            print(f"⏳ [{r.elapsed:.0f}s] {r.completed}/{r.total} 完成 "
                  f"({r.progress_pct}%) | 进行中:{r.in_progress} 等待:{r.pending} 阻塞:{r.blocked}")

    def _dead(name: str, recovered: list[str]):
        if verbose:
            print(f"⚠️ 死亡龙虾: {name}，恢复任务: {recovered}")

    waiter = LobsterTaskWaiter(
        dag=dag,
        mailbox=mailbox,
        coordinator_name=coordinator_name,
        team_id=team_id,
        poll_interval=poll_interval,
        timeout=timeout,
        on_progress=_progress,
        on_dead_lobster=_dead,
    )
    return waiter.wait()
