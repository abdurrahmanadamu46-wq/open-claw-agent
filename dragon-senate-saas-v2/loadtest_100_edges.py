from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import random
import statistics
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx


DM_SAMPLES = [
    "你好，怎么买？多少钱？",
    "Can I order now? Send price please.",
    "这个有优惠吗？怎么下单？",
    "I need details, is this available today?",
]

TASK_TEMPLATES = [
    "调研热点并生成高转化短视频内容包",
    "分析竞品并产出图文与视频脚本后分发边缘执行",
    "围绕价格咨询高意向人群输出夜间投放策略",
]


@dataclass
class EndpointStats:
    total: int = 0
    success: int = 0
    failed: int = 0
    latencies_ms: list[float] = field(default_factory=list)

    def record(self, latency_ms: float, ok: bool) -> None:
        self.total += 1
        if ok:
            self.success += 1
        else:
            self.failed += 1
        self.latencies_ms.append(latency_ms)

    def summary(self) -> dict[str, Any]:
        if not self.latencies_ms:
            return {
                "total": self.total,
                "success": self.success,
                "failed": self.failed,
                "success_rate": 0.0,
                "p50_ms": 0.0,
                "p95_ms": 0.0,
                "avg_ms": 0.0,
            }
        lat = sorted(self.latencies_ms)
        p50 = lat[min(len(lat) - 1, int(math.floor(0.50 * (len(lat) - 1))))]
        p95 = lat[min(len(lat) - 1, int(math.floor(0.95 * (len(lat) - 1))))]
        return {
            "total": self.total,
            "success": self.success,
            "failed": self.failed,
            "success_rate": round(self.success / max(1, self.total), 4),
            "p50_ms": round(p50, 2),
            "p95_ms": round(p95, 2),
            "avg_ms": round(statistics.fmean(self.latencies_ms), 2),
        }


