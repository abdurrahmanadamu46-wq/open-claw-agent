"""
Experiment registry for lobster prompt/model evaluations.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sqlite3
import uuid
from dataclasses import asdict
from dataclasses import dataclass
from dataclasses import field
from datetime import datetime
from datetime import timezone
from pathlib import Path
from typing import Any

import httpx


logger = logging.getLogger("experiment_registry")
DEFAULT_EVAL_CONCURRENCY = max(1, int(os.getenv("EVAL_CONCURRENCY", "5")))

_DB_PATH = os.getenv("EXPERIMENT_REGISTRY_DB", "./data/experiment_registry.sqlite")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(slots=True)
class ExperimentResult:
    """One evaluated sample inside an experiment."""

    dataset_item_id: str = ""
    input: dict[str, Any] = field(default_factory=dict)
    output: str = ""
    scores: dict[str, Any] = field(default_factory=dict)
    tokens_used: int = 0
    latency_ms: int = 0
    cost_usd: float = 0.0
    error: str | None = None
    gen_id: str = ""
    context_snapshot: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class Experiment:
    """Experiment summary."""

    id: str
    name: str
    lobster_name: str
    prompt_name: str = ""
    prompt_version: str = ""
    model: str = ""
    dataset_id: str = ""
    tenant_id: str = "tenant_main"
    source: str = "manual"
    status: str = "running"
    metrics: list[str] = field(default_factory=list)
    config: dict[str, Any] = field(default_factory=dict)
    notes: str = ""
    avg_scores: dict[str, float] = field(default_factory=dict)
    total_items: int = 0
    completed_items: int = 0
    failed_items: int = 0
    avg_latency_ms: float = 0.0
    avg_tokens: float = 0.0
    total_cost_usd: float = 0.0
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)
    completed_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class ExperimentRegistry:
    """Persist and compare lobster experiments."""

    def __init__(self, db_path: str = _DB_PATH) -> None:
        self._db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _ensure_schema(self) -> None:
        conn = self._conn()
        try:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS experiments (
                    experiment_id    TEXT PRIMARY KEY,
                    name             TEXT NOT NULL,
                    lobster_name     TEXT NOT NULL,
                    prompt_name      TEXT DEFAULT '',
                    prompt_version   TEXT DEFAULT '',
                    model            TEXT DEFAULT '',
                    dataset_id       TEXT DEFAULT '',
                    tenant_id        TEXT NOT NULL DEFAULT 'tenant_main',
                    source           TEXT NOT NULL DEFAULT 'manual',
                    status           TEXT NOT NULL DEFAULT 'running',
                    metrics          TEXT DEFAULT '[]',
                    config           TEXT DEFAULT '{}',
                    notes            TEXT DEFAULT '',
                    avg_scores       TEXT DEFAULT '{}',
                    total_items      INTEGER DEFAULT 0,
                    completed_items  INTEGER DEFAULT 0,
                    failed_items     INTEGER DEFAULT 0,
                    avg_latency_ms   REAL DEFAULT 0.0,
                    avg_tokens       REAL DEFAULT 0.0,
                    total_cost_usd   REAL DEFAULT 0.0,
                    created_at       TEXT NOT NULL,
                    updated_at       TEXT NOT NULL,
                    completed_at     TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_exp_tenant_created
                    ON experiments(tenant_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_exp_lobster_created
                    ON experiments(lobster_name, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_exp_source_status
                    ON experiments(source, status, created_at DESC);

                CREATE TABLE IF NOT EXISTS experiment_results (
                    result_id         TEXT PRIMARY KEY,
                    experiment_id     TEXT NOT NULL,
                    dataset_item_id   TEXT DEFAULT '',
                    input_payload     TEXT DEFAULT '{}',
                    output_text       TEXT DEFAULT '',
                    scores            TEXT DEFAULT '{}',
                    tokens_used       INTEGER DEFAULT 0,
                    latency_ms        INTEGER DEFAULT 0,
                    cost_usd          REAL DEFAULT 0.0,
                    error             TEXT DEFAULT '',
                    gen_id            TEXT DEFAULT '',
                    context_snapshot  TEXT DEFAULT '{}',
                    created_at        TEXT NOT NULL,
                    FOREIGN KEY (experiment_id) REFERENCES experiments(experiment_id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_exp_result_exp_created
                    ON experiment_results(experiment_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_exp_result_gen
                    ON experiment_results(gen_id);
                """
            )
            conn.commit()
        finally:
            conn.close()

    @staticmethod
    def _loads(raw: str | None, default: Any) -> Any:
        if not raw:
            return default
        try:
            return json.loads(raw)
        except Exception:
            return default

    def _serialize_experiment_row(self, row: sqlite3.Row | None) -> dict[str, Any]:
        if row is None:
            return {}
        data = dict(row)
        data["id"] = data.get("experiment_id")
        data["metrics"] = self._loads(data.get("metrics"), [])
        data["config"] = self._loads(data.get("config"), {})
        data["avg_scores"] = self._loads(data.get("avg_scores"), {})
        return data

    def _serialize_result_row(self, row: sqlite3.Row) -> dict[str, Any]:
        data = dict(row)
        data["input"] = self._loads(data.pop("input_payload", "{}"), {})
        data["scores"] = self._loads(data.get("scores"), {})
        data["context_snapshot"] = self._loads(data.get("context_snapshot"), {})
        return data

    def create(
        self,
        *,
        name: str,
        lobster_name: str,
        prompt_name: str = "",
        prompt_version: str = "",
        model: str = "",
        dataset_id: str = "",
        tenant_id: str = "tenant_main",
        source: str = "manual",
        metrics: list[str] | None = None,
        config: dict[str, Any] | None = None,
        notes: str = "",
        status: str = "running",
    ) -> dict[str, Any]:
        experiment_id = f"exp_{uuid.uuid4().hex[:12]}"
        now = _now()
        payload = Experiment(
            id=experiment_id,
            name=name,
            lobster_name=lobster_name,
            prompt_name=prompt_name,
            prompt_version=prompt_version,
            model=model,
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            source=source,
            status=status,
            metrics=list(metrics or []),
            config=dict(config or {}),
            notes=notes,
            created_at=now,
            updated_at=now,
            completed_at=now if status == "completed" else None,
        )
        conn = self._conn()
        try:
            conn.execute(
                """
                INSERT INTO experiments (
                    experiment_id, name, lobster_name, prompt_name, prompt_version,
                    model, dataset_id, tenant_id, source, status, metrics, config, notes,
                    avg_scores, total_items, completed_items, failed_items,
                    avg_latency_ms, avg_tokens, total_cost_usd, created_at, updated_at, completed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload.id,
                    payload.name,
                    payload.lobster_name,
                    payload.prompt_name,
                    payload.prompt_version,
                    payload.model,
                    payload.dataset_id,
                    payload.tenant_id,
                    payload.source,
                    payload.status,
                    json.dumps(payload.metrics, ensure_ascii=False),
                    json.dumps(payload.config, ensure_ascii=False),
                    payload.notes,
                    json.dumps(payload.avg_scores, ensure_ascii=False),
                    payload.total_items,
                    payload.completed_items,
                    payload.failed_items,
                    payload.avg_latency_ms,
                    payload.avg_tokens,
                    payload.total_cost_usd,
                    payload.created_at,
                    payload.updated_at,
                    payload.completed_at,
                ),
            )
            conn.commit()
        finally:
            conn.close()
        result = payload.to_dict()
        result["experiment_id"] = result.get("id")
        return result

    def list_experiments(
        self,
        *,
        tenant_id: str = "tenant_main",
        lobster_name: str | None = None,
        source: str | None = None,
        status: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        query = "SELECT * FROM experiments WHERE tenant_id=?"
        params: list[Any] = [tenant_id]
        if lobster_name:
            query += " AND lobster_name=?"
            params.append(lobster_name)
        if source:
            query += " AND source=?"
            params.append(source)
        if status:
            query += " AND status=?"
            params.append(status)
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(max(1, min(int(limit), 200)))
        conn = self._conn()
        try:
            rows = conn.execute(query, params).fetchall()
            return [self._serialize_experiment_row(row) for row in rows]
        finally:
            conn.close()

    def get_experiment(self, experiment_id: str) -> dict[str, Any]:
        conn = self._conn()
        try:
            exp_row = conn.execute(
                "SELECT * FROM experiments WHERE experiment_id=?",
                (experiment_id,),
            ).fetchone()
            if exp_row is None:
                return {}
            result_rows = conn.execute(
                """
                SELECT * FROM experiment_results
                WHERE experiment_id=?
                ORDER BY created_at DESC
                """,
                (experiment_id,),
            ).fetchall()
            payload = self._serialize_experiment_row(exp_row)
            payload["results"] = [self._serialize_result_row(row) for row in result_rows]
            return payload
        finally:
            conn.close()

    def add_result(self, experiment_id: str, result: ExperimentResult) -> dict[str, Any]:
        conn = self._conn()
        try:
            conn.execute(
                """
                INSERT INTO experiment_results (
                    result_id, experiment_id, dataset_item_id, input_payload, output_text,
                    scores, tokens_used, latency_ms, cost_usd, error, gen_id,
                    context_snapshot, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"res_{uuid.uuid4().hex[:12]}",
                    experiment_id,
                    result.dataset_item_id,
                    json.dumps(result.input, ensure_ascii=False),
                    result.output[:20000],
                    json.dumps(result.scores, ensure_ascii=False),
                    int(result.tokens_used or 0),
                    int(result.latency_ms or 0),
                    float(result.cost_usd or 0.0),
                    str(result.error or ""),
                    result.gen_id,
                    json.dumps(result.context_snapshot, ensure_ascii=False),
                    result.created_at,
                ),
            )
            self._refresh_summary(conn, experiment_id)
            conn.commit()
            row = conn.execute(
                "SELECT * FROM experiments WHERE experiment_id=?",
                (experiment_id,),
            ).fetchone()
            return self._serialize_experiment_row(row)
        finally:
            conn.close()

    def complete(self, experiment_id: str, status: str = "completed") -> dict[str, Any]:
        conn = self._conn()
        try:
            self._refresh_summary(conn, experiment_id)
            now = _now()
            conn.execute(
                """
                UPDATE experiments
                SET status=?, updated_at=?, completed_at=?
                WHERE experiment_id=?
                """,
                (status, now, now if status == "completed" else None, experiment_id),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM experiments WHERE experiment_id=?",
                (experiment_id,),
            ).fetchone()
            return self._serialize_experiment_row(row)
        finally:
            conn.close()

    def update_status(self, experiment_id: str, status: str, *, completed: bool = False) -> dict[str, Any]:
        conn = self._conn()
        try:
            now = _now()
            conn.execute(
                """
                UPDATE experiments
                SET status=?, updated_at=?, completed_at=?
                WHERE experiment_id=?
                """,
                (status, now, now if completed else None, experiment_id),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM experiments WHERE experiment_id=?",
                (experiment_id,),
            ).fetchone()
            return self._serialize_experiment_row(row)
        finally:
            conn.close()

    async def run_experiment_evaluation(
        self,
        experiment_id: str,
        *,
        concurrency: int | None = None,
    ) -> dict[str, Any]:
        experiment = self.get_experiment(experiment_id)
        if not experiment:
            raise ValueError("experiment_not_found")
        from dataset_store import get_dataset_store

        dataset = get_dataset_store().get_dataset(str(experiment.get("dataset_id") or ""))
        items = dataset.get("items", []) if isinstance(dataset, dict) else []
        if not items:
            raise ValueError("dataset_items_not_found")

        metrics = [str(item).strip() for item in (experiment.get("metrics") or []) if str(item).strip()]
        cfg = experiment.get("config") if isinstance(experiment.get("config"), dict) else {}
        effective_concurrency = max(1, int(concurrency or cfg.get("concurrency") or DEFAULT_EVAL_CONCURRENCY))
        self.update_status(experiment_id, "running")
        semaphore = asyncio.Semaphore(effective_concurrency)

        logger.info(
            "[ExperimentEval] start exp=%s items=%d concurrency=%d metrics=%s",
            experiment_id,
            len(items),
            effective_concurrency,
            metrics,
        )

        async def _run_item(item: dict[str, Any]) -> dict[str, Any]:
            async with semaphore:
                return await self._evaluate_item(experiment, item, metrics)

        results = await asyncio.gather(*[_run_item(item) for item in items], return_exceptions=True)
        for raw_result, item in zip(results, items):
            if isinstance(raw_result, Exception):
                self.add_result(
                    experiment_id,
                    ExperimentResult(
                        dataset_item_id=str(item.get("item_id") or item.get("id") or ""),
                        input=dict(item.get("input") or {}),
                        output="",
                        scores={},
                        error=str(raw_result),
                        context_snapshot={"metadata": item.get("metadata") or {}},
                    ),
                )
                continue
            self.add_result(experiment_id, ExperimentResult(**raw_result))
        final_status = "completed"
        summary = self.complete(experiment_id, status=final_status)
        logger.info(
            "[ExperimentEval] completed exp=%s avg_scores=%s total_items=%s failed_items=%s",
            experiment_id,
            summary.get("avg_scores", {}),
            summary.get("total_items"),
            summary.get("failed_items"),
        )
        return summary

    async def _evaluate_item(
        self,
        experiment: dict[str, Any],
        item: dict[str, Any],
        metrics: list[str],
    ) -> dict[str, Any]:
        from llm_quality_judge import get_quality_judge
        from retrieval_quality_metric import RetrievalQualityMetric

        question_payload = dict(item.get("input") or {})
        metadata = item.get("metadata") or {}
        if not isinstance(metadata, dict):
            metadata = {}
        question = str(
            question_payload.get("question")
            or question_payload.get("query")
            or question_payload.get("task")
            or ""
        ).strip()
        ground_truth = str(
            metadata.get("ground_truth")
            or item.get("expected_output")
            or question_payload.get("ground_truth")
            or ""
        ).strip()
        answer_text = str(
            metadata.get("candidate_answer")
            or question_payload.get("candidate_answer")
            or item.get("expected_output")
            or ""
        ).strip()
        cfg = experiment.get("config") if isinstance(experiment.get("config"), dict) else {}
        requested_metrics = metrics or [str(item).strip() for item in (cfg.get("metrics") or []) if str(item).strip()]
        mode = str(cfg.get("eval_mode") or experiment.get("source") or "manual").strip().lower()

        scores: dict[str, Any] = {}
        retrieved_contexts: list[str] = []
        if {"context_precision", "context_recall"} & set(requested_metrics) or mode in {"retrieval_eval", "rag_eval"}:
            retrieved_contexts = await self._retrieve_contexts(question, experiment, item)
            retrieval_score = await RetrievalQualityMetric(get_quality_judge()._call_judge_llm).score(
                question=question,
                ground_truth=ground_truth,
                retrieved_contexts=retrieved_contexts,
            )
            scores.update(retrieval_score.to_dict())

        remaining_metrics = [metric for metric in requested_metrics if metric not in {"context_precision", "context_recall"}]
        if remaining_metrics and answer_text:
            quality_scores = await get_quality_judge().evaluate_async(
                lobster_name=str(experiment.get("lobster_name") or ""),
                input_text=question,
                output_text=answer_text,
                context={
                    **metadata,
                    "ground_truth": ground_truth,
                    "reference_contexts": metadata.get("reference_contexts") or [],
                    "retrieved_contexts": retrieved_contexts,
                },
                metrics=remaining_metrics,
                tenant_id=str(experiment.get("tenant_id") or "tenant_main"),
            )
            if isinstance(quality_scores, dict):
                scores.update(quality_scores)

        return {
            "dataset_item_id": str(item.get("item_id") or item.get("id") or ""),
            "input": question_payload,
            "output": answer_text,
            "scores": scores,
            "tokens_used": 0,
            "latency_ms": 0,
            "cost_usd": 0.0,
            "error": None,
            "gen_id": "",
            "context_snapshot": {
                "metadata": metadata,
                "retrieved_contexts": retrieved_contexts,
            },
        }

    async def _retrieve_contexts(
        self,
        question: str,
        experiment: dict[str, Any],
        item: dict[str, Any],
    ) -> list[str]:
        if not question:
            return []
        metadata = item.get("metadata") or {}
        if isinstance(metadata, dict):
            reference_contexts = metadata.get("reference_contexts")
            if isinstance(reference_contexts, list) and reference_contexts:
                if bool((experiment.get("config") or {}).get("use_reference_contexts_as_retrieved")):
                    return [str(entry) for entry in reference_contexts if str(entry).strip()]

        service_url = os.getenv("LOBSTER_MEMORY_API_BASE", "http://127.0.0.1:8000").strip().rstrip("/")
        config = experiment.get("config") if isinstance(experiment.get("config"), dict) else {}
        node_id = str(
            config.get("node_id")
            or experiment.get("lobster_name")
            or item.get("lobster_name")
            or "commander"
        ).strip()
        payload = {
            "node_id": node_id,
            "current_task": question,
            "top_k": int(config.get("top_k") or 10),
            "tenant_id": str(experiment.get("tenant_id") or "tenant_main"),
            "lobster_name": str(experiment.get("lobster_name") or ""),
            "memory_type": config.get("memory_type"),
            "days": config.get("days"),
            "use_hybrid": bool(config.get("use_hybrid", True)),
        }
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.post(f"{service_url}/memory/retrieve", json=payload)
                response.raise_for_status()
                body = response.json()
            items = body.get("memories", []) if isinstance(body, dict) else []
            contexts = [
                str(((entry.get("memory_details") or {}).get("memory_text") or (entry.get("memory_details") or {}).get("content") or ""))
                for entry in items
                if isinstance(entry, dict)
            ]
            normalized = [context for context in contexts if context.strip()]
            if normalized:
                return normalized
        except Exception as exc:
            logger.warning("[ExperimentEval] retrieval via memory service failed: %s", exc)
        return self._fallback_retrieve_contexts(question, experiment)

    def _fallback_retrieve_contexts(self, question: str, experiment: dict[str, Any]) -> list[str]:
        try:
            from enterprise_memory import EnterpriseMemoryBank
        except Exception:
            return []
        tenant_id = str(experiment.get("tenant_id") or "tenant_main")
        bank = EnterpriseMemoryBank()
        merged = bank.get_merged_context(tenant_id)
        if not isinstance(merged, dict):
            return []
        chunks: list[str] = []
        question_terms = {token for token in str(question).lower().split() if token}
        for key, value in merged.items():
            if value in (None, "", [], {}):
                continue
            text = f"{key}: {value}"
            if question_terms:
                lowered = text.lower()
                overlap = sum(1 for token in question_terms if token in lowered)
                if overlap <= 0:
                    continue
            chunks.append(text[:1000])
        return chunks[:10]

    def compare(self, experiment_a: str, experiment_b: str) -> dict[str, Any]:
        left = self.get_experiment(experiment_a)
        right = self.get_experiment(experiment_b)
        if not left or not right:
            return {"error": "experiment_not_found"}
        metrics = sorted(
            set(left.get("avg_scores", {}).keys()) | set(right.get("avg_scores", {}).keys())
        )
        metric_payload: dict[str, dict[str, Any]] = {}
        for metric in metrics:
            score_a = float(left.get("avg_scores", {}).get(metric, 0.0) or 0.0)
            score_b = float(right.get("avg_scores", {}).get(metric, 0.0) or 0.0)
            winner = "tie"
            if score_a > score_b:
                winner = "a"
            elif score_b > score_a:
                winner = "b"
            metric_payload[metric] = {
                "a": round(score_a, 4),
                "b": round(score_b, 4),
                "delta": round(score_b - score_a, 4),
                "winner": winner,
            }

        samples: list[dict[str, Any]] = []
        left_results = left.get("results", [])
        right_results = right.get("results", [])
        pair_count = min(len(left_results), len(right_results), 20)
        for index in range(pair_count):
            left_item = left_results[index]
            right_item = right_results[index]
            samples.append(
                {
                    "dataset_item_id": left_item.get("dataset_item_id") or right_item.get("dataset_item_id") or f"pair_{index + 1}",
                    "input": left_item.get("input") or right_item.get("input") or {},
                    "output_a": left_item.get("output_text", ""),
                    "output_b": right_item.get("output_text", ""),
                    "scores_a": left_item.get("scores", {}),
                    "scores_b": right_item.get("scores", {}),
                }
            )
        return {
            "experiment_a": {
                "id": left.get("experiment_id"),
                "name": left.get("name"),
                "lobster_name": left.get("lobster_name"),
                "prompt_name": left.get("prompt_name"),
                "prompt_version": left.get("prompt_version"),
                "source": left.get("source"),
                "avg_scores": left.get("avg_scores", {}),
                "avg_latency_ms": left.get("avg_latency_ms", 0.0),
                "avg_tokens": left.get("avg_tokens", 0.0),
                "total_cost_usd": left.get("total_cost_usd", 0.0),
            },
            "experiment_b": {
                "id": right.get("experiment_id"),
                "name": right.get("name"),
                "lobster_name": right.get("lobster_name"),
                "prompt_name": right.get("prompt_name"),
                "prompt_version": right.get("prompt_version"),
                "source": right.get("source"),
                "avg_scores": right.get("avg_scores", {}),
                "avg_latency_ms": right.get("avg_latency_ms", 0.0),
                "avg_tokens": right.get("avg_tokens", 0.0),
                "total_cost_usd": right.get("total_cost_usd", 0.0),
            },
            "metrics": metric_payload,
            "latency_delta_ms": round(float(right.get("avg_latency_ms", 0.0) or 0.0) - float(left.get("avg_latency_ms", 0.0) or 0.0), 2),
            "tokens_delta": round(float(right.get("avg_tokens", 0.0) or 0.0) - float(left.get("avg_tokens", 0.0) or 0.0), 2),
            "cost_delta_usd": round(float(right.get("total_cost_usd", 0.0) or 0.0) - float(left.get("total_cost_usd", 0.0) or 0.0), 6),
            "samples": samples,
        }

    def append_online_result(
        self,
        *,
        lobster_name: str,
        tenant_id: str,
        input_payload: dict[str, Any] | None,
        output_text: str,
        scores: dict[str, Any],
        gen_id: str = "",
        latency_ms: int = 0,
        tokens_used: int = 0,
        cost_usd: float = 0.0,
        context_snapshot: dict[str, Any] | None = None,
        prompt_name: str = "",
        prompt_version: str = "",
        model: str = "",
        source: str = "online_eval",
        experiment_name: str | None = None,
        dataset_item_id: str = "",
        error: str | None = None,
    ) -> dict[str, Any]:
        today = datetime.now(timezone.utc).strftime("%Y%m%d")
        name = experiment_name or f"online-eval.{lobster_name}.{today}"
        experiment = self._find_latest_running_experiment(
            tenant_id=tenant_id,
            lobster_name=lobster_name,
            source=source,
            name=name,
        )
        if not experiment:
            experiment = self.create(
                name=name,
                lobster_name=lobster_name,
                prompt_name=prompt_name,
                prompt_version=prompt_version,
                model=model,
                dataset_id="",
                tenant_id=tenant_id,
                source=source,
                metrics=[str(key) for key in scores.keys() if isinstance(scores.get(key), (int, float, bool))],
                config={},
                notes="auto-appended online evaluation stream",
                status="running",
            )
        return self.add_result(
            str(experiment.get("id") or experiment.get("experiment_id")),
            ExperimentResult(
                dataset_item_id=dataset_item_id,
                input=dict(input_payload or {}),
                output=output_text,
                scores=dict(scores),
                tokens_used=tokens_used,
                latency_ms=latency_ms,
                cost_usd=cost_usd,
                error=error,
                gen_id=gen_id,
                context_snapshot=dict(context_snapshot or {}),
            ),
        )

    def append_prompt_experiment_result(
        self,
        *,
        flag_name: str,
        lobster_name: str,
        tenant_id: str,
        variant_name: str,
        input_payload: dict[str, Any] | None,
        output_text: str,
        scores: dict[str, Any],
        gen_id: str = "",
        latency_ms: int = 0,
        prompt_name: str = "",
        prompt_version: str = "",
        model: str = "",
        context_snapshot: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self.append_online_result(
            lobster_name=lobster_name,
            tenant_id=tenant_id,
            input_payload=input_payload,
            output_text=output_text,
            scores=scores,
            gen_id=gen_id,
            latency_ms=latency_ms,
            context_snapshot=context_snapshot,
            prompt_name=prompt_name,
            prompt_version=prompt_version,
            model=model,
            source="prompt_experiment",
            experiment_name=f"{flag_name}:{variant_name}",
        )

    def _find_latest_running_experiment(
        self,
        *,
        tenant_id: str,
        lobster_name: str,
        source: str,
        name: str,
    ) -> dict[str, Any]:
        conn = self._conn()
        try:
            row = conn.execute(
                """
                SELECT * FROM experiments
                WHERE tenant_id=? AND lobster_name=? AND source=? AND name=? AND status='running'
                ORDER BY created_at DESC LIMIT 1
                """,
                (tenant_id, lobster_name, source, name),
            ).fetchone()
            return self._serialize_experiment_row(row)
        finally:
            conn.close()

    def _refresh_summary(self, conn: sqlite3.Connection, experiment_id: str) -> None:
        rows = conn.execute(
            """
            SELECT scores, tokens_used, latency_ms, cost_usd, error
            FROM experiment_results
            WHERE experiment_id=?
            """,
            (experiment_id,),
        ).fetchall()
        total_items = len(rows)
        completed_items = 0
        failed_items = 0
        numeric_scores: dict[str, list[float]] = {}
        total_latency = 0.0
        total_tokens = 0.0
        total_cost = 0.0
        for row in rows:
            total_latency += float(row["latency_ms"] or 0.0)
            total_tokens += float(row["tokens_used"] or 0.0)
            total_cost += float(row["cost_usd"] or 0.0)
            if str(row["error"] or "").strip():
                failed_items += 1
                continue
            completed_items += 1
            payload = self._loads(row["scores"], {})
            if not isinstance(payload, dict):
                continue
            for key, value in payload.items():
                if isinstance(value, bool):
                    numeric_scores.setdefault(key, []).append(1.0 if value else 0.0)
                elif isinstance(value, (int, float)):
                    numeric_scores.setdefault(key, []).append(float(value))
        avg_scores = {
            key: round(sum(values) / len(values), 4)
            for key, values in numeric_scores.items()
            if values
        }
        avg_latency = round(total_latency / total_items, 2) if total_items else 0.0
        avg_tokens = round(total_tokens / total_items, 2) if total_items else 0.0
        conn.execute(
            """
            UPDATE experiments
            SET avg_scores=?, total_items=?, completed_items=?, failed_items=?,
                avg_latency_ms=?, avg_tokens=?, total_cost_usd=?, updated_at=?
            WHERE experiment_id=?
            """,
            (
                json.dumps(avg_scores, ensure_ascii=False),
                total_items,
                completed_items,
                failed_items,
                avg_latency,
                avg_tokens,
                round(total_cost, 6),
                _now(),
                experiment_id,
            ),
        )


_default_registry: ExperimentRegistry | None = None


def get_experiment_registry() -> ExperimentRegistry:
    global _default_registry
    if _default_registry is None:
        _default_registry = ExperimentRegistry()
    return _default_registry


async def run_experiment_evaluation(
    experiment_id: str,
    *,
    registry: ExperimentRegistry | None = None,
    concurrency: int | None = None,
) -> dict[str, Any]:
    target_registry = registry or get_experiment_registry()
    return await target_registry.run_experiment_evaluation(experiment_id, concurrency=concurrency)
