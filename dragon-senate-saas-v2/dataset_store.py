"""
DatasetStore — Golden Set 数据集管理
======================================
灵感来源：Langfuse Dataset Management
借鉴要点：
  - 收集高质量的输入/输出对（Golden Set）
  - 用于：评测回归 / 微调数据积累 / AB测试基准
  - 支持数据集分组（dataset_name）和运行记录（dataset_run）
  - 关联 llm_call_logger 的 gen_id，形成闭环

使用方式：
    ds = DatasetStore()

    # 创建数据集
    ds.create_dataset("inkwriter_golden_copy", description="优质文案样例集")

    # 添加数据条目
    item_id = ds.add_item(
        dataset_name="inkwriter_golden_copy",
        input={"industry": "餐饮", "customer_name": "火锅店"},
        expected_output="开篇钩子：你有多久没和家人围坐在一起...",
        tags=["餐饮", "高转化"],
        source_gen_id="gn_abc123",  # 来源于 llm_call_logger
    )

    # 记录一次评测运行
    run_id = ds.create_run("inkwriter_golden_copy", run_name="gpt4o-v2-test")
    ds.add_run_result(run_id, item_id, output="...", score=0.92)

    # 查询数据集统计
    stats = ds.get_dataset_stats("inkwriter_golden_copy")
"""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

_DB_PATH = os.getenv("DATASET_STORE_DB", "./data/dataset_store.sqlite")


