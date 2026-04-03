"""
ArtifactStore — 龙虾产出物统一仓库
=====================================
解决的问题：
  inkwriter 写完文案放哪里？
  visualizer 做完图放哪里？
  radar 发出情报包存哪里？
  → 统一存这里，按 run_id + lobster 可查可追溯

设计原则：
  - 每次龙虾完成一个任务步骤，必须调用 artifact_store.save()
  - 产出物保存后，自动通过 webhook_event_bus 触发下游龙虾
  - 所有产出物可通过 Dashboard API 查询展示

artifact_type 枚举：
  intel        → radar 的情报包
  brief        → strategist 的策略brief
  copy         → inkwriter 的文案（含多版本）
  visual_brief → inkwriter 给 visualizer 的视觉brief
  visual       → visualizer 的封面/视频产出
  publish_plan → dispatcher 的发布计划
  publish_result → dispatcher 的发布结果（含URL）
  echo_report  → echoer 的评论监控报告
  lead_package → catcher 的线索移交包
  followup_log → followup 的跟进记录
  analysis     → abacus 的数据分析报告
  workflow_summary → commander 的任务总结

使用示例：
    from artifact_store import get_artifact_store

    store = get_artifact_store()

    # 龙虾保存产出物
    artifact_id = store.save(
        run_id="run-abc123",
        lobster="inkwriter",
        artifact_type="copy",
        content="标题：25岁女生的第一支口红...",
        meta={"platform": "douyin", "version": 2, "hook_type": "情绪共鸣"}
    )

    # 查询某个任务的所有产出物
    artifacts = store.list_by_run("run-abc123")

    # 查询某只龙虾的所有产出物
    artifacts = store.list_by_lobster("inkwriter", limit=20)

    # 获取某个产出物详情
    artifact = store.get(artifact_id)
"""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


_DB_PATH = os.getenv("ARTIFACT_STORE_DB", "./data/artifact_store.sqlite")

# 合法的 artifact_type 列表
ARTIFACT_TYPES = {
    "intel",           # radar → 情报包
    "brief",           # strategist → 策略brief
    "copy",            # inkwriter → 文案
    "visual_brief",    # inkwriter → 给visualizer的视觉brief
    "visual",          # visualizer → 封面/视频
    "publish_plan",    # dispatcher → 发布计划
    "publish_result",  # dispatcher → 发布结果（含URL）
    "echo_report",     # echoer → 评论监控报告
    "lead_package",    # catcher → 线索移交包
    "followup_log",    # followup → 跟进记录
    "analysis",        # abacus → 数据分析报告
    "workflow_summary",# commander → 任务总结
    "checklist",       # 任意龙虾 → 自检清单结果
    "battle_log_entry",# 任意龙虾 → 失败复盘记录
    "other",           # 其他
}


class ArtifactRecord:
    """单条产出物记录"""

    def __init__(self, row: dict) -> None:
        self.artifact_id   = row["artifact_id"]
        self.run_id        = row["run_id"]
        self.lobster       = row["lobster"]
        self.artifact_type = row["artifact_type"]
        self.content       = row["content"]
        self.content_url   = row.get("content_url", "")   # 大文件的外部URL
        self.step_index    = row.get("step_index")
        self.version       = row.get("version", 1)
        self.status        = row.get("status", "draft")   # draft/approved/rejected/published
        self.score         = row.get("score")              # 质量评分（0-100）
        self.reviewer      = row.get("reviewer", "")       # 谁评审的
        self.review_note   = row.get("review_note", "")
        self.meta          = json.loads(row.get("meta", "{}") or "{}")
        self.created_at    = row.get("created_at", "")
        self.updated_at    = row.get("updated_at", "")

    def to_dict(self) -> dict[str, Any]:
        return {
            "artifact_id":   self.artifact_id,
            "run_id":        self.run_id,
            "lobster":       self.lobster,
            "artifact_type": self.artifact_type,
            "content":       self.content,
            "content_url":   self.content_url,
            "step_index":    self.step_index,
            "version":       self.version,
            "status":        self.status,
            "score":         self.score,
            "reviewer":      self.reviewer,
            "review_note":   self.review_note,
            "meta":          self.meta,
            "created_at":    self.created_at,
            "updated_at":    self.updated_at,
        }

    def to_summary(self) -> dict[str, Any]:
        """轻量摘要（Dashboard列表用，不含完整content）"""
        return {
            "artifact_id":   self.artifact_id,
            "run_id":        self.run_id,
            "lobster":       self.lobster,
            "artifact_type": self.artifact_type,
            "content_preview": (self.content or "")[:200],
            "content_url":   self.content_url,
            "step_index":    self.step_index,
            "version":       self.version,
            "status":        self.status,
            "score":         self.score,
            "created_at":    self.created_at,
        }


