#!/usr/bin/env python
"""
test_workflow_event_log_resume_inprocess.py
==========================================
验收标准：
  1. async 任务能在事件日志里完整回放（workflow_started → step_started → step_completed → workflow_completed）
  2. 故意制造一次 step_failed 后，能从日志判断卡在哪一步
  3. get_resume_point() 返回正确的下一步 index
  4. can_resume() 正确识别可恢复 vs 不可恢复的状态

运行方式：
  cd dragon-senate-saas-v2
  python scripts/test_workflow_event_log_resume_inprocess.py
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))


def _must(ok: bool, message: str) -> None:
    if not ok:
        print(f"  FAIL: {message}", flush=True)
        raise RuntimeError(message)


def _ok(message: str) -> None:
    print(f"  ✓ {message}", flush=True)


def main() -> int:
    import os
    import tempfile

    temp_dir = Path(tempfile.mkdtemp(prefix="wf_event_log_"))
    db_path = str(temp_dir / "workflow_events_test.sqlite")
    os.environ["WORKFLOW_EVENT_LOG_DB"] = db_path

    # Import after setting env vars
    from workflow_event_log import WorkflowEventLog, WorkflowEventType, WorkflowRunStatus

    log = WorkflowEventLog(db_path=db_path)
    print("\n=== WorkflowEventLog 断点恢复验收测试 ===\n")

    # ── Case 1: 正常完成流程 ────────────────────────────────────────────────
    print("Case 1: 正常完成流程 (5步全部完成)")
    run_id_ok = "test-run-ok-001"
    log.workflow_started(run_id_ok, "content-campaign-14step", tenant_id="t1",
                         version="2.1", meta={"scenario": "hotel"})

    for i in range(5):
        step_name = ["radar", "strategist", "inkwriter", "visualizer", "dispatcher"][i]
        log.step_scheduled(run_id_ok, i, step_name, f"skill_{step_name}")
        log.step_started(run_id_ok, i, step_name)
        log.step_completed(run_id_ok, i, output_summary=f"{step_name}产出完成", tokens_used=500)
        _ok(f"step {i} ({step_name}) 完成")

    log.workflow_completed(run_id_ok, tenant_id="t1", output_summary="5步全部完成，artifact_count=5")

    # 验证时间线
    timeline = log.get_timeline(run_id_ok)
    _must(len(timeline) > 0, "timeline 不能为空")
    event_types = [e["event_type"] for e in timeline]
    _must("workflow_started" in event_types, "timeline 缺少 workflow_started 事件")
    _must("step_completed" in event_types, "timeline 缺少 step_completed 事件")
    _must("workflow_completed" in event_types, "timeline 缺少 workflow_completed 事件")
    _ok(f"timeline 完整，共 {len(timeline)} 个事件")

    # 验证 can_resume（已完成的不可恢复）
    _must(not log.can_resume(run_id_ok), "已完成的工作流不应可恢复")
    _ok("can_resume(completed) = False ✓")

    # ── Case 2: 步骤失败 → 断点恢复 ─────────────────────────────────────────
    print("\nCase 2: 步骤3 失败 → 断点恢复验证")
    run_id_fail = "test-run-fail-002"
    log.workflow_started(run_id_fail, "content-campaign-14step", tenant_id="t1",
                         version="2.1", meta={"scenario": "local_service"})

    # 步骤 0, 1, 2 成功
    for i in range(3):
        step_name = ["radar", "strategist", "inkwriter"][i]
        log.step_scheduled(run_id_fail, i, step_name, f"skill_{step_name}")
        log.step_started(run_id_fail, i, step_name)
        log.step_completed(run_id_fail, i, output_summary=f"{step_name}完成", tokens_used=400)

    # 步骤 3 (visualizer) 失败
    log.step_scheduled(run_id_fail, 3, "visualizer", "skill_visualizer")
    log.step_started(run_id_fail, 3, "visualizer")
    log.step_failed(run_id_fail, 3, step_name="visualizer",
                    error_message="visualizer LLM timeout after 300s")
    _ok("step 3 (visualizer) 已记录为 failed")

    # 验证能定位失败步骤
    failed_step = log.get_failed_step(run_id_fail)
    _must(failed_step is not None, "get_failed_step() 不应返回 None")
    _must(int(failed_step.get("step_index", -1)) == 3, f"失败步骤应为3，实际为 {failed_step.get('step_index')}")
    _ok(f"get_failed_step() 正确定位到步骤 {failed_step['step_index']} ({failed_step.get('step_name', '')})")

    # 验证断点恢复点
    resume = log.get_resume_point(run_id_fail)
    _must(resume is not None, "get_resume_point() 不应返回 None")
    _must(resume.next_step_index == 3, f"下一步应从3继续，实际为 {resume.next_step_index}")
    _must(resume.last_completed_step == 2, f"最后完成步骤应为2，实际为 {resume.last_completed_step}")
    _ok(f"get_resume_point() 返回正确：next_step={resume.next_step_index}, last_completed={resume.last_completed_step}")

    # 验证 can_resume
    _must(log.can_resume(run_id_fail), "失败但未完成的工作流应可恢复")
    _ok("can_resume(failed but not completed) = True ✓")

    # ── Case 3: list_recent_runs ────────────────────────────────────────────
    print("\nCase 3: list_recent_runs()")
    runs = log.list_recent_runs(limit=10)
    _must(len(runs) >= 2, f"应有至少2条运行记录，实际 {len(runs)}")
    run_ids_in_list = [r["run_id"] for r in runs]
    _must(run_id_ok in run_ids_in_list, f"{run_id_ok} 不在 list_recent_runs 结果中")
    _must(run_id_fail in run_ids_in_list, f"{run_id_fail} 不在 list_recent_runs 结果中")
    _ok(f"list_recent_runs() 返回 {len(runs)} 条记录，两个测试 run 均已存在")

    print("\n✅ 所有 WorkflowEventLog 断点恢复验收测试通过\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
