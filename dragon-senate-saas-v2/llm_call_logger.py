"""
LLMCallLogger — LLM 调用 Generation 记录
==========================================
灵感来源：Langfuse Generation / Observation 数据模型
借鉴要点：
  - 每次龙虾调用 LLM 时自动记录：model / input / output / prompt_tokens /
    completion_tokens / total_tokens / cost_usd / latency_ms / status
  - 存入 SQLite，供 abacus 龙虾汇总成本 / 供 Trace 树状 UI 展示
  - 支持 Trace > Span > Generation 嵌套层级（对应 Langfuse 的 Observation 模型）
  - 支持人工评分 + LLM-as-Judge 自动评分写入（Score）

Langfuse 概念映射：
  Trace                  → LLMTrace（一次完整工作流执行）
  Span                   → LLMSpan（一步龙虾执行）
  Generation             → LLMGeneration（一次 LLM API 调用）
  Score                  → LLMScore（对某条 Generation 的评分）
  Observation            → LLMTrace + LLMSpan + LLMGeneration 的统称

使用方式：
    logger = LLMCallLogger()

    # 开始一次工作流级别 Trace
    trace_id = logger.start_trace(
        workflow_run_id="run-abc123",
        workflow_name="content-campaign-14step",
        tenant_id="t001",
        meta={"platform": "douyin"}
    )

    # 开始一步龙虾执行（Span）
    span_id = logger.start_span(trace_id, lobster="inkwriter",
                                 skill="inkwriter_industry_vertical_copy", step_index=5)

    # 记录一次 LLM 调用（Generation）
    t0 = time.time()
    response = call_llm(prompt)
    gen_id = logger.record_generation(
        span_id=span_id,
        trace_id=trace_id,
        model="gpt-4o",
        input_text=prompt,
        output_text=response.content,
        prompt_tokens=response.usage.prompt_tokens,
        completion_tokens=response.usage.completion_tokens,
        latency_ms=int((time.time()-t0)*1000),
    )

    # 结束 Span
    logger.end_span(span_id, status="completed")

    # 添加质量评分（Score）
    logger.add_score(generation_id=gen_id, name="quality", value=0.85,
                     scorer="llm-judge", comment="文案专业度高")

    # 查询成本统计
    stats = logger.get_cost_summary(tenant_id="t001", days=30)
    # → {"total_cost_usd": 12.34, "total_tokens": 450000, "by_model": {...}}
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Optional

from log_enrich_pipeline import log_enrich_pipeline

# ─────────────────────────────────────────────────────────────────
# 模型成本配置（USD per 1K tokens，参考 OpenAI 官方定价）
# ─────────────────────────────────────────────────────────────────

MODEL_COSTS: dict[str, dict[str, float]] = {
    "gpt-4o":               {"input": 0.0025,  "output": 0.010},
    "gpt-4o-mini":          {"input": 0.00015, "output": 0.0006},
    "gpt-4-turbo":          {"input": 0.010,   "output": 0.030},
    "gpt-4":                {"input": 0.030,   "output": 0.060},
    "gpt-3.5-turbo":        {"input": 0.0005,  "output": 0.0015},
    "claude-3-5-sonnet":    {"input": 0.003,   "output": 0.015},
    "claude-3-5-haiku":     {"input": 0.00080, "output": 0.004},
    "claude-3-opus":        {"input": 0.015,   "output": 0.075},
    "deepseek-chat":        {"input": 0.00014, "output": 0.00028},
    "deepseek-reasoner":    {"input": 0.00055, "output": 0.00219},
    "qwen-max":             {"input": 0.0016,  "output": 0.0016},
    "qwen-plus":            {"input": 0.0004,  "output": 0.0012},
    "glm-4":                {"input": 0.0014,  "output": 0.0014},
}

def calc_cost_usd(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    """计算 LLM 调用成本（USD）"""
    costs = MODEL_COSTS.get(model, {"input": 0.002, "output": 0.002})
    return (prompt_tokens * costs["input"] + completion_tokens * costs["output"]) / 1000


_DB_PATH = os.getenv("LLM_CALL_LOGGER_DB", "./data/llm_call_log.sqlite")


class GenerationStatus(str, Enum):
    success  = "success"
    error    = "error"
    timeout  = "timeout"
    filtered = "filtered"  # 内容过滤


# ─────────────────────────────────────────────────────────────────
# LLMCallLogger — 主类
# ─────────────────────────────────────────────────────────────────

class LLMCallLogger:
    """
    LLM 调用日志记录引擎（对应 Langfuse Generation/Trace/Score）。

    存储层级：
    LLMTrace（工作流）→ LLMSpan（龙虾步骤）→ LLMGeneration（单次 LLM 调用）→ LLMScore（评分）

    特性：
    - 自动计算成本（USD）
    - 支持多模型成本配置（可动态更新）
    - 支持人工评分 + LLM-as-Judge 自动评分
    - 成本/延迟统计聚合
    - 全文索引支持（按 lobster / model / tenant 查询）
    """

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
            conn.executescript("""
                -- Trace：一次完整工作流执行（对应 Langfuse Trace）
                CREATE TABLE IF NOT EXISTS llm_traces (
                    trace_id        TEXT PRIMARY KEY,
                    workflow_run_id TEXT,
                    workflow_name   TEXT NOT NULL DEFAULT '',
                    tenant_id       TEXT NOT NULL DEFAULT 'tenant_main',
                    name            TEXT DEFAULT '',
                    tags            TEXT DEFAULT '[]',
                    meta            TEXT DEFAULT '{}',
                    started_at      TEXT NOT NULL,
                    ended_at        TEXT,
                    status          TEXT DEFAULT 'running'
                );
                CREATE INDEX IF NOT EXISTS idx_trace_tenant ON llm_traces(tenant_id, started_at);
                CREATE INDEX IF NOT EXISTS idx_trace_run ON llm_traces(workflow_run_id);

                -- Span：一步龙虾执行（对应 Langfuse Span）
                CREATE TABLE IF NOT EXISTS llm_spans (
                    span_id         TEXT PRIMARY KEY,
                    trace_id        TEXT NOT NULL,
                    tenant_id       TEXT NOT NULL DEFAULT 'tenant_main',
                    lobster         TEXT NOT NULL DEFAULT '',
                    skill           TEXT DEFAULT '',
                    step_index      INTEGER,
                    started_at      TEXT NOT NULL,
                    ended_at        TEXT,
                    latency_ms      INTEGER DEFAULT 0,
                    status          TEXT DEFAULT 'running',
                    meta            TEXT DEFAULT '{}',
                    FOREIGN KEY (trace_id) REFERENCES llm_traces(trace_id)
                );
                CREATE INDEX IF NOT EXISTS idx_span_trace ON llm_spans(trace_id);
                CREATE INDEX IF NOT EXISTS idx_span_lobster ON llm_spans(lobster, started_at);

                -- Generation：单次 LLM API 调用（对应 Langfuse Generation）
                CREATE TABLE IF NOT EXISTS llm_generations (
                    gen_id              TEXT PRIMARY KEY,
                    span_id             TEXT,
                    trace_id            TEXT NOT NULL,
                    tenant_id           TEXT NOT NULL DEFAULT 'tenant_main',
                    model               TEXT NOT NULL DEFAULT '',
                    provider            TEXT DEFAULT '',
                    input_text          TEXT DEFAULT '',
                    output_text         TEXT DEFAULT '',
                    system_prompt       TEXT DEFAULT '',
                    prompt_tokens       INTEGER DEFAULT 0,
                    completion_tokens   INTEGER DEFAULT 0,
                    total_tokens        INTEGER DEFAULT 0,
                    cost_usd            REAL DEFAULT 0.0,
                    latency_ms          INTEGER DEFAULT 0,
                    status              TEXT DEFAULT 'success',
                    error_message       TEXT DEFAULT '',
                    variant_name        TEXT DEFAULT 'control',
                    temperature         REAL,
                    max_tokens          INTEGER,
                    tags                TEXT DEFAULT '[]',
                    meta                TEXT DEFAULT '{}',
                    created_at          TEXT NOT NULL,
                    FOREIGN KEY (span_id) REFERENCES llm_spans(span_id),
                    FOREIGN KEY (trace_id) REFERENCES llm_traces(trace_id)
                );
                CREATE INDEX IF NOT EXISTS idx_gen_trace ON llm_generations(trace_id);
                CREATE INDEX IF NOT EXISTS idx_gen_span ON llm_generations(span_id);
                CREATE INDEX IF NOT EXISTS idx_gen_tenant ON llm_generations(tenant_id, created_at);
                CREATE INDEX IF NOT EXISTS idx_gen_model ON llm_generations(model, created_at);

                -- Score：对某条 Generation 的评分（对应 Langfuse Score）
                CREATE TABLE IF NOT EXISTS llm_scores (
                    score_id        TEXT PRIMARY KEY,
                    gen_id          TEXT NOT NULL,
                    trace_id        TEXT NOT NULL,
                    tenant_id       TEXT NOT NULL DEFAULT 'tenant_main',
                    name            TEXT NOT NULL,    -- 评分维度（quality/relevance/toxicity/accuracy）
                    value           REAL,             -- 数值评分（如 0.85）
                    string_value    TEXT,             -- 分类评分（如 "positive"/"negative"）
                    boolean_value   INTEGER,          -- 布尔评分（0/1）
                    score_type      TEXT DEFAULT 'numeric',  -- numeric/categorical/boolean
                    scorer          TEXT DEFAULT 'human',    -- 评分来源（human/llm-judge/auto）
                    comment         TEXT DEFAULT '',
                    created_at      TEXT NOT NULL,
                    FOREIGN KEY (gen_id) REFERENCES llm_generations(gen_id)
                );
                CREATE INDEX IF NOT EXISTS idx_score_gen ON llm_scores(gen_id);
                CREATE INDEX IF NOT EXISTS idx_score_tenant ON llm_scores(tenant_id, name, created_at);

                CREATE TABLE IF NOT EXISTS llm_call_logs (
                    log_id            TEXT PRIMARY KEY,
                    tenant_id         TEXT NOT NULL DEFAULT 'tenant_main',
                    lobster_name      TEXT DEFAULT '',
                    session_id        TEXT DEFAULT '',
                    node_id           TEXT DEFAULT '',
                    timestamp         REAL NOT NULL DEFAULT 0,
                    level             TEXT DEFAULT 'info',
                    event_type        TEXT DEFAULT 'llm_generation',
                    status            TEXT DEFAULT 'success',
                    trace_id          TEXT DEFAULT '',
                    span_id           TEXT DEFAULT '',
                    gen_id            TEXT DEFAULT '',
                    model             TEXT DEFAULT '',
                    provider          TEXT DEFAULT '',
                    prompt_tokens     INTEGER DEFAULT 0,
                    completion_tokens INTEGER DEFAULT 0,
                    total_tokens      INTEGER DEFAULT 0,
                    latency_ms        INTEGER DEFAULT 0,
                    cost_usd          REAL DEFAULT 0.0,
                    is_slow           INTEGER DEFAULT 0,
                    is_error          INTEGER DEFAULT 0,
                    is_high_cost      INTEGER DEFAULT 0,
                    prompt            TEXT DEFAULT '',
                    output_text       TEXT DEFAULT '',
                    tool_name         TEXT DEFAULT '',
                    tags_json         TEXT DEFAULT '[]',
                    meta_json         TEXT DEFAULT '{}'
                );
                CREATE INDEX IF NOT EXISTS idx_call_logs_tenant_ts ON llm_call_logs(tenant_id, timestamp DESC);
                CREATE INDEX IF NOT EXISTS idx_call_logs_lobster_ts ON llm_call_logs(lobster_name, timestamp DESC);
                CREATE INDEX IF NOT EXISTS idx_call_logs_status_ts ON llm_call_logs(status, timestamp DESC);
            """)
            cols = {str(row["name"]) for row in conn.execute("PRAGMA table_info(llm_generations)").fetchall()}
            if "variant_name" not in cols:
                conn.execute("ALTER TABLE llm_generations ADD COLUMN variant_name TEXT DEFAULT 'control'")
            conn.commit()
        finally:
            conn.close()

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _lookup_span_context(self, span_id: str | None) -> dict[str, Any]:
        if not span_id:
            return {}
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT lobster, meta FROM llm_spans WHERE span_id=?",
                (span_id,),
            ).fetchone()
            if not row:
                return {}
            meta = json.loads(row["meta"] or "{}")
            return {
                "lobster_name": str(row["lobster"] or "").strip(),
                **(meta if isinstance(meta, dict) else {}),
            }
        finally:
            conn.close()

    def _write_structured_log(self, record: dict[str, Any], context: dict[str, Any] | None = None) -> str | None:
        enriched = log_enrich_pipeline.enrich(record, context)
        if enriched is None:
            return None
        log_id = f"log_{uuid.uuid4().hex[:12]}"
        conn = self._conn()
        try:
            conn.execute(
                """
                INSERT INTO llm_call_logs (
                    log_id, tenant_id, lobster_name, session_id, node_id, timestamp,
                    level, event_type, status, trace_id, span_id, gen_id, model, provider,
                    prompt_tokens, completion_tokens, total_tokens, latency_ms, cost_usd,
                    is_slow, is_error, is_high_cost, prompt, output_text, tool_name,
                    tags_json, meta_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    log_id,
                    str(enriched.get("tenant_id") or "tenant_main"),
                    str(enriched.get("lobster_name") or ""),
                    str(enriched.get("session_id") or ""),
                    str(enriched.get("node_id") or ""),
                    float(enriched.get("timestamp") or time.time()),
                    str(enriched.get("level") or "info"),
                    str(enriched.get("event_type") or "llm_generation"),
                    str(enriched.get("status") or "success"),
                    str(enriched.get("trace_id") or ""),
                    str(enriched.get("span_id") or ""),
                    str(enriched.get("gen_id") or ""),
                    str(enriched.get("model") or ""),
                    str(enriched.get("provider") or ""),
                    int(enriched.get("prompt_tokens") or 0),
                    int(enriched.get("completion_tokens") or 0),
                    int(enriched.get("total_tokens") or 0),
                    int(enriched.get("latency_ms") or 0),
                    float(enriched.get("cost_usd") or 0.0),
                    1 if enriched.get("is_slow") else 0,
                    1 if enriched.get("is_error") else 0,
                    1 if enriched.get("is_high_cost") else 0,
                    str(enriched.get("prompt") or enriched.get("input_text") or ""),
                    str(enriched.get("output_text") or ""),
                    str(enriched.get("tool_name") or ""),
                    json.dumps(enriched.get("tags") or [], ensure_ascii=False),
                    json.dumps(enriched.get("meta") or enriched.get("meta_json") or {}, ensure_ascii=False),
                ),
            )
            conn.commit()
            return log_id
        finally:
            conn.close()

    # ── Trace（工作流级别）────────────────────────────────────────

    def start_trace(
        self,
        workflow_run_id: str = "",
        workflow_name: str = "",
        tenant_id: str = "tenant_main",
        name: str = "",
        tags: list[str] | None = None,
        meta: dict | None = None,
    ) -> str:
        """开始一次 Trace（对应 Langfuse client.trace()）"""
        trace_id = f"tr_{uuid.uuid4().hex[:12]}"
        conn = self._conn()
        try:
            conn.execute(
                """INSERT INTO llm_traces
                   (trace_id, workflow_run_id, workflow_name, tenant_id, name, tags, meta, started_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (trace_id, workflow_run_id, workflow_name, tenant_id,
                 name or workflow_name,
                 json.dumps(tags or []), json.dumps(meta or {}), self._now())
            )
            conn.commit()
        finally:
            conn.close()
        return trace_id

    def end_trace(self, trace_id: str, status: str = "completed") -> None:
        """结束 Trace"""
        conn = self._conn()
        try:
            conn.execute(
                "UPDATE llm_traces SET ended_at=?, status=? WHERE trace_id=?",
                (self._now(), status, trace_id)
            )
            conn.commit()
        finally:
            conn.close()

    # ── Span（龙虾步骤级别）──────────────────────────────────────

    def start_span(
        self,
        trace_id: str,
        lobster: str,
        skill: str = "",
        step_index: Optional[int] = None,
        tenant_id: str = "tenant_main",
        meta: dict | None = None,
    ) -> str:
        """开始一个 Span（对应 Langfuse client.span()）"""
        span_id = f"sp_{uuid.uuid4().hex[:12]}"
        conn = self._conn()
        try:
            conn.execute(
                """INSERT INTO llm_spans
                   (span_id, trace_id, tenant_id, lobster, skill, step_index, started_at, meta)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (span_id, trace_id, tenant_id, lobster, skill, step_index,
                 self._now(), json.dumps(meta or {}))
            )
            conn.commit()
        finally:
            conn.close()
        return span_id

    def end_span(self, span_id: str, status: str = "completed",
                 latency_ms: int = 0) -> None:
        """结束 Span"""
        conn = self._conn()
        try:
            conn.execute(
                "UPDATE llm_spans SET ended_at=?, status=?, latency_ms=? WHERE span_id=?",
                (self._now(), status, latency_ms, span_id)
            )
            conn.commit()
        finally:
            conn.close()

    # ── Generation（单次 LLM 调用）───────────────────────────────

    def record_generation(
        self,
        trace_id: str,
        model: str,
        input_text: str,
        output_text: str,
        span_id: Optional[str] = None,
        tenant_id: str = "tenant_main",
        provider: str = "",
        system_prompt: str = "",
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        latency_ms: int = 0,
        status: GenerationStatus | str = GenerationStatus.success,
        error_message: str = "",
        variant_name: str = "control",
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        tags: list[str] | None = None,
        meta: dict | None = None,
    ) -> str:
        """
        记录一次 LLM API 调用（对应 Langfuse client.generation()）。
        自动计算 total_tokens 和 cost_usd。
        """
        gen_id = f"gn_{uuid.uuid4().hex[:12]}"
        total_tokens = prompt_tokens + completion_tokens
        cost_usd = calc_cost_usd(model, prompt_tokens, completion_tokens)
        status_value = status.value if isinstance(status, GenerationStatus) else str(status or GenerationStatus.success.value)
        conn = self._conn()
        try:
            conn.execute(
                """INSERT INTO llm_generations
                   (gen_id, span_id, trace_id, tenant_id, model, provider,
                    input_text, output_text, system_prompt,
                    prompt_tokens, completion_tokens, total_tokens, cost_usd,
                    latency_ms, status, error_message, variant_name, temperature, max_tokens,
                    tags, meta, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    gen_id, span_id, trace_id, tenant_id, model, provider,
                    input_text[:10000], output_text[:10000], system_prompt[:5000],
                    prompt_tokens, completion_tokens, total_tokens, cost_usd,
                    latency_ms, status_value, error_message, variant_name,
                    temperature, max_tokens,
                    json.dumps(tags or []), json.dumps(meta or {}), self._now()
                )
            )
            conn.commit()
        finally:
            conn.close()
        span_ctx = self._lookup_span_context(span_id)
        merged_meta = {}
        if isinstance(meta, dict):
            merged_meta.update(meta)
        merged_meta.update({k: v for k, v in span_ctx.items() if k != "lobster_name"})
        self._write_structured_log(
            {
                "tenant_id": tenant_id,
                "lobster_name": span_ctx.get("lobster_name") or str((meta or {}).get("lobster_name") or ""),
                "session_id": str((meta or {}).get("session_id") or ""),
                "node_id": str((meta or {}).get("node_id") or (meta or {}).get("edge_node_id") or ""),
                "timestamp": time.time(),
                "level": "error" if status_value in {"error", "timeout", "filtered"} else "info",
                "event_type": "llm_generation",
                "status": status_value,
                "trace_id": trace_id,
                "span_id": span_id or "",
                "gen_id": gen_id,
                "model": model,
                "provider": provider,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens,
                "latency_ms": latency_ms,
                "cost_usd": cost_usd,
                "input_text": input_text,
                "output_text": output_text,
                "tags": tags or [],
                "meta": merged_meta,
            },
            context={**span_ctx, **merged_meta, "tenant_id": tenant_id},
        )
        return gen_id

    # ── Score（评分）─────────────────────────────────────────────

    def add_score(
        self,
        gen_id: str,
        name: str,
        value: Optional[float] = None,
        string_value: Optional[str] = None,
        boolean_value: Optional[bool] = None,
        scorer: str = "human",
        comment: str = "",
        tenant_id: str = "tenant_main",
    ) -> str:
        """
        添加评分（对应 Langfuse client.score()）。
        支持三种类型：
          - numeric: value=0.85（0-1 或自定义范围）
          - categorical: string_value="positive"
          - boolean: boolean_value=True
        scorer: "human" | "llm-judge" | "auto-rule"
        """
        # 查询 trace_id
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT trace_id, tenant_id FROM llm_generations WHERE gen_id=?", (gen_id,)
            ).fetchone()
            trace_id = row["trace_id"] if row else ""
            if not tenant_id or tenant_id == "tenant_main":
                tenant_id = row["tenant_id"] if row else "tenant_main"
        finally:
            conn.close()

        score_type = "numeric"
        if string_value is not None:
            score_type = "categorical"
        elif boolean_value is not None:
            score_type = "boolean"
            value = 1.0 if boolean_value else 0.0

        score_id = f"sc_{uuid.uuid4().hex[:12]}"
        conn = self._conn()
        try:
            conn.execute(
                """INSERT INTO llm_scores
                   (score_id, gen_id, trace_id, tenant_id, name, value, string_value,
                    boolean_value, score_type, scorer, comment, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    score_id, gen_id, trace_id, tenant_id, name,
                    value, string_value,
                    (1 if boolean_value else 0) if boolean_value is not None else None,
                    score_type, scorer, comment, self._now()
                )
            )
            conn.commit()
        finally:
            conn.close()
        return score_id

    # ── 统计查询（对应 Langfuse Dashboard）───────────────────────

    def get_cost_summary(
        self,
        tenant_id: str = "tenant_main",
        days: int = 30,
    ) -> dict[str, Any]:
        """
        获取成本统计（对应 Langfuse Dashboard 的 cost 趋势）。
        Returns: {total_cost_usd, total_tokens, by_model, by_lobster, daily_trend}
        """
        from datetime import timedelta
        since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        conn = self._conn()
        try:
            # 总量
            total = conn.execute(
                """SELECT SUM(cost_usd) as cost, SUM(total_tokens) as tokens,
                          COUNT(*) as calls, AVG(latency_ms) as avg_latency
                   FROM llm_generations
                   WHERE tenant_id=? AND created_at >= ?""",
                (tenant_id, since)
            ).fetchone()

            # 按模型分组
            by_model = conn.execute(
                """SELECT model, SUM(cost_usd) as cost, SUM(total_tokens) as tokens,
                          COUNT(*) as calls, AVG(latency_ms) as avg_latency
                   FROM llm_generations
                   WHERE tenant_id=? AND created_at >= ?
                   GROUP BY model ORDER BY cost DESC""",
                (tenant_id, since)
            ).fetchall()

            # 按龙虾分组（通过 span）
            by_lobster = conn.execute(
                """SELECT s.lobster, SUM(g.cost_usd) as cost, SUM(g.total_tokens) as tokens,
                          COUNT(g.gen_id) as calls
                   FROM llm_generations g
                   LEFT JOIN llm_spans s ON g.span_id = s.span_id
                   WHERE g.tenant_id=? AND g.created_at >= ?
                   GROUP BY s.lobster ORDER BY cost DESC""",
                (tenant_id, since)
            ).fetchall()

            # 每日趋势
            daily = conn.execute(
                """SELECT DATE(created_at) as day, SUM(cost_usd) as cost,
                          SUM(total_tokens) as tokens, COUNT(*) as calls
                   FROM llm_generations
                   WHERE tenant_id=? AND created_at >= ?
                   GROUP BY day ORDER BY day""",
                (tenant_id, since)
            ).fetchall()

            return {
                "tenant_id": tenant_id,
                "days": days,
                "total_cost_usd": round(float(total["cost"] or 0), 6),
                "total_tokens": int(total["tokens"] or 0),
                "total_calls": int(total["calls"] or 0),
                "avg_latency_ms": round(float(total["avg_latency"] or 0), 1),
                "by_model": [dict(r) for r in by_model],
                "by_lobster": [dict(r) for r in by_lobster],
                "daily_trend": [dict(r) for r in daily],
            }
        finally:
            conn.close()

    def get_trace_detail(self, trace_id: str) -> Optional[dict[str, Any]]:
        """
        获取 Trace 详情（对应 Langfuse Trace 详情页）。
        Returns: Trace + Spans + Generations + Scores 的嵌套结构
        """
        conn = self._conn()
        try:
            trace = conn.execute(
                "SELECT * FROM llm_traces WHERE trace_id=?", (trace_id,)
            ).fetchone()
            if not trace:
                return None
            d = dict(trace)

            spans = conn.execute(
                "SELECT * FROM llm_spans WHERE trace_id=? ORDER BY started_at",
                (trace_id,)
            ).fetchall()

            result_spans = []
            for span in spans:
                sd = dict(span)
                gens = conn.execute(
                    "SELECT * FROM llm_generations WHERE span_id=? ORDER BY created_at",
                    (span["span_id"],)
                ).fetchall()
                gen_list = []
                for gen in gens:
                    gd = dict(gen)
                    scores = conn.execute(
                        "SELECT * FROM llm_scores WHERE gen_id=? ORDER BY created_at",
                        (gen["gen_id"],)
                    ).fetchall()
                    gd["scores"] = [dict(s) for s in scores]
                    gen_list.append(gd)
                sd["generations"] = gen_list
                result_spans.append(sd)

            d["spans"] = result_spans
            return d
        finally:
            conn.close()

    def list_traces(
        self,
        tenant_id: str = "tenant_main",
        workflow_name: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """列出 Trace 列表（对应 Langfuse Traces 列表页）"""
        conn = self._conn()
        try:
            q = """SELECT t.*, 
                          COUNT(g.gen_id) as gen_count,
                          SUM(g.total_tokens) as total_tokens,
                          SUM(g.cost_usd) as total_cost_usd
                   FROM llm_traces t
                   LEFT JOIN llm_generations g ON t.trace_id = g.trace_id
                   WHERE t.tenant_id=?"""
            params: list[Any] = [tenant_id]
            if workflow_name:
                q += " AND t.workflow_name=?"
                params.append(workflow_name)
            if status:
                q += " AND t.status=?"
                params.append(status)
            q += " GROUP BY t.trace_id ORDER BY t.started_at DESC LIMIT ?"
            params.append(limit)
            rows = conn.execute(q, params).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def get_score_analytics(
        self,
        tenant_id: str = "tenant_main",
        score_name: str = "quality",
        days: int = 30,
    ) -> dict[str, Any]:
        """
        获取评分分析（对应 Langfuse Score Analytics）。
        用于分析龙虾输出质量趋势，指导 Prompt 优化 / RL 微调。
        """
        from datetime import timedelta
        since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        conn = self._conn()
        try:
            stats = conn.execute(
                """SELECT AVG(value) as avg_score, MIN(value) as min_score,
                          MAX(value) as max_score, COUNT(*) as count,
                          AVG(CASE WHEN value >= 0.8 THEN 1.0 ELSE 0.0 END) as high_rate
                   FROM llm_scores
                   WHERE tenant_id=? AND name=? AND created_at >= ? AND score_type='numeric'""",
                (tenant_id, score_name, since)
            ).fetchone()
            daily = conn.execute(
                """SELECT DATE(created_at) as day, AVG(value) as avg_score, COUNT(*) as count
                   FROM llm_scores
                   WHERE tenant_id=? AND name=? AND created_at >= ?
                   GROUP BY day ORDER BY day""",
                (tenant_id, score_name, since)
            ).fetchall()
            return {
                "score_name": score_name,
                "days": days,
                "avg_score": round(float(stats["avg_score"] or 0), 3),
                "min_score": round(float(stats["min_score"] or 0), 3),
                "max_score": round(float(stats["max_score"] or 0), 3),
                "count": int(stats["count"] or 0),
                "high_quality_rate": round(float(stats["high_rate"] or 0), 3),
                "daily_trend": [dict(r) for r in daily],
            }
        finally:
            conn.close()


# ─────────────────────────────────────────────────────────────────
# 便捷装饰器：自动记录 LLM 调用
# ─────────────────────────────────────────────────────────────────

import functools

def log_llm_call(
    model: str = "gpt-4o",
    lobster: str = "",
    skill: str = "",
    tenant_id: str = "tenant_main",
):
    """
    装饰器：自动记录 LLM 调用日志。
    用于 lobster_runner.py 中的 LLM 调用包装。

    使用方式：
        @log_llm_call(model="gpt-4o", lobster="inkwriter", skill="inkwriter_copy_generate")
        def call_llm(prompt: str, trace_id: str = "") -> str:
            response = openai.chat.completions.create(...)
            return response.choices[0].message.content
    """
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            logger = get_llm_call_logger()
            trace_id = kwargs.pop("trace_id", "") or ""
            span_id = kwargs.pop("span_id", "") or ""
            t0 = time.time()
            try:
                result = func(*args, **kwargs)
                latency_ms = int((time.time() - t0) * 1000)
                if trace_id:
                    input_text = str(args[0]) if args else str(kwargs.get("prompt", ""))
                    logger.record_generation(
                        trace_id=trace_id,
                        span_id=span_id or None,
                        model=model,
                        input_text=input_text,
                        output_text=str(result) if result else "",
                        latency_ms=latency_ms,
                        tenant_id=tenant_id,
                        meta={"lobster": lobster, "skill": skill},
                    )
                return result
            except Exception as e:
                latency_ms = int((time.time() - t0) * 1000)
                if trace_id:
                    logger.record_generation(
                        trace_id=trace_id, span_id=span_id or None,
                        model=model, input_text="", output_text="",
                        latency_ms=latency_ms, tenant_id=tenant_id,
                        status=GenerationStatus.error, error_message=str(e),
                    )
                raise
        return wrapper
    return decorator


# ─────────────────────────────────────────────────────────────────
# 全局单例
# ─────────────────────────────────────────────────────────────────

_default_logger: LLMCallLogger | None = None


def get_llm_call_logger() -> LLMCallLogger:
    """获取全局默认 LLMCallLogger 单例"""
    global _default_logger
    if _default_logger is None:
        _default_logger = LLMCallLogger()
    return _default_logger
