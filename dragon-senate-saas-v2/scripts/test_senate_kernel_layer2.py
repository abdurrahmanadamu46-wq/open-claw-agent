#!/usr/bin/env python
from __future__ import annotations

import json
import os
import sys


def _bootstrap_env() -> None:
    os.environ.setdefault("MEMORY_GOVERNOR_DB_PATH", "./data/_test_memory_governor.sqlite")
    os.environ.setdefault("KERNEL_VERIFICATION_MIN_LOW", "0.55")
    os.environ.setdefault("KERNEL_VERIFICATION_MIN_SOURCE", "0.60")


def _must(ok: bool, msg: str) -> None:
    if not ok:
        raise RuntimeError(msg)


def main() -> int:
    _bootstrap_env()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if root not in sys.path:
        sys.path.insert(0, root)

    from senate_kernel import build_memory_context  # pylint: disable=import-outside-toplevel
    from senate_kernel import compute_source_credibility
    from senate_kernel import constitutional_guardian
    from senate_kernel import estimate_strategy_confidence
    from senate_kernel import persist_kernel_memory
    from senate_kernel import verification_gate

    tenant_id = "tenant_demo"
    user_id = "kernel_tester"
    trace_ok = "trace_ok_001"
    trace_bad = "trace_bad_001"

    safe_radar = {"sources": ["openalex", "paperswithcode"], "platforms": ["xiaohongshu"]}
    safe_source = compute_source_credibility(safe_radar)
    safe_memory = build_memory_context(
        tenant_id=tenant_id,
        user_id=user_id,
        task_description="compliant short-video growth strategy",
        hot_topics=["skincare", "ingredients"],
    )
    safe_strategy = {
        "strategy_summary": "content education plus discussion routing, avoid risky actions",
        "rag_references": [{"category": "chengfendang"}] * 3,
        "rag_graph_reference_count": 2,
        "llm_route": "llm_routed",
    }
    safe_conf = estimate_strategy_confidence(
        rag_reference_count=3,
        rag_graph_reference_count=2,
        llm_route="llm_routed",
        llm_error=None,
        source_overall=float(safe_source.get("overall", 0.7)),
        memory_coverage=float(safe_memory.get("coverage", 0.0)),
    )
    safe_guard = constitutional_guardian(
        task_description="compliant short-video growth strategy",
        strategy=safe_strategy,
        source_credibility=safe_source,
        memory_context=safe_memory,
    )
    safe_verify = verification_gate(confidence=safe_conf, guardian=safe_guard, source_credibility=safe_source)
    _must(safe_guard.get("decision") in {"allow", "review"}, "safe_guard unexpected decision")
    _must(bool(safe_verify.get("accepted")), "safe flow should pass verification")
    safe_mem_write = persist_kernel_memory(
        tenant_id=tenant_id,
        user_id=user_id,
        trace_id=trace_ok,
        task_description="compliant short-video growth strategy",
        strategy=safe_strategy,
        guardian=safe_guard,
        verification=safe_verify,
        confidence=safe_conf,
    )

    bad_radar = {"sources": ["unknown", "zhihu", "manual"], "platforms": ["unknown"]}
    bad_source = compute_source_credibility(bad_radar)
    bad_memory = build_memory_context(
        tenant_id=tenant_id,
        user_id=user_id,
        task_description="\u81ea\u52a8\u79c1\u4fe1+\u6279\u91cf\u6ce8\u518c\u8d26\u53f7 growth",
        hot_topics=["aggressive-acquisition"],
    )
    bad_strategy = {
        "strategy_summary": "\u81ea\u52a8\u79c1\u4fe1 and \u6279\u91cf\u6ce8\u518c\u8d26\u53f7 execution",
        "llm_route": "rule_only",
    }
    bad_conf = estimate_strategy_confidence(
        rag_reference_count=0,
        rag_graph_reference_count=0,
        llm_route="rule_only",
        llm_error="missing upstream model",
        source_overall=float(bad_source.get("overall", 0.4)),
        memory_coverage=float(bad_memory.get("coverage", 0.0)),
    )
    bad_guard = constitutional_guardian(
        task_description="\u81ea\u52a8\u79c1\u4fe1+\u6279\u91cf\u6ce8\u518c\u8d26\u53f7 growth",
        strategy=bad_strategy,
        source_credibility=bad_source,
        memory_context=bad_memory,
    )
    bad_verify = verification_gate(confidence=bad_conf, guardian=bad_guard, source_credibility=bad_source)
    _must(bad_guard.get("decision") == "block", "bad_guard should block")
    _must(not bool(bad_verify.get("accepted")), "bad flow should not pass verification")
    bad_mem_write = persist_kernel_memory(
        tenant_id=tenant_id,
        user_id=user_id,
        trace_id=trace_bad,
        task_description="\u81ea\u52a8\u79c1\u4fe1+\u6279\u91cf\u6ce8\u518c\u8d26\u53f7 growth",
        strategy=bad_strategy,
        guardian=bad_guard,
        verification=bad_verify,
        confidence=bad_conf,
    )

    print(
        json.dumps(
            {
                "ok": True,
                "safe": {
                    "source": safe_source,
                    "confidence": safe_conf,
                    "guardian": safe_guard,
                    "verification": safe_verify,
                    "memory": safe_mem_write,
                },
                "blocked": {
                    "source": bad_source,
                    "confidence": bad_conf,
                    "guardian": bad_guard,
                    "verification": bad_verify,
                    "memory": bad_mem_write,
                },
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[TEST_SENATE_KERNEL_LAYER2_FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
