"""
Lobster Role Manager — OpenClaw 统一运行时角色可视化管理引擎

# ──────────────────────────────────────────────────────────────────────────────
# 升级说明（2026-04-01）
# 新增：ForegroundRegistry（前台任务注册/后台化）+ run_parallel（并发角色执行）
# 灵感来源：cccback-master tools/AgentTool/AgentTool.tsx
# ──────────────────────────────────────────────────────────────────────────────

灵感来源: Manifest (github.com/mnfst/manifest)
- 借鉴其 23 维评分 + 4 层路由 + Dashboard analytics 设计思想
- 映射到 OpenClaw 统一运行时的 10 个角色面具管理体系
  （commander 编排角色 + 9 个执行角色面具）

设计原则：本模块管理的是「角色配置注册表」而非「多个独立 agent 实例」。
同一运行时可并发加载多个角色上下文，所有角色共享企业记忆。

核心功能:
1. 角色总览 (Role Overview) — 10 个角色面具的实时状态
2. 角色详情 (Role Detail) — 单角色配置、技能库、当前任务
3. 任务评分引擎 (Task Scorer) — 移植 Manifest 23 维评分 → 角色版
4. 路由历史 (Routing History) — 角色切换序列与 Commander 编排记录
5. 成本/Token 追踪 (Cost Tracker) — 按角色统计，归因到运行时调用
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# 常量：10 只龙虾身份注册表（commander + 9 只业务龙虾）
# 权威来源：lobsters-registry.json — 以下仅为 fallback 备用
# ---------------------------------------------------------------------------

# DEPRECATED: Use lobsters-registry.json instead as the single source of truth.
LOBSTER_REGISTRY: list[dict[str, Any]] = [
    {
        "id": "commander",
        "name": "元老院总脑 Commander",
        "name_en": "Commander",
        "role": "编排仲裁",
        "description": "编排整个多虾工作流、任务分解、仲裁冲突、异常处理、总结复盘",
        "tier": "frontier",
        "icon": "🏛️",
        "skills": ["commander_mission_plan", "commander_orchestrate", "commander_arbitrate",
                   "commander_exception_handle", "commander_retrospect"],
        "default_model_tier": "frontier",
    },
    {
        "id": "radar",
        "name": "触须虾 Radar",
        "name_en": "Radar",
        "role": "信号发现",
        "description": "信号发现：热点话题、竞品动态、行业舆情，输出 SignalBrief",
        "tier": "standard",
        "icon": "📡",
        "skills": ["radar_web_search", "radar_trend_analysis", "radar_hotspot_monitor",
                   "radar_competitor_track", "radar_keyword_radar"],
        "default_model_tier": "standard",
    },
    {
        "id": "strategist",
        "name": "脑虫虾 Strategist",
        "name_en": "Strategist",
        "role": "策略制定",
        "description": "策略规划：内容方向、发布节奏、预算分配、A/B 实验，输出 StrategyRoute",
        "tier": "complex",
        "icon": "🧠",
        "skills": ["strategist_goal_decompose", "strategist_platform_allocation",
                   "strategist_content_calendar", "strategist_ab_test_design",
                   "strategist_budget_suggestion", "strategist_adaptive_adjust"],
        "default_model_tier": "complex",
    },
    {
        "id": "inkwriter",
        "name": "吐墨虾 InkWriter",
        "name_en": "InkWriter",
        "role": "文案生产",
        "description": "文案创作：小红书/抖音/快手文案、话术设计、合规改写，输出 CopyPack",
        "tier": "complex",
        "icon": "✍️",
        "skills": ["inkwriter_copy_generate", "inkwriter_multiplatform_adapt",
                   "inkwriter_hashtag_gen", "inkwriter_banned_word_check", "inkwriter_dm_script"],
        "default_model_tier": "complex",
    },
    {
        "id": "visualizer",
        "name": "幻影虾 Visualizer",
        "name_en": "Visualizer",
        "role": "视觉生产",
        "description": "视觉创作：分镜脚本、图片提示词、视频字幕、封面设计，输出 StoryboardPack",
        "tier": "reasoning",
        "icon": "🎬",
        "skills": ["visualizer_storyboard", "visualizer_ai_prompt", "visualizer_image_gen",
                   "visualizer_cover_design", "visualizer_digital_human_script",
                   "visualizer_digital_human_video", "visualizer_video_edit"],
        "default_model_tier": "reasoning",
    },
    {
        "id": "dispatcher",
        "name": "点兵虾 Dispatcher",
        "name_en": "Dispatcher",
        "role": "调度执行",
        "description": "分发调度：将内容包分发到边缘节点，计算最优发布时间窗，输出 ExecutionPlan",
        "tier": "simple",
        "icon": "📦",
        "skills": ["dispatcher_task_split", "dispatcher_scheduled_publish",
                   "dispatcher_multi_account_rotate", "dispatcher_emergency_takedown"],
        "default_model_tier": "simple",
    },
    {
        "id": "echoer",
        "name": "回声虾 Echoer",
        "name_en": "Echoer",
        "role": "互动转化",
        "description": "互动承接：自动回复评论、私信、@提及，维护社区热度，输出 EngagementReplyPack",
        "tier": "standard",
        "icon": "💬",
        "skills": ["echoer_reply_generate", "echoer_comment_manage",
                   "echoer_dm_auto_reply", "echoer_wechat_funnel"],
        "default_model_tier": "standard",
    },
    {
        "id": "catcher",
        "name": "铁网虾 Catcher",
        "name_en": "Catcher",
        "role": "线索识别",
        "description": "线索捕获：评分、CRM 入库、去重、意向分级，输出 LeadAssessment",
        "tier": "standard",
        "icon": "🎯",
        "skills": ["catcher_lead_score", "catcher_crm_push", "catcher_cross_platform_dedup"],
        "default_model_tier": "standard",
    },
    {
        "id": "abacus",
        "name": "金算虾 Abacus",
        "name_en": "Abacus",
        "role": "数据分析",
        "description": "效果归因：ROI 计算、转化漏斗分析、报告生成、反馈回写策略层，输出 ValueScoreCard",
        "tier": "complex",
        "icon": "🧮",
        "skills": ["abacus_roi_calc", "abacus_multi_touch_attribution",
                   "abacus_strategy_report", "abacus_feedback_loop"],
        "default_model_tier": "complex",
    },
    {
        "id": "followup",
        "name": "回访虾 FollowUp",
        "name_en": "FollowUp",
        "role": "客户跟进",
        "description": "多触点跟进：唤醒沉默线索、推进成交、成交结果回写，输出 FollowUpActionPlan",
        "tier": "standard",
        "icon": "📞",
        "skills": ["followup_sop_generate", "followup_multi_touch", "followup_dormant_wake"],
        "default_model_tier": "standard",
    },
]


def get_lobster_registry() -> dict[str, dict[str, Any]]:
    """Read from lobsters-registry.json (single source of truth)."""
    try:
        from lifecycle_manager import get_lifecycle_manager

        return dict(get_lifecycle_manager().ensure_registry_shape().get("lobsters", {}))
    except Exception:
        return {
            item["id"]: dict(item)
            for item in LOBSTER_REGISTRY
        }


def _registry_entries() -> list[dict[str, Any]]:
    """Normalize registry to list form for analytics functions."""
    registry = get_lobster_registry()
    entries: list[dict[str, Any]] = []
    for role_id, data in registry.items():
        row = dict(data)
        row.setdefault("id", role_id)
        row.setdefault("name", f"{data.get('zh_name', role_id)} {data.get('display_name', role_id)}".strip())
        row.setdefault("name_en", data.get("display_name", role_id))
        row.setdefault("role", data.get("phase", ""))
        row.setdefault("lifecycle", data.get("lifecycle", "production"))
        row.setdefault("system", data.get("system", "follow-growth"))
        row.setdefault("annotations", data.get("annotations", {}))
        row.setdefault("icon", "🦞")
        row.setdefault("skills", [])
        row.setdefault("default_model_tier", "standard")
        entries.append(row)
    return entries

# Manifest 4 层路由映射到龙虾系统
TIER_MAP = {
    "simple": {"label": "简单任务", "color": "#22c55e", "models": "gpt-4.1-mini, deepseek-chat"},
    "standard": {"label": "标准任务", "color": "#3b82f6", "models": "gpt-4.1, claude-sonnet-4.5"},
    "complex": {"label": "复杂任务", "color": "#f59e0b", "models": "gpt-4.1, claude-opus-4"},
    "reasoning": {"label": "推理任务", "color": "#ef4444", "models": "o3, claude-opus-4"},
}

# ---------------------------------------------------------------------------
# SQLite 持久化 (类比 Manifest 的 TypeORM entities)
# ---------------------------------------------------------------------------

_DB_PATH = os.getenv("LOBSTER_POOL_DB_PATH", "./data/lobster_pool.sqlite")


def _get_db() -> sqlite3.Connection:
    db_path = Path(_DB_PATH)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def ensure_lobster_pool_schema() -> None:
    """Create tables if not exists."""
    conn = _get_db()
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS lobster_run_log (
                id          TEXT PRIMARY KEY,
                tenant_id   TEXT NOT NULL DEFAULT 'tenant_main',
                lobster_id  TEXT NOT NULL,
                trace_id    TEXT,
                user_id     TEXT,
                tier        TEXT NOT NULL DEFAULT 'standard',
                model_used  TEXT,
                input_tokens  INTEGER DEFAULT 0,
                output_tokens INTEGER DEFAULT 0,
                total_tokens  INTEGER DEFAULT 0,
                estimated_cost_cny REAL DEFAULT 0.0,
                duration_ms   INTEGER DEFAULT 0,
                status      TEXT NOT NULL DEFAULT 'success',
                score       REAL DEFAULT 0.0,
                error       TEXT,
                created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            CREATE INDEX IF NOT EXISTS idx_lobster_run_tenant
                ON lobster_run_log(tenant_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_lobster_run_lobster
                ON lobster_run_log(lobster_id, created_at);

            CREATE TABLE IF NOT EXISTS lobster_health (
                lobster_id  TEXT NOT NULL,
                tenant_id   TEXT NOT NULL DEFAULT 'tenant_main',
                status      TEXT NOT NULL DEFAULT 'healthy',
                last_run_at TEXT,
                run_count_24h   INTEGER DEFAULT 0,
                error_count_24h INTEGER DEFAULT 0,
                avg_latency_ms  REAL DEFAULT 0.0,
                total_tokens_24h INTEGER DEFAULT 0,
                total_cost_24h   REAL DEFAULT 0.0,
                updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
                PRIMARY KEY (lobster_id, tenant_id)
            );

            CREATE TABLE IF NOT EXISTS lobster_task_score (
                id          TEXT PRIMARY KEY,
                tenant_id   TEXT NOT NULL DEFAULT 'tenant_main',
                trace_id    TEXT,
                task_text   TEXT NOT NULL,
                final_tier  TEXT NOT NULL DEFAULT 'standard',
                raw_score   REAL DEFAULT 0.0,
                confidence  REAL DEFAULT 0.0,
                reason      TEXT DEFAULT 'scored',
                dimensions  TEXT DEFAULT '[]',
                routed_to   TEXT,
                created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );

            CREATE INDEX IF NOT EXISTS idx_lobster_score_tenant
                ON lobster_task_score(tenant_id, created_at);

            CREATE TABLE IF NOT EXISTS lobster_step_rewards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                lobster_id TEXT NOT NULL,
                task_id TEXT,
                step_index INTEGER NOT NULL,
                action TEXT NOT NULL,
                activity_type TEXT NOT NULL DEFAULT 'main_line',
                reward_score REAL,
                reward_reason TEXT,
                duration_ms REAL DEFAULT 0,
                tokens_used INTEGER DEFAULT 0,
                llm_call_id TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_step_rewards_lobster
                ON lobster_step_rewards(lobster_id, timestamp);
            CREATE INDEX IF NOT EXISTS idx_step_rewards_type
                ON lobster_step_rewards(activity_type);
        """)
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# 运行日志记录 (类比 Manifest 的 analytics message recording)
# ---------------------------------------------------------------------------