class ArtifactStore:
    """
    龙虾产出物统一仓库。
    每次龙虾完成步骤后必须调用 save()，不调用 = 产出物不存在。
    """

    def __init__(self, db_path: str = _DB_PATH) -> None:
        self._db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _ensure_schema(self) -> None:
        conn = self._conn()
        try:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS artifacts (
                    artifact_id   TEXT PRIMARY KEY,
                    run_id        TEXT NOT NULL,
                    lobster       TEXT NOT NULL,
                    artifact_type TEXT NOT NULL,
                    content       TEXT DEFAULT '',
                    content_url   TEXT DEFAULT '',
                    step_index    INTEGER,
                    version       INTEGER DEFAULT 1,
                    status        TEXT DEFAULT 'draft',
                    score         REAL,
                    reviewer      TEXT DEFAULT '',
                    review_note   TEXT DEFAULT '',
                    meta          TEXT DEFAULT '{}',
                    created_at    TEXT NOT NULL,
                    updated_at    TEXT NOT NULL
                );

                -- 按任务查所有产出物
                CREATE INDEX IF NOT EXISTS idx_art_run
                    ON artifacts(run_id, created_at DESC);

                -- 按龙虾查产出物
                CREATE INDEX IF NOT EXISTS idx_art_lobster
                    ON artifacts(lobster, created_at DESC);

                -- 按类型查产出物
                CREATE INDEX IF NOT EXISTS idx_art_type
                    ON artifacts(artifact_type, created_at DESC);

                -- 按状态过滤（待审/已批准/已发布）
                CREATE INDEX IF NOT EXISTS idx_art_status
                    ON artifacts(status, created_at DESC);

                -- 产出物关联表（记录哪个产出物触发了哪个下游产出物）
                CREATE TABLE IF NOT EXISTS artifact_lineage (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    from_artifact TEXT NOT NULL,
                    to_artifact   TEXT NOT NULL,
                    relation      TEXT DEFAULT 'triggers',  -- triggers/refines/replaces
                    created_at    TEXT NOT NULL,
                    FOREIGN KEY (from_artifact) REFERENCES artifacts(artifact_id),
                    FOREIGN KEY (to_artifact) REFERENCES artifacts(artifact_id)
                );
                CREATE INDEX IF NOT EXISTS idx_lineage_from
                    ON artifact_lineage(from_artifact);
                CREATE INDEX IF NOT EXISTS idx_lineage_to
                    ON artifact_lineage(to_artifact);
            """)
            conn.commit()
        finally:
            conn.close()

    # ── 写入 ─────────────────────────────────────────────────────

    def save(
        self,
        run_id: str,
        lobster: str,
        artifact_type: str,
        content: str = "",
        content_url: str = "",
        step_index: Optional[int] = None,
        version: int = 1,
        status: str = "draft",
        meta: Optional[dict] = None,
        triggered_by: Optional[str] = None,  # 上游 artifact_id
    ) -> str:
        """
        保存龙虾产出物。
        返回 artifact_id。

        参数：
            run_id        工作流运行ID
            lobster       产出龙虾名（如 "inkwriter"）
            artifact_type 产出物类型（见 ARTIFACT_TYPES）
            content       产出物内容（文本）
            content_url   大文件的外部URL（图片/视频）
            step_index    工作流步骤序号
            version       版本号（同一任务多版本时递增）
            status        状态：draft/approved/rejected/published
            meta          扩展元信息（平台/行业/钩子类型等）
            triggered_by  上游产出物ID（用于lineage追踪）
        """
        if artifact_type not in ARTIFACT_TYPES:
            artifact_type = "other"

        artifact_id = f"art_{uuid.uuid4().hex[:12]}"
        now = self._now()
        conn = self._conn()
        try:
            conn.execute(
                """INSERT INTO artifacts
                   (artifact_id, run_id, lobster, artifact_type, content, content_url,
                    step_index, version, status, meta, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    artifact_id, run_id, lobster, artifact_type,
                    (content or "")[:50000],  # 截断超长内容
                    content_url or "",
                    step_index, version, status,
                    json.dumps(meta or {}, ensure_ascii=False),
                    now, now,
                )
            )
            # 记录lineage
            if triggered_by:
                conn.execute(
                    """INSERT INTO artifact_lineage (from_artifact, to_artifact, created_at)
                       VALUES (?, ?, ?)""",
                    (triggered_by, artifact_id, now)
                )
            conn.commit()
        finally:
            conn.close()

        # 触发事件总线（如果有 webhook_event_bus 在运行）
        self._emit_artifact_created(artifact_id, run_id, lobster, artifact_type, step_index, meta)

        return artifact_id

    def update_status(
        self,
        artifact_id: str,
        status: str,
        reviewer: str = "",
        review_note: str = "",
        score: Optional[float] = None,
    ) -> bool:
        """更新产出物状态（审批/评分）"""
        now = self._now()
        conn = self._conn()
        try:
            params = [status, reviewer, review_note, now, artifact_id]
            q = "UPDATE artifacts SET status=?, reviewer=?, review_note=?, updated_at=?"
            if score is not None:
                q = "UPDATE artifacts SET status=?, reviewer=?, review_note=?, score=?, updated_at=?"
                params = [status, reviewer, review_note, score, now, artifact_id]
            q += " WHERE artifact_id=?"
            conn.execute(q, params)
            conn.commit()
            return True
        finally:
            conn.close()

    def add_version(
        self,
        run_id: str,
        lobster: str,
        artifact_type: str,
        content: str,
        base_artifact_id: str,
        meta: Optional[dict] = None,
    ) -> str:
        """添加新版本（迭代修改时使用）"""
        # 查找最大版本号
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT MAX(version) FROM artifacts WHERE run_id=? AND lobster=? AND artifact_type=?",
                (run_id, lobster, artifact_type)
            ).fetchone()
            next_version = (row[0] or 0) + 1
        finally:
            conn.close()

        return self.save(
            run_id=run_id,
            lobster=lobster,
            artifact_type=artifact_type,
            content=content,
            version=next_version,
            meta=meta,
            triggered_by=base_artifact_id,
        )

    # ── 查询 ─────────────────────────────────────────────────────

    def get(self, artifact_id: str) -> Optional[ArtifactRecord]:
        """获取单条产出物详情"""
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT * FROM artifacts WHERE artifact_id=?", (artifact_id,)
            ).fetchone()
            return ArtifactRecord(dict(row)) if row else None
        finally:
            conn.close()

    def list_by_run(
        self,
        run_id: str,
        artifact_type: Optional[str] = None,
        lobster: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 100,
    ) -> list[ArtifactRecord]:
        """查询某个工作流的所有产出物（Dashboard主要查询接口）"""
        conn = self._conn()
        try:
            q = "SELECT * FROM artifacts WHERE run_id=?"
            params: list[Any] = [run_id]
            if artifact_type:
                q += " AND artifact_type=?"
                params.append(artifact_type)
            if lobster:
                q += " AND lobster=?"
                params.append(lobster)
            if status:
                q += " AND status=?"
                params.append(status)
            q += " ORDER BY created_at ASC LIMIT ?"
            params.append(limit)
            rows = conn.execute(q, params).fetchall()
            return [ArtifactRecord(dict(r)) for r in rows]
        finally:
            conn.close()

    def list_by_lobster(
        self,
        lobster: str,
        artifact_type: Optional[str] = None,
        limit: int = 50,
    ) -> list[ArtifactRecord]:
        """查询某只龙虾的历史产出物"""
        conn = self._conn()
        try:
            q = "SELECT * FROM artifacts WHERE lobster=?"
            params: list[Any] = [lobster]
            if artifact_type:
                q += " AND artifact_type=?"
                params.append(artifact_type)
            q += " ORDER BY created_at DESC LIMIT ?"
            params.append(limit)
            rows = conn.execute(q, params).fetchall()
            return [ArtifactRecord(dict(r)) for r in rows]
        finally:
            conn.close()

    def get_latest_by_type(
        self,
        run_id: str,
        artifact_type: str,
        lobster: Optional[str] = None,
    ) -> Optional[ArtifactRecord]:
        """获取某任务中某类型的最新版本产出物（下游龙虾取上游产出物用）"""
        conn = self._conn()
        try:
            q = "SELECT * FROM artifacts WHERE run_id=? AND artifact_type=?"
            params: list[Any] = [run_id, artifact_type]
            if lobster:
                q += " AND lobster=?"
                params.append(lobster)
            q += " ORDER BY version DESC, created_at DESC LIMIT 1"
            row = conn.execute(q, params).fetchone()
            return ArtifactRecord(dict(row)) if row else None
        finally:
            conn.close()

    def get_lineage(self, artifact_id: str) -> dict[str, list[str]]:
        """获取产出物的上下游关系"""
        conn = self._conn()
        try:
            upstream = conn.execute(
                "SELECT from_artifact FROM artifact_lineage WHERE to_artifact=?",
                (artifact_id,)
            ).fetchall()
            downstream = conn.execute(
                "SELECT to_artifact FROM artifact_lineage WHERE from_artifact=?",
                (artifact_id,)
            ).fetchall()
            return {
                "upstream": [r[0] for r in upstream],
                "downstream": [r[0] for r in downstream],
            }
        finally:
            conn.close()

    def summary_by_run(self, run_id: str) -> dict[str, Any]:
        """产出物统计摘要（Dashboard用）"""
        conn = self._conn()
        try:
            rows = conn.execute(
                """SELECT lobster, artifact_type, status, COUNT(*) as cnt
                   FROM artifacts WHERE run_id=?
                   GROUP BY lobster, artifact_type, status""",
                (run_id,)
            ).fetchall()
            total = conn.execute(
                "SELECT COUNT(*) FROM artifacts WHERE run_id=?", (run_id,)
            ).fetchone()[0]
        finally:
            conn.close()

        by_lobster: dict[str, list] = {}
        for r in rows:
            name = r["lobster"]
            if name not in by_lobster:
                by_lobster[name] = []
            by_lobster[name].append({
                "type": r["artifact_type"],
                "status": r["status"],
                "count": r["cnt"],
            })

        return {
            "run_id": run_id,
            "total_artifacts": total,
            "by_lobster": by_lobster,
        }

    def recent_artifacts(self, limit: int = 20) -> list[dict]:
        """最近产出物（Dashboard首页滚动展示）"""
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT * FROM artifacts ORDER BY created_at DESC LIMIT ?",
                (limit,)
            ).fetchall()
            return [ArtifactRecord(dict(r)).to_summary() for r in rows]
        finally:
            conn.close()

    # ── 事件触发（通知下游）──────────────────────────────────────

    def _emit_artifact_created(
        self,
        artifact_id: str,
        run_id: str,
        lobster: str,
        artifact_type: str,
        step_index: Optional[int],
        meta: Optional[dict[str, Any]] = None,
    ) -> None:
        """
        产出物创建后触发事件（通知下游龙虾）。
        如果 webhook_event_bus 可用则调用，否则静默跳过。
        """
        try:
            from event_subjects import EventSubjects
            from webhook_event_bus import PlatformEvent, get_event_bus
            bus = get_event_bus()
            tenant_id = str((meta or {}).get("tenant_id") or "tenant_main")
            import asyncio

            asyncio.create_task(
                bus.publish_legacy(
                    event_type="artifact.created",
                    tenant_id=tenant_id,
                    subject=EventSubjects.format(
                        EventSubjects.TASK_ARTIFACT_CREATED,
                        tenant_id=tenant_id,
                        run_id=run_id,
                        artifact_type=artifact_type,
                    ),
                    payload={
                        "artifact_id": artifact_id,
                        "run_id": run_id,
                        "lobster": lobster,
                        "artifact_type": artifact_type,
                        "step_index": step_index,
                        "tenant_id": tenant_id,
                        "next_lobster": _ARTIFACT_DOWNSTREAM_MAP.get(artifact_type),
                    },
                )
            )
        except Exception:
            pass  # event_bus 不可用时静默跳过，不影响主流程


