"""
Safe SQL query API for structured logs.
"""

from __future__ import annotations

import re
import sqlite3
from datetime import datetime
from datetime import timedelta
from datetime import timezone
from pathlib import Path
from typing import Any

from llm_call_logger import _DB_PATH as LLM_DB_PATH
from mcp_gateway import DB_PATH as MCP_DB_PATH
from workflow_event_log import _DB_PATH as WORKFLOW_DB_PATH


ALLOWED_TABLES = {
    "llm_call_logs": {"timestamp_col": "timestamp", "timestamp_format": "epoch"},
    "tool_call_logs": {"timestamp_col": "created_at", "timestamp_format": "iso"},
    "workflow_event_logs": {"timestamp_col": "created_at", "timestamp_format": "iso"},
}

FORBIDDEN_TOKENS = ["DROP", "DELETE", "INSERT", "UPDATE", "TRUNCATE", "--", "/*", "*/", "ATTACH", "DETACH", "PRAGMA"]


def validate_query(sql: str) -> tuple[bool, str]:
    normalized = str(sql or "").strip()
    if not normalized:
        return False, "SQL 不能为空"
    if not normalized.upper().startswith("SELECT"):
        return False, "只允许 SELECT 查询"
    for token in FORBIDDEN_TOKENS:
        if token.lower() in normalized.lower():
            return False, f"禁止使用关键字 {token}"
    if ";" in normalized:
        return False, "禁止多语句查询"
    match = re.search(r"\bFROM\s+([a-zA-Z_][a-zA-Z0-9_]*)\b", normalized, re.IGNORECASE)
    if not match:
        return False, "SQL 缺少 FROM 子句"
    table = str(match.group(1)).lower()
    if table not in ALLOWED_TABLES:
        return False, f"表 {table} 不在允许列表中"
    return True, ""


class LogQueryApi:
    def __init__(self) -> None:
        self._llm_db = Path(LLM_DB_PATH)
        self._mcp_db = Path(MCP_DB_PATH)
        self._workflow_db = Path(WORKFLOW_DB_PATH)

    def query(
        self,
        *,
        sql: str,
        tenant_id: str,
        time_range_hours: int = 1,
        limit: int = 500,
    ) -> dict[str, Any]:
        valid, reason = validate_query(sql)
        if not valid:
            return {"success": False, "error": reason}

        table = self._extract_table(sql)
        safe_sql = self._inject_filters(
            sql=sql,
            tenant_id=tenant_id,
            table=table,
            since_ts=self._since_ts(time_range_hours, table),
            limit=limit,
        )
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        try:
            self._attach_sources(conn)
            rows = conn.execute(
                safe_sql,
                {
                    "tenant_id": tenant_id,
                    "since_ts": self._since_ts(time_range_hours, table),
                },
            ).fetchall()
            return {
                "success": True,
                "rows": [dict(row) for row in rows],
                "count": len(rows),
                "sql": safe_sql,
            }
        except Exception as exc:  # noqa: BLE001
            return {"success": False, "error": str(exc)}
        finally:
            conn.close()

    def get_query_templates(self) -> list[dict[str, str]]:
        return [
            {
                "name": "龙虾错误率（过去1小时）",
                "sql": "SELECT lobster_name, COUNT(*) AS total, SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors FROM llm_call_logs GROUP BY lobster_name ORDER BY errors DESC",
            },
            {
                "name": "最慢的10次 LLM 调用",
                "sql": "SELECT lobster_name, model, latency_ms, total_tokens, cost_usd, timestamp FROM llm_call_logs ORDER BY latency_ms DESC LIMIT 10",
            },
            {
                "name": "MCP 工具失败记录",
                "sql": "SELECT lobster_id, tool_name, server_id, status, duration_ms, created_at FROM tool_call_logs WHERE status <> 'success' ORDER BY created_at DESC LIMIT 50",
            },
            {
                "name": "工作流失败事件",
                "sql": "SELECT workflow_run_id, event_type, step_name, error_message, created_at FROM workflow_event_logs WHERE event_type='step_failed' ORDER BY created_at DESC LIMIT 50",
            },
        ]

    def _attach_sources(self, conn: sqlite3.Connection) -> None:
        conn.execute(f"ATTACH DATABASE '{self._llm_db.as_posix()}' AS llmdb")
        conn.execute(f"ATTACH DATABASE '{self._mcp_db.as_posix()}' AS mcpdb")
        conn.execute(f"ATTACH DATABASE '{self._workflow_db.as_posix()}' AS wfdb")
        conn.execute("CREATE TEMP VIEW IF NOT EXISTS llm_call_logs AS SELECT * FROM llmdb.llm_call_logs")
        conn.execute("CREATE TEMP VIEW IF NOT EXISTS tool_call_logs AS SELECT * FROM mcpdb.mcp_call_history")
        conn.execute("CREATE TEMP VIEW IF NOT EXISTS workflow_event_logs AS SELECT * FROM wfdb.workflow_events")

    def _extract_table(self, sql: str) -> str:
        match = re.search(r"\bFROM\s+([a-zA-Z_][a-zA-Z0-9_]*)\b", sql, re.IGNORECASE)
        return str(match.group(1)).lower() if match else ""

    def _inject_filters(
        self,
        *,
        sql: str,
        tenant_id: str,
        table: str,
        since_ts: str,
        limit: int,
    ) -> str:
        timestamp_col = ALLOWED_TABLES[table]["timestamp_col"]
        upper_sql = sql.upper()
        clauses = ["tenant_id = :tenant_id"]
        if timestamp_col:
            clauses.append(f"{timestamp_col} >= :since_ts")
        filter_sql = " AND ".join(clauses)

        boundary_match = re.search(r"\b(GROUP BY|ORDER BY|LIMIT)\b", upper_sql)
        split_index = boundary_match.start() if boundary_match else len(sql)
        head = sql[:split_index].rstrip()
        tail = sql[split_index:]
        if re.search(r"\bWHERE\b", head, re.IGNORECASE):
            head = f"{head} AND {filter_sql}"
        else:
            head = f"{head} WHERE {filter_sql}"
        if not re.search(r"\bLIMIT\b", sql, re.IGNORECASE):
            tail = f"{tail} LIMIT {max(1, min(limit, 1000))}"
        return f"{head} {tail}".strip()

    def _since_ts(self, hours: int, table: str) -> Any:
        delta = timedelta(hours=max(1, int(hours or 1)))
        target = datetime.now(timezone.utc) - delta
        if ALLOWED_TABLES.get(table, {}).get("timestamp_format") == "epoch":
            return target.timestamp()
        return target.isoformat()