def record_lobster_run(
    *,
    lobster_id: str,
    tenant_id: str = "tenant_main",
    trace_id: str | None = None,
    user_id: str | None = None,
    tier: str = "standard",
    model_used: str | None = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    estimated_cost_cny: float = 0.0,
    duration_ms: int = 0,
    status: str = "success",
    score: float = 0.0,
    error: str | None = None,
) -> dict[str, Any]:
    """Record a single lobster execution run."""
    run_id = f"lr_{uuid.uuid4().hex[:12]}"
    total_tokens = input_tokens + output_tokens
    conn = _get_db()
    try:
        conn.execute(
            """INSERT INTO lobster_run_log
               (id, tenant_id, lobster_id, trace_id, user_id, tier, model_used,
                input_tokens, output_tokens, total_tokens, estimated_cost_cny,
                duration_ms, status, score, error)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                run_id, tenant_id, lobster_id, trace_id, user_id, tier,
                model_used, input_tokens, output_tokens, total_tokens,
                estimated_cost_cny, duration_ms, status, score, error,
            ),
        )
        conn.commit()
    finally:
        conn.close()
    _refresh_health(lobster_id, tenant_id)
    return {"id": run_id, "lobster_id": lobster_id, "status": status}


def record_step_rewards(lobster_id: str, task_id: str | None, steps: list[dict]) -> None:
    """Persist step reward data from a StepTracker summary to SQLite."""
    conn = _get_db()
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    try:
        for step in steps:
            conn.execute(
                """INSERT INTO lobster_step_rewards
                   (timestamp, lobster_id, task_id, step_index, action, activity_type,
                    reward_score, reward_reason, duration_ms, tokens_used, llm_call_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    now,
                    lobster_id,
                    task_id,
                    step.get("step_index", 0),
                    step.get("action", ""),
                    step.get("activity_type", "main_line"),
                    step.get("reward_score"),
                    step.get("reward_reason", ""),
                    step.get("duration_ms", 0),
                    step.get("tokens_used", 0),
                    step.get("llm_call_id"),
                ),
            )
        conn.commit()
    finally:
        conn.close()