class DatasetStore:
    """Golden Set 数据集管理（对应 Langfuse Dataset）"""

    def __init__(self, db_path: str = _DB_PATH) -> None:
        self._db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _ensure_schema(self) -> None:
        conn = self._conn()
        try:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS datasets (
                    dataset_id   TEXT PRIMARY KEY,
                    name         TEXT UNIQUE NOT NULL,
                    description  TEXT DEFAULT '',
                    lobster      TEXT DEFAULT '',
                    skill        TEXT DEFAULT '',
                    tenant_id    TEXT DEFAULT 'tenant_main',
                    item_count   INTEGER DEFAULT 0,
                    created_at   TEXT NOT NULL,
                    updated_at   TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS dataset_items (
                    item_id        TEXT PRIMARY KEY,
                    dataset_name   TEXT NOT NULL,
                    input          TEXT NOT NULL DEFAULT '{}',
                    expected_output TEXT DEFAULT '',
                    metadata       TEXT DEFAULT '{}',
                    tags           TEXT DEFAULT '[]',
                    source_gen_id  TEXT DEFAULT '',
                    quality_score  REAL DEFAULT 0.0,
                    is_archived    INTEGER DEFAULT 0,
                    created_at     TEXT NOT NULL,
                    FOREIGN KEY (dataset_name) REFERENCES datasets(name)
                );
                CREATE INDEX IF NOT EXISTS idx_item_dataset ON dataset_items(dataset_name, created_at);
                CREATE INDEX IF NOT EXISTS idx_item_gen ON dataset_items(source_gen_id);

                CREATE TABLE IF NOT EXISTS dataset_runs (
                    run_id       TEXT PRIMARY KEY,
                    dataset_name TEXT NOT NULL,
                    run_name     TEXT NOT NULL,
                    description  TEXT DEFAULT '',
                    metadata     TEXT DEFAULT '{}',
                    avg_score    REAL DEFAULT 0.0,
                    item_count   INTEGER DEFAULT 0,
                    created_at   TEXT NOT NULL,
                    FOREIGN KEY (dataset_name) REFERENCES datasets(name)
                );

                CREATE TABLE IF NOT EXISTS dataset_run_results (
                    result_id    TEXT PRIMARY KEY,
                    run_id       TEXT NOT NULL,
                    item_id      TEXT NOT NULL,
                    dataset_name TEXT NOT NULL,
                    output       TEXT DEFAULT '',
                    score        REAL DEFAULT 0.0,
                    passed       INTEGER DEFAULT 1,
                    latency_ms   INTEGER DEFAULT 0,
                    gen_id       TEXT DEFAULT '',
                    created_at   TEXT NOT NULL,
                    FOREIGN KEY (run_id) REFERENCES dataset_runs(run_id),
                    FOREIGN KEY (item_id) REFERENCES dataset_items(item_id)
                );
                CREATE INDEX IF NOT EXISTS idx_result_run ON dataset_run_results(run_id);
            """)
            conn.commit()
        finally:
            conn.close()

    def create_dataset(self, name: str, description: str = "",
                       lobster: str = "", skill: str = "",
                       tenant_id: str = "tenant_main") -> str:
        dataset_id = f"ds_{uuid.uuid4().hex[:12]}"
        conn = self._conn()
        try:
            conn.execute(
                """INSERT OR IGNORE INTO datasets
                   (dataset_id, name, description, lobster, skill, tenant_id, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (dataset_id, name, description, lobster, skill, tenant_id,
                 self._now(), self._now())
            )
            conn.commit()
        finally:
            conn.close()
        return dataset_id

    def add_item(self, dataset_name: str, input: dict, expected_output: str = "",
                 tags: list[str] | None = None, metadata: dict | None = None,
                 source_gen_id: str = "", quality_score: float = 0.0) -> str:
        item_id = f"di_{uuid.uuid4().hex[:12]}"
        conn = self._conn()
        try:
            conn.execute(
                """INSERT INTO dataset_items
                   (item_id, dataset_name, input, expected_output, metadata, tags,
                    source_gen_id, quality_score, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (item_id, dataset_name, json.dumps(input, ensure_ascii=False),
                 expected_output, json.dumps(metadata or {}), json.dumps(tags or []),
                 source_gen_id, quality_score, self._now())
            )
            conn.execute(
                "UPDATE datasets SET item_count=item_count+1, updated_at=? WHERE name=?",
                (self._now(), dataset_name)
            )
            conn.commit()
        finally:
            conn.close()
        return item_id

    def create_run(self, dataset_name: str, run_name: str,
                   description: str = "", metadata: dict | None = None) -> str:
        run_id = f"dr_{uuid.uuid4().hex[:12]}"
        conn = self._conn()
        try:
            conn.execute(
                """INSERT INTO dataset_runs
                   (run_id, dataset_name, run_name, description, metadata, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (run_id, dataset_name, run_name, description,
                 json.dumps(metadata or {}), self._now())
            )
            conn.commit()
        finally:
            conn.close()
        return run_id

    def add_run_result(self, run_id: str, item_id: str, output: str = "",
                       score: float = 0.0, passed: bool = True,
                       latency_ms: int = 0, gen_id: str = "") -> str:
        result_id = f"rr_{uuid.uuid4().hex[:12]}"
        conn = self._conn()
        try:
            row = conn.execute(
                "SELECT dataset_name FROM dataset_runs WHERE run_id=?", (run_id,)
            ).fetchone()
            dataset_name = row["dataset_name"] if row else ""
            conn.execute(
                """INSERT INTO dataset_run_results
                   (result_id, run_id, item_id, dataset_name, output, score,
                    passed, latency_ms, gen_id, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (result_id, run_id, item_id, dataset_name, output, score,
                 1 if passed else 0, latency_ms, gen_id, self._now())
            )
            # 更新 run 平均分
            conn.execute(
                """UPDATE dataset_runs SET
                   avg_score=(SELECT AVG(score) FROM dataset_run_results WHERE run_id=?),
                   item_count=(SELECT COUNT(*) FROM dataset_run_results WHERE run_id=?)
                   WHERE run_id=?""",
                (run_id, run_id, run_id)
            )
            conn.commit()
        finally:
            conn.close()
        return result_id

    def list_datasets(self, tenant_id: str = "tenant_main") -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT * FROM datasets WHERE tenant_id=? ORDER BY updated_at DESC",
                (tenant_id,)
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def get_items(self, dataset_name: str, limit: int = 100,
                  min_quality: float = 0.0) -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            rows = conn.execute(
                """SELECT * FROM dataset_items WHERE dataset_name=?
                   AND is_archived=0 AND quality_score >= ?
                   ORDER BY quality_score DESC LIMIT ?""",
                (dataset_name, min_quality, limit)
            ).fetchall()
            result = []
            for r in rows:
                d = dict(r)
                d["input"] = json.loads(d.get("input", "{}"))
                d["metadata"] = json.loads(d.get("metadata", "{}"))
                d["tags"]  = json.loads(d.get("tags", "[]"))
                result.append(d)
            return result
        finally:
            conn.close()

    def get_dataset(self, dataset_name_or_id: str) -> dict[str, Any]:
        """Return dataset meta plus parsed items, by dataset name or dataset_id."""
        normalized = str(dataset_name_or_id or "").strip()
        if not normalized:
            return {}
        conn = self._conn()
        try:
            ds = conn.execute(
                """
                SELECT * FROM datasets
                WHERE name=? OR dataset_id=?
                ORDER BY updated_at DESC LIMIT 1
                """,
                (normalized, normalized),
            ).fetchone()
            if ds is None:
                return {}
            dataset = dict(ds)
            item_rows = conn.execute(
                """
                SELECT * FROM dataset_items
                WHERE dataset_name=? AND is_archived=0
                ORDER BY created_at ASC
                """,
                (dataset["name"],),
            ).fetchall()
            items: list[dict[str, Any]] = []
            for row in item_rows:
                item = dict(row)
                item["input"] = json.loads(item.get("input", "{}"))
                item["metadata"] = json.loads(item.get("metadata", "{}"))
                item["tags"] = json.loads(item.get("tags", "[]"))
                items.append(item)
            dataset["items"] = items
            return dataset
        finally:
            conn.close()

    def get_dataset_stats(self, dataset_name: str) -> dict[str, Any]:
        conn = self._conn()
        try:
            ds = conn.execute(
                "SELECT * FROM datasets WHERE name=?", (dataset_name,)
            ).fetchone()
            runs = conn.execute(
                """SELECT run_name, avg_score, item_count, created_at
                   FROM dataset_runs WHERE dataset_name=? ORDER BY created_at DESC LIMIT 10""",
                (dataset_name,)
            ).fetchall()
            return {
                "dataset": dict(ds) if ds else {},
                "recent_runs": [dict(r) for r in runs],
            }
        finally:
            conn.close()


_default_ds: Optional[DatasetStore] = None

def get_dataset_store() -> DatasetStore:
    global _default_ds
    if _default_ds is None:
        _default_ds = DatasetStore()
    return _default_ds
