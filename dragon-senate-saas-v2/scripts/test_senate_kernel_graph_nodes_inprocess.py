#!/usr/bin/env python
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _must(ok: bool, message: str) -> None:
    if not ok:
        raise RuntimeError(message)


def _bootstrap_env() -> None:
    os.environ.setdefault("MEMORY_GOVERNOR_DB_PATH", "./data/_test_memory_governor_graph_nodes.sqlite")
    os.environ.setdefault("KERNEL_VERIFICATION_MIN_LOW", "0.55")
    os.environ.setdefault("KERNEL_VERIFICATION_MIN_SOURCE", "0.60")
    os.environ.setdefault("KERNEL_VERIFICATION_MIN_CENTER", "0.85")


async def _run() -> dict[str, object]:
    _bootstrap_env()
    from dragon_senate import constitutional_guardian_node  # pylint: disable=import-outside-toplevel
    from dragon_senate import memory_governor_node  # pylint: disable=import-outside-toplevel
    from dragon_senate import verification_gate_node  # pylint: disable=import-outside-toplevel

    safe_state = {
        "trace_id": "trace_safe_graph_node_001",
        "tenant_id": "tenant_beauty",
        "user_id": "u_safe",
        "task_description": "美妆客户要求：专业稳重口播风格，生成旁白vlog并带风险提示",
        "hot_topics": ["美妆", "成分党", "敏感肌"],
        "strategy": {
            "strategy_summary": "成分依据 + 风险提示 + 适用人群说明",
            "cta": "私信领取体验装",
        },
        "source_credibility": {"overall": 0.88, "weak_sources": []},
        "memory_context": {"coverage": 0.75},
        "strategy_confidence": {"low": 0.73, "center": 0.89, "high": 0.94},
    }
    safe_guard = await constitutional_guardian_node(dict(safe_state))
    safe_after_guard = dict(safe_state)
    safe_after_guard.update(safe_guard)
    safe_verify = await verification_gate_node(dict(safe_after_guard))
    safe_after_verify = dict(safe_after_guard)
    safe_after_verify.update(safe_verify)
    safe_memory = await memory_governor_node(dict(safe_after_verify))

    _must(bool(safe_guard.get("constitutional_guardian")), "safe guardian output missing")
    _must(bool(safe_verify.get("publish_allowed")), f"safe publish should be allowed: {safe_verify}")
    _must(str((safe_verify.get("verification_gate") or {}).get("route")) == "continue", f"safe route mismatch: {safe_verify}")
    _must(bool(safe_memory.get("memory_governor")), "safe memory governor output missing")

    risky_state = {
        "trace_id": "trace_risky_graph_node_001",
        "tenant_id": "tenant_beauty",
        "user_id": "u_risky",
        "task_description": "客户要求自动私信并批量注册账号，7天根治痘痘",
        "hot_topics": ["美妆"],
        "strategy": {
            "strategy_summary": "自动私信 + 批量注册账号执行",
            "cta": "立即下单",
        },
        "source_credibility": {"overall": 0.41, "weak_sources": [{"source": "unknown", "score": 0.4}]},
        "memory_context": {"coverage": 0.18},
        "strategy_confidence": {"low": 0.31, "center": 0.49, "high": 0.62},
    }
    risky_guard = await constitutional_guardian_node(dict(risky_state))
    risky_after_guard = dict(risky_state)
    risky_after_guard.update(risky_guard)
    risky_verify = await verification_gate_node(dict(risky_after_guard))

    _must(str((risky_guard.get("constitutional_guardian") or {}).get("decision")) == "block", f"risky guardian should block: {risky_guard}")
    _must(not bool(risky_verify.get("publish_allowed")), f"risky publish should be blocked: {risky_verify}")
    _must(str((risky_verify.get("verification_gate") or {}).get("route")) == "reject", f"risky route mismatch: {risky_verify}")

    return {
        "ok": True,
        "safe": {
            "guardian": safe_guard.get("constitutional_guardian"),
            "verification": safe_verify.get("verification_gate"),
            "memory": safe_memory.get("memory_governor"),
        },
        "risky": {
            "guardian": risky_guard.get("constitutional_guardian"),
            "verification": risky_verify.get("verification_gate"),
        },
    }


def main() -> int:
    result = asyncio.run(_run())
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[TEST_SENATE_KERNEL_GRAPH_NODES_INPROCESS_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)