def lobster_reward_analysis(lobster_id: str, limit: int = 100) -> dict[str, Any]:
    """Analyze per-step rewards for a specific lobster."""
    conn = _get_db()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT action, activity_type,
               COUNT(*), AVG(reward_score), MIN(reward_score), MAX(reward_score),
               AVG(duration_ms), SUM(tokens_used)
        FROM lobster_step_rewards
        WHERE lobster_id = ? AND reward_score IS NOT NULL
        GROUP BY action, activity_type
        ORDER BY AVG(reward_score) ASC
        LIMIT ?
        """,
        (lobster_id, limit),
    )
    by_action = [
        {
            "action": r[0],
            "activity_type": r[1],
            "count": r[2],
            "avg_reward": round(r[3], 3),
            "min_reward": round(r[4], 3),
            "max_reward": round(r[5], 3),
            "avg_duration_ms": round(r[6], 1),
            "total_tokens": r[7] or 0,
        }
        for r in cur.fetchall()
    ]

    cur.execute(
        """
        SELECT COUNT(*), AVG(reward_score),
               COUNT(CASE WHEN activity_type = 'main_line' THEN 1 END),
               COUNT(CASE WHEN activity_type != 'main_line' THEN 1 END)
        FROM lobster_step_rewards
        WHERE lobster_id = ?
        """,
        (lobster_id,),
    )
    row = cur.fetchone()
    conn.close()

    return {
        "lobster_id": lobster_id,
        "total_steps": row[0] or 0,
        "avg_reward": round(row[1], 3) if row[1] is not None else None,
        "main_line_count": row[2] or 0,
        "side_count": row[3] or 0,
        "by_action": by_action,
        "weakest_actions": by_action[:3] if by_action else [],
    }


def get_all_step_rewards(limit: int = 1000) -> list[dict[str, Any]]:
    """Return flat reward rows for all lobsters — used by SkillEffectivenessCalibrator."""
    conn = _get_db()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT lobster_id, task_id, action, activity_type,
               reward_score, duration_ms, tokens_used, timestamp
        FROM lobster_step_rewards
        WHERE reward_score IS NOT NULL AND activity_type = 'main_line'
        ORDER BY timestamp DESC
        LIMIT ?
        """,
        (limit,),
    )
    rows = [
        {
            "lobster_id": r[0],
            "task_id": r[1],
            "skill_id": str(r[2] or ""),   # action ~= skill_id in most calls
            "activity_type": r[3],
            "reward": float(r[4]) if r[4] is not None else 0.0,
            "duration_ms": r[5] or 0,
            "tokens_used": r[6] or 0,
            "timestamp": r[7] or "",
            "industry": "",   # not stored at step level; caller may enrich
            "channel": "",
        }
        for r in cur.fetchall()
    ]
    conn.close()
    return rows


def get_all_lobster_health() -> list[dict[str, Any]]:
    """Return health rows for all lobsters across all tenants (for /operations/monitor)."""
    conn = _get_db()
    try:
        rows = conn.execute("SELECT * FROM lobster_health ORDER BY lobster_id").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _refresh_health(lobster_id: str, tenant_id: str) -> None:
    """Update lobster_health aggregate (last 24h window)."""
    conn = _get_db()
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%SZ")
        row = conn.execute(
            """SELECT
                   COUNT(*) as run_count,
                   SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) as error_count,
                   AVG(duration_ms) as avg_latency,
                   SUM(total_tokens) as total_tokens,
                   SUM(estimated_cost_cny) as total_cost,
                   MAX(created_at) as last_run
               FROM lobster_run_log
               WHERE lobster_id = ? AND tenant_id = ? AND created_at >= ?""",
            (lobster_id, tenant_id, cutoff),
        ).fetchone()
        run_count = int(row["run_count"] or 0)
        error_count = int(row["error_count"] or 0)
        error_rate = error_count / max(run_count, 1)
        health_status = "healthy"
        if error_rate > 0.5:
            health_status = "critical"
        elif error_rate > 0.2:
            health_status = "degraded"
        elif run_count == 0:
            health_status = "idle"

        conn.execute(
            """INSERT INTO lobster_health
                   (lobster_id, tenant_id, status, last_run_at,
                    run_count_24h, error_count_24h, avg_latency_ms,
                    total_tokens_24h, total_cost_24h)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(lobster_id, tenant_id) DO UPDATE SET
                   status = excluded.status,
                   last_run_at = excluded.last_run_at,
                   run_count_24h = excluded.run_count_24h,
                   error_count_24h = excluded.error_count_24h,
                   avg_latency_ms = excluded.avg_latency_ms,
                   total_tokens_24h = excluded.total_tokens_24h,
                   total_cost_24h = excluded.total_cost_24h,
                   updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')""",
            (
                lobster_id, tenant_id, health_status,
                row["last_run"], run_count, error_count,
                float(row["avg_latency"] or 0),
                int(row["total_tokens"] or 0),
                float(row["total_cost"] or 0),
            ),
        )
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# 龙虾池总览 (类比 Manifest Overview page)
# ---------------------------------------------------------------------------