# 产出物→下游龙虾映射（当产出物创建后，自动通知谁来取）
_ARTIFACT_DOWNSTREAM_MAP: dict[str, Optional[str]] = {
    "intel":        "strategist",    # radar产出情报 → 通知strategist
    "brief":        "inkwriter",     # strategist产出brief → 通知inkwriter
    "copy":         "visualizer",    # inkwriter产出文案 → 通知visualizer
    "visual_brief": "visualizer",    # inkwriter产出视觉brief → 通知visualizer
    "visual":       "dispatcher",    # visualizer产出视觉 → 通知dispatcher
    "publish_plan": "dispatcher",    # 发布计划 → dispatcher自己执行
    "publish_result": "echoer",      # 发布结果 → 通知echoer开始监控
    "echo_report":  "catcher",       # 评论报告 → 通知catcher评分
    "lead_package": "followup",      # 线索包 → 通知followup跟进
    "analysis":     "commander",     # abacus分析 → 汇报给commander
    "followup_log": "abacus",        # 跟进记录 → abacus统计转化率
    "workflow_summary": None,        # 任务总结 → 终点，不触发下游
}


# ── 全局单例 ─────────────────────────────────────────────────────

_default_store: Optional[ArtifactStore] = None


def get_artifact_store() -> ArtifactStore:
    """获取全局 ArtifactStore 单例"""
    global _default_store
    if _default_store is None:
        _default_store = ArtifactStore()
    return _default_store