@dataclass
class LoadMetrics:
    edge_pull: EndpointStats = field(default_factory=EndpointStats)
    dm_forward: EndpointStats = field(default_factory=EndpointStats)
    run_dragon_team: EndpointStats = field(default_factory=EndpointStats)
    edge_register: EndpointStats = field(default_factory=EndpointStats)
    package_pulled_total: int = 0
    dm_sent_total: int = 0
    scenario_started_at: float = 0.0
    scenario_finished_at: float = 0.0

    def duration_sec(self) -> float:
        if self.scenario_finished_at <= self.scenario_started_at:
            return 0.0
        return self.scenario_finished_at - self.scenario_started_at

    def throughput_summary(self) -> dict[str, Any]:
        duration = max(1e-6, self.duration_sec())
        total_http = (
            self.edge_pull.total
            + self.dm_forward.total
            + self.run_dragon_team.total
            + self.edge_register.total
        )
        return {
            "duration_sec": round(duration, 3),
            "http_rps": round(total_http / duration, 3),
            "dm_rps": round(self.dm_sent_total / duration, 3),
            "package_pull_rps": round(self.package_pulled_total / duration, 3),
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Liaoyuan 100-edge load test")
    parser.add_argument("--base_url", default="http://127.0.0.1:8000")
    parser.add_argument("--username", default="admin")
    parser.add_argument("--password", default="change_me")
    parser.add_argument("--user_id", default="admin")
    parser.add_argument("--edge_secret", default=os.getenv("EDGE_SHARED_SECRET", ""))
    parser.add_argument("--edge_count", type=int, default=100)
    parser.add_argument("--duration_sec", type=int, default=180)
    parser.add_argument("--poll_interval_sec", type=float, default=2.0)
    parser.add_argument("--dm_probability", type=float, default=0.35)
    parser.add_argument("--task_interval_sec", type=float, default=20.0)
    parser.add_argument("--task_batch_size", type=int, default=25)
    parser.add_argument("--request_timeout_sec", type=float, default=25.0)
    parser.add_argument("--concurrency_limit", type=int, default=200)
    parser.add_argument("--report_json", default="loadtest_report.json")
    return parser.parse_args()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def timed_request(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    json_body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    params: dict[str, Any] | None = None,
) -> tuple[bool, float, httpx.Response | None]:
    started = time.perf_counter()
    try:
        response = await client.request(method, url, json=json_body, headers=headers, params=params)
        ok = response.status_code < 400
        latency = (time.perf_counter() - started) * 1000
        return ok, latency, response
    except Exception:
        latency = (time.perf_counter() - started) * 1000
        return False, latency, None


async def login(client: httpx.AsyncClient, base_url: str, username: str, password: str) -> str:
    ok, _, resp = await timed_request(
        client,
        "POST",
        f"{base_url}/auth/login",
        json_body={"username": username, "password": password},
    )
    if not ok or resp is None:
        raise RuntimeError("login failed")
    data = resp.json()
    token = str(data.get("access_token", "")).strip()
    if not token:
        raise RuntimeError("login returned empty access_token")
    return token


async def get_llm_metrics(client: httpx.AsyncClient, base_url: str, token: str, reset: bool = False) -> dict[str, Any]:
    ok, _, resp = await timed_request(
        client,
        "GET",
        f"{base_url}/llm/router/metrics",
        headers={"Authorization": f"Bearer {token}"},
        params={"reset": "true" if reset else "false"},
    )
    if not ok or resp is None:
        raise RuntimeError("failed to fetch llm router metrics")
    body = resp.json()
    return body.get("metrics", {})


async def register_edge(
    client: httpx.AsyncClient,
    base_url: str,
    token: str,
    user_id: str,
    edge_id: str,
    account_id: str,
    stats: LoadMetrics,
) -> None:
    ok, latency, _ = await timed_request(
        client,
        "POST",
        f"{base_url}/edge/register",
        headers={"Authorization": f"Bearer {token}"},
        json_body={
            "edge_id": edge_id,
            "user_id": user_id,
            "account_id": account_id,
            "webhook_url": None,
        },
    )
    stats.edge_register.record(latency, ok)


async def edge_loop(
    *,
    client: httpx.AsyncClient,
    base_url: str,
    edge_secret: str,
    edge_id: str,
    account_id: str,
    duration_sec: float,
    poll_interval_sec: float,
    dm_probability: float,
    stats: LoadMetrics,
    limiter: asyncio.Semaphore,
) -> None:
    deadline = time.monotonic() + duration_sec
    headers = {"x-edge-secret": edge_secret}
    while time.monotonic() < deadline:
        async with limiter:
            ok_pull, latency_pull, resp_pull = await timed_request(
                client,
                "GET",
                f"{base_url}/edge/pull/{edge_id}",
                headers=headers,
                params={"limit": 5},
            )
        stats.edge_pull.record(latency_pull, ok_pull)
        if ok_pull and resp_pull is not None:
            try:
                packages = int(resp_pull.json().get("count", 0) or 0)
                stats.package_pulled_total += max(0, packages)
            except Exception:
                pass

        if random.random() < dm_probability:
            dm_text = random.choice(DM_SAMPLES)
            async with limiter:
                ok_dm, latency_dm, _ = await timed_request(
                    client,
                    "POST",
                    f"{base_url}/receive_dm_from_edge",
                    headers={**headers, "Content-Type": "application/json"},
                    json_body={
                        "edge_id": edge_id,
                        "dm_text": dm_text,
                        "account_id": account_id,
                    },
                )
            stats.dm_forward.record(latency_dm, ok_dm)
            stats.dm_sent_total += 1

        await asyncio.sleep(poll_interval_sec)


def build_edge_targets(user_id: str, edge_count: int) -> list[dict[str, Any]]:
    targets: list[dict[str, Any]] = []
    for idx in range(1, edge_count + 1):
        edge_id = f"edge-load-{idx:03d}"
        account_id = f"{user_id}-load-acct-{idx:03d}"
        targets.append(
            {
                "edge_id": edge_id,
                "account_id": account_id,
                "webhook_url": None,
                "instruction_hint": "loadtest",
            }
        )
    return targets


async def task_driver(
    *,
    client: httpx.AsyncClient,
    base_url: str,
    token: str,
    user_id: str,
    edge_targets: list[dict[str, Any]],
    duration_sec: float,
    task_interval_sec: float,
    task_batch_size: int,
    stats: LoadMetrics,
    limiter: asyncio.Semaphore,
) -> None:
    deadline = time.monotonic() + duration_sec
    cursor = 0
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    total = len(edge_targets)
    while time.monotonic() < deadline:
        batch: list[dict[str, Any]] = []
        for _ in range(max(1, task_batch_size)):
            batch.append(edge_targets[cursor % total])
            cursor += 1
        payload = {
            "task_description": random.choice(TASK_TEMPLATES),
            "user_id": user_id,
            "competitor_handles": ["bench_a", "bench_b"],
            "edge_targets": batch,
        }
        async with limiter:
            ok, latency, _ = await timed_request(
                client,
                "POST",
                f"{base_url}/run-dragon-team",
                headers=headers,
                json_body=payload,
            )
        stats.run_dragon_team.record(latency, ok)
        await asyncio.sleep(task_interval_sec)


def metric_delta(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    delta: dict[str, Any] = {}
    keys = set(before.keys()) | set(after.keys())
    for key in keys:
        if key == "pricing":
            continue
        bv = before.get(key)
        av = after.get(key)
        if isinstance(bv, (int, float)) and isinstance(av, (int, float)):
            delta[key] = av - bv
    pricing = after.get("pricing", {})
    cloud_in = int(delta.get("prompt_tokens_cloud", 0) or 0)
    cloud_out = int(delta.get("completion_tokens_cloud", 0) or 0)
    input_price = float(pricing.get("cloud_input_price_per_mtok", 0) or 0)
    output_price = float(pricing.get("cloud_output_price_per_mtok", 0) or 0)
    cost = (cloud_in / 1_000_000) * input_price + (cloud_out / 1_000_000) * output_price
    delta["pricing"] = {
        "cloud_input_price_per_mtok": input_price,
        "cloud_output_price_per_mtok": output_price,
        "estimated_cloud_cost_cny": round(cost, 6),
    }
    return delta


async def run_loadtest(args: argparse.Namespace) -> dict[str, Any]:
    random.seed(42)
    timeout = httpx.Timeout(args.request_timeout_sec)
    limits = httpx.Limits(max_keepalive_connections=args.concurrency_limit, max_connections=args.concurrency_limit)
    stats = LoadMetrics()
    limiter = asyncio.Semaphore(args.concurrency_limit)

    async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
        token = await login(client, args.base_url, args.username, args.password)
        llm_before = await get_llm_metrics(client, args.base_url, token, reset=True)

        edge_targets = build_edge_targets(args.user_id, args.edge_count)
        register_tasks = [
            register_edge(
                client=client,
                base_url=args.base_url,
                token=token,
                user_id=args.user_id,
                edge_id=target["edge_id"],
                account_id=target["account_id"],
                stats=stats,
            )
            for target in edge_targets
        ]
        await asyncio.gather(*register_tasks)

        stats.scenario_started_at = time.perf_counter()

        edge_tasks = [
            edge_loop(
                client=client,
                base_url=args.base_url,
                edge_secret=args.edge_secret,
                edge_id=target["edge_id"],
                account_id=target["account_id"],
                duration_sec=args.duration_sec,
                poll_interval_sec=args.poll_interval_sec,
                dm_probability=args.dm_probability,
                stats=stats,
                limiter=limiter,
            )
            for target in edge_targets
        ]
        driver_task = task_driver(
            client=client,
            base_url=args.base_url,
            token=token,
            user_id=args.user_id,
            edge_targets=edge_targets,
            duration_sec=args.duration_sec,
            task_interval_sec=args.task_interval_sec,
            task_batch_size=args.task_batch_size,
            stats=stats,
            limiter=limiter,
        )
        await asyncio.gather(*edge_tasks, driver_task)

        stats.scenario_finished_at = time.perf_counter()
        llm_after = await get_llm_metrics(client, args.base_url, token, reset=False)

    llm_delta = metric_delta(llm_before, llm_after)
    report = {
        "meta": {
            "generated_at": now_iso(),
            "base_url": args.base_url,
            "edge_count": args.edge_count,
            "duration_sec": args.duration_sec,
            "poll_interval_sec": args.poll_interval_sec,
            "dm_probability": args.dm_probability,
            "task_interval_sec": args.task_interval_sec,
            "task_batch_size": args.task_batch_size,
        },
        "throughput": stats.throughput_summary(),
        "endpoints": {
            "edge_register": stats.edge_register.summary(),
            "edge_pull": stats.edge_pull.summary(),
            "dm_forward": stats.dm_forward.summary(),
            "run_dragon_team": stats.run_dragon_team.summary(),
        },
        "volume": {
            "package_pulled_total": stats.package_pulled_total,
            "dm_sent_total": stats.dm_sent_total,
        },
        "llm_router": {
            "before": llm_before,
            "after": llm_after,
            "delta": llm_delta,
        },
    }
    return report


def print_report(report: dict[str, Any]) -> None:
    tp = report["throughput"]
    ep = report["endpoints"]
    llm = report["llm_router"]["delta"]
    pricing = llm.get("pricing", {})
    print("\n========== Load Test Summary ==========")
    print(f"Generated At: {report['meta']['generated_at']}")
    print(f"Duration(s): {tp['duration_sec']}")
    print(f"HTTP RPS: {tp['http_rps']} | DM RPS: {tp['dm_rps']} | Pull RPS: {tp['package_pull_rps']}")
    print("\n--- Endpoint Success ---")
    for name in ["edge_register", "edge_pull", "dm_forward", "run_dragon_team"]:
        item = ep[name]
        print(
            f"{name}: total={item['total']} success={item['success']} "
            f"fail={item['failed']} p50={item['p50_ms']}ms p95={item['p95_ms']}ms"
        )
    print("\n--- LLM Route Delta ---")
    print(
        f"calls_total={llm.get('calls_total', 0)} "
        f"primary_local={llm.get('calls_primary_local', 0)} "
        f"primary_cloud={llm.get('calls_primary_cloud', 0)} "
        f"success_local={llm.get('calls_success_local', 0)} "
        f"success_cloud={llm.get('calls_success_cloud', 0)}"
    )
    print(
        f"fallback_invoked={llm.get('fallback_invoked', 0)} "
        f"local->cloud={llm.get('fallback_local_to_cloud', 0)} "
        f"cloud->local={llm.get('fallback_cloud_to_local', 0)} "
        f"failed_total={llm.get('calls_failed_total', 0)}"
    )
    print(
        f"cloud_prompt_tokens={llm.get('prompt_tokens_cloud', 0)} "
        f"cloud_completion_tokens={llm.get('completion_tokens_cloud', 0)} "
        f"estimated_cloud_cost_cny={pricing.get('estimated_cloud_cost_cny', 0)}"
    )
    print("=======================================\n")


async def amain() -> None:
    args = parse_args()
    report = await run_loadtest(args)
    report_path = Path(args.report_json)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print_report(report)
    print(f"Report written: {report_path.resolve()}")


if __name__ == "__main__":
    asyncio.run(amain())