def pool_overview(tenant_id: str = "tenant_main") -> dict[str, Any]:
    """Return a Manifest-style overview of all 9 lobsters."""
    conn = _get_db()
    try:
        # Per-lobster health
        health_rows = conn.execute(
            "SELECT * FROM lobster_health WHERE tenant_id = ?", (tenant_id,)
        ).fetchall()
        health_map = {str(row["lobster_id"]): dict(row) for row in health_rows}

        # Aggregate 24h totals
        cutoff_24h = (datetime.now(timezone.utc) - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%SZ")
        agg = conn.execute(
            """SELECT
                   COUNT(*) as total_runs,
                   SUM(total_tokens) as total_tokens,
                   SUM(estimated_cost_cny) as total_cost,
                   SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) as error_count
               FROM lobster_run_log
               WHERE tenant_id = ? AND created_at >= ?""",
            (tenant_id, cutoff_24h),
        ).fetchone()

        # Hourly cost breakdown (last 24h) — like Manifest ChartCard
        hourly = conn.execute(
            """SELECT
                   strftime('%Y-%m-%dT%H:00:00Z', created_at) as hour,
                   SUM(input_tokens) as input_tokens,
                   SUM(output_tokens) as output_tokens,
                   SUM(estimated_cost_cny) as cost,
                   COUNT(*) as message_count
               FROM lobster_run_log
               WHERE tenant_id = ? AND created_at >= ?
               GROUP BY hour
               ORDER BY hour""",
            (tenant_id, cutoff_24h),
        ).fetchall()

        # Cost by model (like Manifest CostByModelTable)
        cost_by_model = conn.execute(
            """SELECT
                   model_used as model,
                   SUM(total_tokens) as tokens,
                   SUM(estimated_cost_cny) as estimated_cost,
                   COUNT(*) as run_count
               FROM lobster_run_log
               WHERE tenant_id = ? AND created_at >= ? AND model_used IS NOT NULL
               GROUP BY model_used
               ORDER BY estimated_cost DESC""",
            (tenant_id, cutoff_24h),
        ).fetchall()
    finally:
        conn.close()

    lobsters = []
    registry_entries = _registry_entries()
    for reg in registry_entries:
        health = health_map.get(reg["id"], {})
        lobsters.append({
            **reg,
            "status": health.get("status", "idle"),
            "last_run_at": health.get("last_run_at"),
            "run_count_24h": int(health.get("run_count_24h", 0) or 0),
            "error_count_24h": int(health.get("error_count_24h", 0) or 0),
            "avg_latency_ms": round(float(health.get("avg_latency_ms", 0) or 0), 1),
            "total_tokens_24h": int(health.get("total_tokens_24h", 0) or 0),
            "total_cost_24h": round(float(health.get("total_cost_24h", 0) or 0), 4),
        })

    healthy = sum(1 for l in lobsters if l["status"] == "healthy")
    degraded = sum(1 for l in lobsters if l["status"] == "degraded")
    critical = sum(1 for l in lobsters if l["status"] == "critical")
    idle = sum(1 for l in lobsters if l["status"] == "idle")

    return {
        "tenant_id": tenant_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "lobster_count": len(registry_entries),  # 应为 10（commander + 9 只业务龙虾）
            "healthy": healthy,
            "degraded": degraded,
            "critical": critical,
            "idle": idle,
            "total_runs_24h": int(agg["total_runs"] or 0),
            "total_tokens_24h": int(agg["total_tokens"] or 0),
            "total_cost_cny_24h": round(float(agg["total_cost"] or 0), 4),
            "error_count_24h": int(agg["error_count"] or 0),
            "error_rate_24h": round(
                int(agg["error_count"] or 0) / max(int(agg["total_runs"] or 0), 1), 4
            ),
        },
        "lobsters": lobsters,
        "token_usage": [dict(row) for row in hourly],
        "cost_by_model": [dict(row) for row in cost_by_model],
        "tier_map": TIER_MAP,
    }


# ---------------------------------------------------------------------------
# 单虾详情 + 最近运行 (类比 Manifest Agent detail + MessageLog)
# ---------------------------------------------------------------------------

