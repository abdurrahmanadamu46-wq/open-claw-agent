#!/usr/bin/env python
"""
run_smoke_suite.py
==================
一键跑所有核心验收测试（_inprocess 系列）。

用法：
  cd dragon-senate-saas-v2
  python scripts/run_smoke_suite.py            # 跑全套
  python scripts/run_smoke_suite.py --fast      # 只跑 P0 核心集
  python scripts/run_smoke_suite.py --tag p0    # 按 tag 过滤

退出码：
  0 → 全部通过
  1 → 有失败（见 summary）

输出格式：
  每个 case 一行，PASS / FAIL / SKIP，最后打印汇总表。
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT_DIR / "scripts"

# ─────────────────────────────────────────────────────────────────────────────
# Test registry
# Each entry: (script_name, tags, description)
# Tags: p0 = must-pass before demo, p1 = important but not blocking
# ─────────────────────────────────────────────────────────────────────────────
SUITE: list[tuple[str, list[str], str]] = [
    # P0 核心：运行时基线
    ("test_workflow_event_log_resume_inprocess.py",
     ["p0", "event-log"],
     "WorkflowEventLog 断点恢复：timeline / resume-point / can_resume"),

    ("test_edge_publish_heartbeat_inprocess.py",
     ["p0", "edge"],
     "边缘执行闭环：EdgeTaskBundle + HeartbeatMonitor + stalled 检测"),

    ("test_run_dragon_team_async_inprocess.py",
     ["p0", "dragon-team"],
     "龙虾团队异步 run：/run-dragon-team-async 端到端 mock-LLM"),

    ("test_industry_kb_dissect_ingest_inprocess.py",
     ["p0", "kb"],
     "行业知识库 dissect+ingest：质量门/摘要/向量写入"),

    # P0：media / visualizer
    ("test_media_post_pipeline_inprocess.py",
     ["p0", "media"],
     "媒体发布管线：视频附件 + OSS 占位 + edge 分发"),

    ("test_visualizer_industry_workflow_inprocess.py",
     ["p0", "visualizer"],
     "Visualizer 行业工作流：ComfyUI/LibTV mock + 场景路由"),

    # P1：扩展验收
    ("test_billing_commercialization_inprocess.py",
     ["p1", "billing"],
     "计费商业化：plan 限额 / token 消耗 / 升级门"),

    ("test_followup_deterministic_spawn_inprocess.py",
     ["p1", "followup"],
     "FollowUp 确定性子任务拆分：子 agent spawn / 并发上限"),

    ("test_campaign_graph_publish_gate_inprocess.py",
     ["p1", "campaign"],
     "Campaign Graph 发布审批门：HITL gate / 审批回调"),

    ("test_policy_bandit_template_ab_inprocess.py",
     ["p1", "bandit"],
     "Policy Bandit A/B：epsilon-greedy 策略 / 反馈更新"),

    ("test_kernel_chain_inprocess.py",
     ["p1", "kernel"],
     "Kernel 链路：指标采集 / 报告持久化 / 回滚 HITL"),

    ("test_m1_auth_jwt_inprocess.py",
     ["p1", "auth"],
     "M1 JWT 鉴权：token 签发 / 校验 / 权限守卫"),
]


@dataclass
class TestResult:
    name: str
    tags: list[str]
    desc: str
    status: str  # PASS | FAIL | SKIP | ERROR
    duration_sec: float = 0.0
    output: str = ""
    error: str = ""


def run_one(script: str, timeout_sec: int = 120) -> tuple[int, str, str]:
    """Run a single test script and return (returncode, stdout, stderr)."""
    script_path = SCRIPTS_DIR / script
    if not script_path.exists():
        return -1, "", f"script not found: {script_path}"

    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "LLM_MOCK_FORCE": "true"}
    proc = subprocess.run(
        [sys.executable, str(script_path)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout_sec,
        env=env,
        cwd=str(ROOT_DIR),
    )
    return proc.returncode, proc.stdout, proc.stderr


def main() -> int:
    parser = argparse.ArgumentParser(description="Dragon Senate smoke suite runner")
    parser.add_argument("--fast", action="store_true", help="Only run p0-tagged tests")
    parser.add_argument("--tag", default="", help="Only run tests with this tag (e.g. p0, edge, billing)")
    parser.add_argument("--timeout", type=int, default=120, help="Per-test timeout seconds (default 120)")
    parser.add_argument("--verbose", "-v", action="store_true", help="Print test output even on PASS")
    args = parser.parse_args()

    # Filter suite
    active_tag = args.tag or ("p0" if args.fast else "")
    suite = [
        (name, tags, desc)
        for name, tags, desc in SUITE
        if not active_tag or active_tag in tags
    ]

    if not suite:
        print(f"[smoke] No tests matched tag='{active_tag}'")
        return 0

    print(f"\n{'=' * 70}")
    print(f"  Dragon Senate Smoke Suite  ({len(suite)} tests, tag={active_tag or 'all'})")
    print(f"{'=' * 70}\n")

    results: list[TestResult] = []
    for name, tags, desc in suite:
        print(f"  RUN  {name}")
        t0 = time.monotonic()
        try:
            rc, stdout, stderr = run_one(name, timeout_sec=args.timeout)
        except subprocess.TimeoutExpired:
            elapsed = time.monotonic() - t0
            result = TestResult(name=name, tags=tags, desc=desc,
                                status="FAIL", duration_sec=elapsed,
                                error=f"TIMEOUT after {args.timeout}s")
            results.append(result)
            print(f"  FAIL {name}  [{elapsed:.1f}s]  TIMEOUT\n")
            continue
        except Exception as exc:
            elapsed = time.monotonic() - t0
            result = TestResult(name=name, tags=tags, desc=desc,
                                status="ERROR", duration_sec=elapsed,
                                error=str(exc))
            results.append(result)
            print(f"  ERROR {name}  [{elapsed:.1f}s]  {exc}\n")
            continue

        elapsed = time.monotonic() - t0
        if rc == -1:
            status = "SKIP"
        elif rc == 0:
            status = "PASS"
        else:
            status = "FAIL"

        result = TestResult(name=name, tags=tags, desc=desc,
                            status=status, duration_sec=elapsed,
                            output=stdout, error=stderr)
        results.append(result)

        badge = {"PASS": "PASS", "FAIL": "FAIL", "SKIP": "SKIP"}.get(status, status)
        print(f"  {badge:<5} {name}  [{elapsed:.1f}s]")

        if status == "FAIL" or args.verbose:
            if stdout.strip():
                for line in stdout.strip().splitlines()[-20:]:
                    print(f"         {line}")
            if stderr.strip():
                for line in stderr.strip().splitlines()[-10:]:
                    print(f"    ERR  {line}")
        print()

    # ── Summary ──────────────────────────────────────────────────────────────
    passed = [r for r in results if r.status == "PASS"]
    failed = [r for r in results if r.status in {"FAIL", "ERROR"}]
    skipped = [r for r in results if r.status == "SKIP"]
    total_sec = sum(r.duration_sec for r in results)

    print(f"{'=' * 70}")
    print(f"  Results:  {len(passed)} PASS  {len(failed)} FAIL  {len(skipped)} SKIP  "
          f"| Total {total_sec:.1f}s")
    print(f"{'=' * 70}")

    if failed:
        print("\n  Failed tests:")
        for r in failed:
            print(f"    - {r.name}")
            if r.error:
                print(f"      {r.error[:200]}")
        print()

    if not failed:
        print("\n  All smoke tests passed.\n")
        return 0
    else:
        print(f"\n  {len(failed)} test(s) failed — see output above.\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