def lobster_detail(
    lobster_id: str,
    tenant_id: str = "tenant_main",
    limit: int = 50,
) -> dict[str, Any]:
    """Return detail for a single lobster including recent runs."""
    reg = next((r for r in _registry_entries() if r["id"] == lobster_id), None)
    if reg is None:
        return {"ok": False, "error": "lobster_not_found"}

    conn = _get_db()
    try:
        health = conn.execute(
            "SELECT * FROM lobster_health WHERE lobster_id = ? AND tenant_id = ?",
            (lobster_id, tenant_id),
        ).fetchone()
        recent = conn.execute(
            """SELECT * FROM lobster_run_log
               WHERE lobster_id = ? AND tenant_id = ?
               ORDER BY created_at DESC LIMIT ?""",
            (lobster_id, tenant_id, limit),
        ).fetchall()

        # Hourly breakdown for this lobster
        cutoff_24h = (datetime.now(timezone.utc) - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%SZ")
        hourly = conn.execute(
            """SELECT
                   strftime('%Y-%m-%dT%H:00:00Z', created_at) as hour,
                   SUM(input_tokens) as input_tokens,
                   SUM(output_tokens) as output_tokens,
                   SUM(estimated_cost_cny) as cost,
                   COUNT(*) as count
               FROM lobster_run_log
               WHERE lobster_id = ? AND tenant_id = ? AND created_at >= ?
               GROUP BY hour ORDER BY hour""",
            (lobster_id, tenant_id, cutoff_24h),
        ).fetchall()
    finally:
        conn.close()

    return {
        "ok": True,
        "lobster": {
            **reg,
            "status": dict(health).get("status", "idle") if health else "idle",
            "run_count_24h": int(dict(health).get("run_count_24h", 0) or 0) if health else 0,
            "error_count_24h": int(dict(health).get("error_count_24h", 0) or 0) if health else 0,
            "avg_latency_ms": round(float(dict(health).get("avg_latency_ms", 0) or 0), 1) if health else 0,
            "total_tokens_24h": int(dict(health).get("total_tokens_24h", 0) or 0) if health else 0,
            "total_cost_24h": round(float(dict(health).get("total_cost_24h", 0) or 0), 4) if health else 0,
        },
        "recent_runs": [dict(row) for row in recent],
        "hourly_usage": [dict(row) for row in hourly],
    }


def list_lobster_runs_paginated(
    *,
    tenant_id: str = "tenant_main",
    lobster_id: str | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = 20,
    sort_by: str = "created_at",
    sort_dir: str = "desc",
) -> dict[str, Any]:
    """Return paginated lobster run records."""
    safe_page = max(1, int(page or 1))
    safe_page_size = max(1, min(int(page_size or 20), 200))
    offset = (safe_page - 1) * safe_page_size
    allowed_sort = {
        "created_at": "created_at",
        "lobster_id": "lobster_id",
        "status": "status",
        "duration_ms": "duration_ms",
        "estimated_cost_cny": "estimated_cost_cny",
        "total_tokens": "total_tokens",
        "score": "score",
    }
    order_col = allowed_sort.get(str(sort_by or "").strip(), "created_at")
    order_dir = "ASC" if str(sort_dir or "").strip().lower() == "asc" else "DESC"

    conn = _get_db()
    try:
        query = "FROM lobster_run_log WHERE tenant_id = ?"
        params: list[Any] = [tenant_id]
        if lobster_id:
            query += " AND lobster_id = ?"
            params.append(lobster_id)
        if status:
            query += " AND status = ?"
            params.append(status)

        total_row = conn.execute(f"SELECT COUNT(*) AS total {query}", params).fetchone()
        rows = conn.execute(
            f"SELECT * {query} ORDER BY {order_col} {order_dir}, created_at DESC LIMIT ? OFFSET ?",
            [*params, safe_page_size, offset],
        ).fetchall()
    finally:
        conn.close()

    total = int(total_row["total"] or 0) if total_row else 0
    items = [dict(row) for row in rows]
    return {
        "items": items,
        "total": total,
        "page": safe_page,
        "page_size": safe_page_size,
        "total_pages": max(1, (total + safe_page_size - 1) // safe_page_size),
    }


# ---------------------------------------------------------------------------
# 任务评分引擎 (简化版 Manifest 23 维 Scorer)
# ---------------------------------------------------------------------------

# 从 Manifest scoring/dimensions 移植核心 10 维
SCORING_DIMENSIONS = [
    {"name": "keyword_complexity", "weight": 0.15, "description": "任务描述中的复杂度关键词"},
    {"name": "token_count", "weight": 0.12, "description": "输入文本长度 (token 估算)"},
    {"name": "competitor_count", "weight": 0.10, "description": "竞品对标数量"},
    {"name": "edge_target_count", "weight": 0.10, "description": "边缘节点数量"},
    {"name": "industry_specificity", "weight": 0.08, "description": "行业专业度"},
    {"name": "constraint_density", "weight": 0.08, "description": "约束条件密度"},
    {"name": "tool_usage", "weight": 0.10, "description": "需要调用的工具数量"},
    {"name": "conversation_depth", "weight": 0.07, "description": "对话深度/轮数"},
    {"name": "risk_level", "weight": 0.12, "description": "风险等级 (P0-P3)"},
    {"name": "creativity_demand", "weight": 0.08, "description": "创意需求程度"},
]

# 复杂度关键词 (来自 Manifest 的 keyword-trie 思路)
COMPLEXITY_KEYWORDS = {
    "simple": ["查询", "列表", "状态", "你好", "帮我看", "是什么"],
    "standard": ["分析", "对比", "总结", "报告", "策略", "优化"],
    "complex": ["全自动", "批量", "多平台", "跨渠道", "深度分析", "全链路"],
    "reasoning": ["推理", "仿真", "预演", "因果分析", "博弈", "多步推导"],
}


def score_task(
    *,
    task_description: str,
    competitor_count: int = 0,
    edge_target_count: int = 0,
    industry_tag: str | None = None,
    tool_count: int = 0,
    conversation_depth: int = 1,
    risk_level: str = "P2",
    tenant_id: str = "tenant_main",
    trace_id: str | None = None,
) -> dict[str, Any]:
    """
    Score a task using a simplified Manifest-style multi-dimension scorer.
    Returns tier (simple/standard/complex/reasoning), score, confidence, and dimension breakdown.
    """
    text = task_description.lower()
    text_len = len(task_description)

    dimensions: list[dict[str, Any]] = []

    # 1. Keyword complexity
    kw_score = 0.0
    matched_keywords: list[str] = []
    for tier_name, keywords in COMPLEXITY_KEYWORDS.items():
        for kw in keywords:
            if kw in text:
                matched_keywords.append(kw)
                tier_val = {"simple": -0.3, "standard": 0.0, "complex": 0.4, "reasoning": 0.8}
                kw_score = max(kw_score, tier_val.get(tier_name, 0.0))
    dimensions.append({"name": "keyword_complexity", "raw": kw_score, "matched": matched_keywords})

    # 2. Token count (text length proxy)
    token_est = text_len / 4
    tc_score = min(1.0, token_est / 2000)
    dimensions.append({"name": "token_count", "raw": tc_score, "token_est": int(token_est)})

    # 3. Competitor count
    cc_score = min(1.0, competitor_count / 10)
    dimensions.append({"name": "competitor_count", "raw": cc_score, "value": competitor_count})

    # 4. Edge target count
    et_score = min(1.0, edge_target_count / 10)
    dimensions.append({"name": "edge_target_count", "raw": et_score, "value": edge_target_count})

    # 5. Industry specificity
    ind_score = 0.3 if industry_tag and industry_tag != "general" else 0.0
    dimensions.append({"name": "industry_specificity", "raw": ind_score, "tag": industry_tag})

    # 6. Constraint density (count of constraints in text)
    constraints = sum(1 for phrase in ["必须", "不能", "限制", "要求", "确保", "禁止", "最多", "至少"] if phrase in text)
    cd_score = min(1.0, constraints / 5)
    dimensions.append({"name": "constraint_density", "raw": cd_score, "count": constraints})

    # 7. Tool usage
    tu_score = min(1.0, tool_count / 5)
    dimensions.append({"name": "tool_usage", "raw": tu_score, "value": tool_count})

    # 8. Conversation depth
    cv_score = min(1.0, (conversation_depth - 1) / 10)
    dimensions.append({"name": "conversation_depth", "raw": cv_score, "value": conversation_depth})

    # 9. Risk level
    risk_map = {"P0": 1.0, "P1": 0.7, "P2": 0.4, "P3": 0.1}
    rl_score = risk_map.get(risk_level, 0.4)
    dimensions.append({"name": "risk_level", "raw": rl_score, "level": risk_level})

    # 10. Creativity demand
    creative_keywords = ["创意", "灵感", "新颖", "独特", "差异化", "viral", "爆款", "出圈"]
    cr_count = sum(1 for kw in creative_keywords if kw in text)
    cr_score = min(1.0, cr_count / 3)
    dimensions.append({"name": "creativity_demand", "raw": cr_score, "count": cr_count})

    # Weighted score
    weights = {d["name"]: d["weight"] for d in SCORING_DIMENSIONS}
    raw_score = sum(dim["raw"] * weights.get(dim["name"], 0.1) for dim in dimensions)

    # Tier assignment (Manifest sigmoid-based boundaries)
    if raw_score < 0.15:
        tier = "simple"
    elif raw_score < 0.35:
        tier = "standard"
    elif raw_score < 0.55:
        tier = "complex"
    else:
        tier = "reasoning"

    # Confidence (distance from nearest boundary)
    boundaries = [0.15, 0.35, 0.55]
    min_dist = min(abs(raw_score - b) for b in boundaries)
    confidence = min(0.98, 0.5 + min_dist * 3)

    # Best lobster match for this tier
    registry_entries = _registry_entries()
    tier_lobsters = [l for l in registry_entries if l["default_model_tier"] == tier]
    routed_to = tier_lobsters[0]["id"] if tier_lobsters else "strategist"

    # Persist score
    score_id = f"ls_{uuid.uuid4().hex[:12]}"
    conn = _get_db()
    try:
        conn.execute(
            """INSERT INTO lobster_task_score
                   (id, tenant_id, trace_id, task_text, final_tier, raw_score,
                    confidence, reason, dimensions, routed_to)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                score_id, tenant_id, trace_id,
                task_description[:500], tier, round(raw_score, 4),
                round(confidence, 4), "scored",
                json.dumps(dimensions, ensure_ascii=False),
                routed_to,
            ),
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "ok": True,
        "score_id": score_id,
        "tier": tier,
        "tier_info": TIER_MAP.get(tier, {}),
        "raw_score": round(raw_score, 4),
        "confidence": round(confidence, 4),
        "reason": "scored",
        "routed_to": routed_to,
        "routed_lobster": next((l for l in registry_entries if l["id"] == routed_to), None),
        "dimensions": dimensions,
        "dimension_weights": SCORING_DIMENSIONS,
    }


# ---------------------------------------------------------------------------
# 路由历史查询 (类比 Manifest MessageLog)
# ---------------------------------------------------------------------------

def routing_history(
    tenant_id: str = "tenant_main",
    lobster_id: str | None = None,
    tier: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Query recent scoring/routing records."""
    conn = _get_db()
    try:
        query = "SELECT * FROM lobster_task_score WHERE tenant_id = ?"
        params: list[Any] = [tenant_id]
        if lobster_id:
            query += " AND routed_to = ?"
            params.append(lobster_id)
        if tier:
            query += " AND final_tier = ?"
            params.append(tier)
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        rows = conn.execute(query, params).fetchall()
        result = []
        for row in rows:
            d = dict(row)
            if isinstance(d.get("dimensions"), str):
                try:
                    d["dimensions"] = json.loads(d["dimensions"])
                except json.JSONDecodeError:
                    pass
            result.append(d)
        return result
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# 成本追踪 metrics (类比 Manifest analytics dashboard)
# ---------------------------------------------------------------------------

def pool_metrics(
    tenant_id: str = "tenant_main",
    range_hours: int = 24,
    granularity: str = "hour",
) -> dict[str, Any]:
    """Return time-series metrics for the lobster pool."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=range_hours)).strftime("%Y-%m-%dT%H:%M:%SZ")
    time_fmt = "%Y-%m-%dT%H:00:00Z" if granularity == "hour" else "%Y-%m-%d"
    conn = _get_db()
    try:
        # Token usage over time
        token_usage = conn.execute(
            f"""SELECT
                   strftime('{time_fmt}', created_at) as period,
                   SUM(input_tokens) as input_tokens,
                   SUM(output_tokens) as output_tokens
               FROM lobster_run_log
               WHERE tenant_id = ? AND created_at >= ?
               GROUP BY period ORDER BY period""",
            (tenant_id, cutoff),
        ).fetchall()

        # Cost over time
        cost_usage = conn.execute(
            f"""SELECT
                   strftime('{time_fmt}', created_at) as period,
                   SUM(estimated_cost_cny) as cost
               FROM lobster_run_log
               WHERE tenant_id = ? AND created_at >= ?
               GROUP BY period ORDER BY period""",
            (tenant_id, cutoff),
        ).fetchall()

        # Message count over time
        message_usage = conn.execute(
            f"""SELECT
                   strftime('{time_fmt}', created_at) as period,
                   COUNT(*) as count
               FROM lobster_run_log
               WHERE tenant_id = ? AND created_at >= ?
               GROUP BY period ORDER BY period""",
            (tenant_id, cutoff),
        ).fetchall()

        # By lobster breakdown
        by_lobster = conn.execute(
            """SELECT
                   lobster_id,
                   COUNT(*) as runs,
                   SUM(total_tokens) as tokens,
                   SUM(estimated_cost_cny) as cost,
                   AVG(duration_ms) as avg_latency
               FROM lobster_run_log
               WHERE tenant_id = ? AND created_at >= ?
               GROUP BY lobster_id
               ORDER BY cost DESC""",
            (tenant_id, cutoff),
        ).fetchall()

        # By tier breakdown
        by_tier = conn.execute(
            """SELECT
                   tier,
                   COUNT(*) as runs,
                   SUM(total_tokens) as tokens,
                   SUM(estimated_cost_cny) as cost
               FROM lobster_run_log
               WHERE tenant_id = ? AND created_at >= ?
               GROUP BY tier
               ORDER BY cost DESC""",
            (tenant_id, cutoff),
        ).fetchall()
    finally:
        conn.close()

    return {
        "tenant_id": tenant_id,
        "range_hours": range_hours,
        "granularity": granularity,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "token_usage": [dict(r) for r in token_usage],
        "cost_usage": [dict(r) for r in cost_usage],
        "message_usage": [dict(r) for r in message_usage],
        "by_lobster": [dict(r) for r in by_lobster],
        "by_tier": [dict(r) for r in by_tier],
    }


# ---------------------------------------------------------------------------
# ★ 新增：TaskNotification — 龙虾任务完成标准通知格式
# 灵感来源：cccback-master coordinator/coordinatorMode.ts <task-notification>
# ---------------------------------------------------------------------------

import asyncio
import xml.etree.ElementTree as ET
from dataclasses import dataclass as _dc
from typing import Literal


@_dc
class TaskNotification:
    """
    龙虾任务完成的标准通知格式。
    可序列化为 XML（供 commander 解析）或 dict（供 API 返回）。

    仿 cccback <task-notification> XML 格式：
      <task-notification>
        <task-id>...</task-id>
        <status>completed|failed|killed</status>
        <summary>...</summary>
        <result>...</result>
        <usage>
          <total_tokens>...</total_tokens>
          <tool_uses>...</tool_uses>
          <duration_ms>...</duration_ms>
        </usage>
      </task-notification>
    """
    task_id: str
    status: Literal["completed", "failed", "killed"]
    summary: str
    result: str
    total_tokens: int
    tool_uses: int
    duration_ms: int
    lobster_id: str = ""

    def to_xml(self) -> str:
        """序列化为 XML 字符串（commander 解析专用）"""
        return (
            f"<task-notification>\n"
            f"<task-id>{self.task_id}</task-id>\n"
            f"<status>{self.status}</status>\n"
            f"<summary>{self.summary}</summary>\n"
            f"<result>{self.result}</result>\n"
            f"<usage>\n"
            f"  <total_tokens>{self.total_tokens}</total_tokens>\n"
            f"  <tool_uses>{self.tool_uses}</tool_uses>\n"
            f"  <duration_ms>{self.duration_ms}</duration_ms>\n"
            f"</usage>\n"
            f"</task-notification>"
        )

    def to_commander_message(self) -> dict[str, Any]:
        """转换为 LangGraph user 消息，注入 commander 上下文"""
        return {
            "role": "user",
            "content": self.to_xml(),
            "metadata": {
                "is_task_notification": True,
                "task_id": self.task_id,
                "status": self.status,
                "lobster_id": self.lobster_id,
            },
        }

    def to_dict(self) -> dict[str, Any]:
        """转换为 dict（供 REST API 返回）"""
        return {
            "task_id": self.task_id,
            "lobster_id": self.lobster_id,
            "status": self.status,
            "summary": self.summary,
            "result": self.result,
            "total_tokens": self.total_tokens,
            "tool_uses": self.tool_uses,
            "duration_ms": self.duration_ms,
        }

    @classmethod
    def from_xml(cls, xml_str: str) -> "TaskNotification":
        """从 XML 字符串反序列化"""
        root = ET.fromstring(xml_str.strip())
        usage = root.find("usage") or ET.Element("usage")
        return cls(
            task_id=root.findtext("task-id") or "",
            status=root.findtext("status") or "completed",  # type: ignore[arg-type]
            summary=root.findtext("summary") or "",
            result=root.findtext("result") or "",
            total_tokens=int(usage.findtext("total_tokens") or 0),
            tool_uses=int(usage.findtext("tool_uses") or 0),
            duration_ms=int(usage.findtext("duration_ms") or 0),
        )


def is_task_notification_message(message: dict[str, Any]) -> bool:
    """检测一条消息是否是 task-notification（供 commander 路由判断）"""
    metadata = message.get("metadata") or {}
    if metadata.get("is_task_notification"):
        return True
    content = str(message.get("content", ""))
    return "<task-notification>" in content and "</task-notification>" in content


# ---------------------------------------------------------------------------
# ★ 新增：LobsterForegroundRegistry — 前台任务注册 + 热迁移到后台
# 灵感来源：cccback-master registerAgentForeground / background signal
# ---------------------------------------------------------------------------

@_dc
class ForegroundTask:
    """正在前台运行的龙虾任务记录"""
    run_id: str
    lobster_id: str
    description: str
    started_at: float
    # asyncio.Event 用于触发后台化
    background_event: "asyncio.Event | None" = None
    cancel_event: "asyncio.Event | None" = None

    def __post_init__(self):
        if self.background_event is None:
            self.background_event = asyncio.Event()
        if self.cancel_event is None:
            self.cancel_event = asyncio.Event()

    def elapsed_sec(self) -> float:
        return time.monotonic() - self.started_at


class LobsterForegroundRegistry:
    """
    前台任务注册表，支持热迁移到后台。
    仿 cccback registerAgentForeground / unregisterAgentForeground。

    使用方式：
        registry = LobsterForegroundRegistry()
        fg = registry.register("run-abc", "dispatcher", "发布账号A早间帖子")
        # ... 启动龙虾 ...
        registry.background_one("run-abc")   # 用户点击"后台化"
        registry.background_all()            # 用户按 ESC
        registry.unregister("run-abc")       # 任务完成后清理
    """

    def __init__(self) -> None:
        self._tasks: dict[str, ForegroundTask] = {}

    def register(
        self,
        run_id: str,
        lobster_id: str,
        description: str,
    ) -> ForegroundTask:
        """注册新的前台任务"""
        task = ForegroundTask(
            run_id=run_id,
            lobster_id=lobster_id,
            description=description,
            started_at=time.monotonic(),
        )
        self._tasks[run_id] = task
        return task

    def background_one(self, run_id: str) -> bool:
        """将指定任务推到后台，返回是否成功"""
        if task := self._tasks.get(run_id):
            if task.background_event:
                task.background_event.set()
            return True
        return False

    def background_all(self) -> int:
        """将所有前台任务一键推到后台，返回后台化数量"""
        count = 0
        for task in self._tasks.values():
            if task.background_event and not task.background_event.is_set():
                task.background_event.set()
                count += 1
        return count

    def cancel(self, run_id: str) -> bool:
        """取消指定任务"""
        if task := self._tasks.get(run_id):
            if task.cancel_event:
                task.cancel_event.set()
            return True
        return False

    def unregister(self, run_id: str) -> None:
        """任务完成后注销"""
        self._tasks.pop(run_id, None)

    def list_foreground(self) -> list[ForegroundTask]:
        """列出当前所有前台任务"""
        return list(self._tasks.values())

    def to_dict_list(self) -> list[dict[str, Any]]:
        """供 REST API 返回"""
        return [
            {
                "run_id": t.run_id,
                "lobster_id": t.lobster_id,
                "description": t.description,
                "elapsed_sec": round(t.elapsed_sec(), 1),
                "is_backgrounded": bool(t.background_event and t.background_event.is_set()),
            }
            for t in self._tasks.values()
        ]


# 全局单例（供 app.py 直接使用）
_global_foreground_registry: LobsterForegroundRegistry | None = None
_global_notification_queue: "asyncio.Queue[TaskNotification] | None" = None


def get_foreground_registry() -> LobsterForegroundRegistry:
    """获取全局前台任务注册表单例"""
    global _global_foreground_registry
    if _global_foreground_registry is None:
        _global_foreground_registry = LobsterForegroundRegistry()
    return _global_foreground_registry


def get_notification_queue() -> "asyncio.Queue[TaskNotification]":
    global _global_notification_queue
    if _global_notification_queue is None:
        _global_notification_queue = asyncio.Queue()
    return _global_notification_queue


# ---------------------------------------------------------------------------
# ★ 新增：run_parallel — 并行执行多个龙虾任务
# 灵感来源：cccback AgentTool 多实例并发模型
# 核心原则：并行是你的超能力（Parallelism is your superpower）
# ---------------------------------------------------------------------------

@_dc
class LobsterTask:
    """并行执行的龙虾任务规格"""
    lobster_id: str
    prompt: str
    description: str
    run_id: str = ""
    meta: "dict[str, Any] | None" = None

    def __post_init__(self):
        if not self.run_id:
            self.run_id = f"run-{uuid.uuid4().hex[:8]}"


# ─────────────────────────────────────────────────────────────────
# ★ 全局龙虾池并发上限（借鉴 MPT max_concurrent_tasks 设计）
# 防止高并发时 LLM 费用失控 / API 限速
# 通过环境变量 LOBSTER_POOL_MAX_CONCURRENT 配置，默认 5
# ─────────────────────────────────────────────────────────────────

_GLOBAL_POOL_MAX_CONCURRENT: int = int(os.getenv("LOBSTER_POOL_MAX_CONCURRENT", "5"))
_global_pool_semaphore: asyncio.Semaphore | None = None


def get_pool_semaphore() -> asyncio.Semaphore:
    """
    获取全局龙虾池并发信号量（单例）。
    限制整个池子同时运行的龙虾任务数，防止 LLM 费用失控。
    环境变量：LOBSTER_POOL_MAX_CONCURRENT（默认 5）
    """
    global _global_pool_semaphore
    if _global_pool_semaphore is None:
        _global_pool_semaphore = asyncio.Semaphore(_GLOBAL_POOL_MAX_CONCURRENT)
    return _global_pool_semaphore


def get_pool_max_concurrent() -> int:
    """返回当前全局并发上限配置值（用于状态展示）。"""
    return _GLOBAL_POOL_MAX_CONCURRENT


async def run_parallel(
    tasks: list[LobsterTask],
    runner: Any,
    max_concurrent: int | None = None,
    notification_queue: "asyncio.Queue | None" = None,
) -> list[TaskNotification]:
    """
    并行执行多个龙虾任务（仿 cccback AgentTool 多实例并发）。

    Args:
        tasks:              龙虾任务列表（每个包含 lobster_id + prompt）
        runner:             LobsterRunner 实例
        max_concurrent:     本次调用最大并发数（None=使用全局池上限）
                            注意：实际并发 = min(max_concurrent, 全局池上限)
                            全局池上限由 LOBSTER_POOL_MAX_CONCURRENT 环境变量控制（默认5）
        notification_queue: 可选 asyncio.Queue，完成时推送通知

    Returns:
        按完成顺序返回的 TaskNotification 列表

    用法示例：
        tasks = [
            LobsterTask("dispatcher", "发布账号A早间帖子", "发布A"),
            LobsterTask("dispatcher", "发布账号B早间帖子", "发布B"),
            LobsterTask("radar", "分析今日热点话题", "情报"),
        ]
        notifications = await run_parallel(tasks, runner, max_concurrent=3)
        # 所有任务并行执行，最多 min(3, LOBSTER_POOL_MAX_CONCURRENT) 个同时运行
    """
    from lobster_runner import LobsterRunSpec

    # 全局池信号量 × 本次调用上限，取较小值
    global_limit = _GLOBAL_POOL_MAX_CONCURRENT
    call_limit = max_concurrent if max_concurrent is not None else global_limit
    effective_limit = min(call_limit, global_limit)
    semaphore = asyncio.Semaphore(effective_limit)

    async def _run_one(task: LobsterTask) -> TaskNotification:
        async with semaphore:
            start_ms = int(time.time() * 1000)
            try:
                spec = LobsterRunSpec(
                    role_id=task.lobster_id,
                    system_prompt="",   # LobsterRunner 会从 lobster 对象加载
                    user_prompt=task.prompt,
                    meta=task.meta or {"task_id": task.run_id},
                )
                result = await runner.run(spec)
                duration = int(time.time() * 1000) - start_ms
                notification = TaskNotification(
                    task_id=task.run_id,
                    lobster_id=task.lobster_id,
                    status="completed" if not result.error else "failed",
                    summary=(
                        f"{task.description} 完成"
                        if not result.error
                        else f"{task.description} 失败：{result.error}"
                    ),
                    result=result.final_content or "",
                    total_tokens=sum(result.usage.values()),
                    tool_uses=len(result.tools_used),
                    duration_ms=duration,
                )
            except Exception as e:
                duration = int(time.time() * 1000) - start_ms
                notification = TaskNotification(
                    task_id=task.run_id,
                    lobster_id=task.lobster_id,
                    status="failed",
                    summary=f"{task.description} 异常：{str(e)[:200]}",
                    result="",
                    total_tokens=0,
                    tool_uses=0,
                    duration_ms=duration,
                )

            if notification_queue is not None:
                await notification_queue.put(notification)

            return notification

    results = await asyncio.gather(*[_run_one(t) for t in tasks])
    return list(results)


# ---------------------------------------------------------------------------
# ★ 新增：AsyncLaunchedResult — 后台化任务的立即返回结果
# ---------------------------------------------------------------------------

@_dc
class AsyncLaunchedResult:
    """
    龙虾被热迁移到后台时的立即返回结果。
    调用方收到此对象后无需等待，完成后通过 notification_queue 获取通知。
    """
    run_id: str
    lobster_id: str
    description: str
    launched_at: float = 0.0

    def __post_init__(self):
        if not self.launched_at:
            self.launched_at = time.time()

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "async_launched",
            "run_id": self.run_id,
            "lobster_id": self.lobster_id,
            "description": self.description,
            "launched_at": self.launched_at,
            "message": f"龙虾 {self.lobster_id} 已在后台启动，完成后将推送通知。",
        }
