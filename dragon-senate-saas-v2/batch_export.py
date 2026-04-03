"""
BatchExport — 批量数据导出（CSV/Excel，异步处理）
=================================================
灵感来源：Langfuse Batch Export（BullMQ 异步导出）
借鉴要点：
  - 大数据集异步导出，完成后返回下载链接
  - 支持 CSV / Excel / JSONL 格式
  - 导出任务进入 TaskQueue，Worker 处理完成后通知
  - 支持导出：工作流执行记录 / LLM Generation / 评分数据 / 数据集

使用方式：
    exporter = BatchExporter()

    # 提交导出任务（异步，立即返回 job_id）
    job_id = exporter.export_async(
        export_type="workflow_runs",
        filters={"tenant_id": "t001", "days": 30},
        format="csv",
        notify_webhook="https://...",
    )

    # 查询导出状态
    status = exporter.get_export_status(job_id)
    # → {"status": "completed", "download_url": "/exports/xxx.csv", "rows": 150}

    # 直接同步导出（小数据量，立即返回内容）
    csv_content = exporter.export_sync(
        export_type="llm_generations",
        filters={"tenant_id": "t001", "model": "gpt-4o"},
        format="csv",
    )
"""

from __future__ import annotations

import csv
import io
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


_EXPORT_DIR = os.getenv("EXPORT_DIR", "./data/exports")


# ─────────────────────────────────────────────────────────────────
# 导出列定义
# ─────────────────────────────────────────────────────────────────

EXPORT_SCHEMAS: dict[str, dict[str, Any]] = {
    "workflow_runs": {
        "description": "工作流执行记录",
        "columns": ["trace_id", "workflow_name", "tenant_id", "status",
                    "started_at", "ended_at", "gen_count", "total_tokens", "total_cost_usd"],
        "db": "llm_call_logger",
        "query": """
            SELECT t.trace_id, t.workflow_name, t.tenant_id, t.status,
                   t.started_at, t.ended_at,
                   COUNT(g.gen_id) as gen_count,
                   COALESCE(SUM(g.total_tokens), 0) as total_tokens,
                   COALESCE(SUM(g.cost_usd), 0) as total_cost_usd
            FROM llm_traces t
            LEFT JOIN llm_generations g ON t.trace_id = g.trace_id
            WHERE t.tenant_id = :tenant_id
              {date_filter}
            GROUP BY t.trace_id
            ORDER BY t.started_at DESC
            LIMIT :limit
        """,
    },
    "llm_generations": {
        "description": "LLM 调用记录",
        "columns": ["gen_id", "trace_id", "span_id", "tenant_id", "model", "provider",
                    "prompt_tokens", "completion_tokens", "total_tokens", "cost_usd",
                    "latency_ms", "status", "created_at"],
        "db": "llm_call_logger",
        "query": """
            SELECT gen_id, trace_id, span_id, tenant_id, model, provider,
                   prompt_tokens, completion_tokens, total_tokens, cost_usd,
                   latency_ms, status, created_at
            FROM llm_generations
            WHERE tenant_id = :tenant_id
              {date_filter}
              {model_filter}
            ORDER BY created_at DESC
            LIMIT :limit
        """,
    },
    "scores": {
        "description": "评分数据（LLM-as-Judge + 人工评分）",
        "columns": ["score_id", "gen_id", "trace_id", "tenant_id", "name",
                    "value", "string_value", "score_type", "scorer", "comment", "created_at"],
        "db": "llm_call_logger",
        "query": """
            SELECT score_id, gen_id, trace_id, tenant_id, name,
                   value, string_value, score_type, scorer, comment, created_at
            FROM llm_scores
            WHERE tenant_id = :tenant_id
              {date_filter}
              {name_filter}
            ORDER BY created_at DESC
            LIMIT :limit
        """,
    },
    "prompt_usage": {
        "description": "Prompt 版本使用记录",
        "columns": ["usage_id", "name", "version", "tenant_id", "lobster", "gen_id", "used_at"],
        "db": "prompt_registry",
        "query": """
            SELECT usage_id, name, version, tenant_id, lobster, gen_id, used_at
            FROM prompt_usage
            WHERE tenant_id = :tenant_id
              {date_filter}
            ORDER BY used_at DESC
            LIMIT :limit
        """,
    },
    "dataset_items": {
        "description": "数据集条目（Golden Set）",
        "columns": ["item_id", "dataset_name", "input", "expected_output",
                    "quality_score", "tags", "source_gen_id", "created_at"],
        "db": "dataset_store",
        "query": """
            SELECT item_id, dataset_name, input, expected_output,
                   quality_score, tags, source_gen_id, created_at
            FROM dataset_items
            WHERE is_archived = 0
              {dataset_filter}
            ORDER BY created_at DESC
            LIMIT :limit
        """,
    },
    "quota_usage": {
        "description": "配额使用记录",
        "columns": ["tenant_id", "month", "dimension", "value"],
        "db": "quota_middleware",
        "query": """
            SELECT tenant_id, month, dimension, value
            FROM monthly_usage
            WHERE tenant_id = :tenant_id
            ORDER BY month DESC, dimension
            LIMIT :limit
        """,
    },
}

# DB 路径映射
_DB_PATHS = {
    "llm_call_logger": os.getenv("LLM_CALL_LOGGER_DB", "./data/llm_call_log.sqlite"),
    "prompt_registry":  os.getenv("PROMPT_REGISTRY_DB", "./data/prompt_registry.sqlite"),
    "dataset_store":    os.getenv("DATASET_STORE_DB", "./data/dataset_store.sqlite"),
    "quota_middleware": os.getenv("QUOTA_DB", "./data/quota_usage.sqlite"),
}


# ─────────────────────────────────────────────────────────────────
# BatchExporter
# ─────────────────────────────────────────────────────────────────

class BatchExporter:
    """
    批量数据导出引擎（对应 Langfuse Batch Export）。
    支持同步（小数据）和异步（大数据）两种模式。
    """

    def __init__(self) -> None:
        Path(_EXPORT_DIR).mkdir(parents=True, exist_ok=True)

    def _build_query(self, export_type: str, filters: dict) -> tuple[str, dict]:
        """构建查询 SQL 和参数"""
        schema = EXPORT_SCHEMAS.get(export_type)
        if not schema:
            raise ValueError(f"未知导出类型: {export_type}")

        query_template = schema["query"]
        params: dict[str, Any] = {
            "tenant_id": filters.get("tenant_id", "tenant_main"),
            "limit": min(filters.get("limit", 10000), 100000),
        }

        # 日期过滤
        days = filters.get("days", 30)
        if days and days > 0:
            from datetime import timedelta
            since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
            date_col = "started_at" if "started_at" in schema["columns"] else "created_at"
            if "used_at" in schema["columns"]:
                date_col = "used_at"
            date_filter = f"AND {date_col} >= '{since}'"
        else:
            date_filter = ""

        # 特殊过滤器
        model_filter = f"AND model = '{filters['model']}'" if filters.get("model") else ""
        name_filter  = f"AND name = '{filters['score_name']}'" if filters.get("score_name") else ""
        dataset_filter = f"AND dataset_name = '{filters['dataset_name']}'" if filters.get("dataset_name") else ""

        query = query_template.format(
            date_filter=date_filter,
            model_filter=model_filter,
            name_filter=name_filter,
            dataset_filter=dataset_filter,
        )
        return query, params

    def _fetch_rows(self, export_type: str, filters: dict) -> tuple[list[str], list[dict]]:
        """执行查询，返回 (columns, rows)"""
        schema = EXPORT_SCHEMAS[export_type]
        db_path = _DB_PATHS.get(schema["db"], "./data/llm_call_log.sqlite")

        if not Path(db_path).exists():
            return schema["columns"], []

        query, params = self._build_query(export_type, filters)
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(query, params).fetchall()
            return schema["columns"], [dict(r) for r in rows]
        except Exception as e:
            return schema["columns"], [{"error": str(e)}]
        finally:
            conn.close()

    def _to_csv(self, columns: list[str], rows: list[dict]) -> str:
        """将数据转换为 CSV 字符串"""
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            # 序列化嵌套对象
            flat_row = {}
            for k, v in row.items():
                if isinstance(v, (dict, list)):
                    flat_row[k] = json.dumps(v, ensure_ascii=False)
                else:
                    flat_row[k] = v
            writer.writerow(flat_row)
        return output.getvalue()

    def _to_jsonl(self, rows: list[dict]) -> str:
        """将数据转换为 JSONL（每行一个 JSON）"""
        return "\n".join(json.dumps(r, ensure_ascii=False, default=str) for r in rows)

    def export_sync(
        self,
        export_type: str,
        filters: Optional[dict] = None,
        fmt: str = "csv",
    ) -> dict[str, Any]:
        """
        同步导出（适合小数据量，立即返回内容字符串）。
        fmt: "csv" | "jsonl" | "json"
        """
        filters = filters or {}
        columns, rows = self._fetch_rows(export_type, filters)

        if fmt == "csv":
            content = self._to_csv(columns, rows)
        elif fmt == "jsonl":
            content = self._to_jsonl(rows)
        else:
            content = json.dumps(rows, ensure_ascii=False, default=str, indent=2)

        return {
            "export_type": export_type,
            "format": fmt,
            "rows": len(rows),
            "content": content,
        }

    def export_to_file(
        self,
        export_type: str,
        filters: Optional[dict] = None,
        fmt: str = "csv",
        filename: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        导出到文件，返回文件路径和统计。
        """
        filters = filters or {}
        result = self.export_sync(export_type, filters, fmt)

        if not filename:
            ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            tenant = filters.get("tenant_id", "tenant_main")
            filename = f"{export_type}_{tenant}_{ts}.{fmt}"

        file_path = Path(_EXPORT_DIR) / filename
        file_path.write_text(result["content"], encoding="utf-8")

        return {
            "export_type": export_type,
            "format": fmt,
            "rows": result["rows"],
            "file_path": str(file_path),
            "filename": filename,
            "download_url": f"/api/exports/download/{filename}",
            "file_size_bytes": file_path.stat().st_size,
        }

    def export_async(
        self,
        export_type: str,
        filters: Optional[dict] = None,
        fmt: str = "csv",
        notify_webhook: str = "",
        tenant_id: str = "",
        priority: int = 3,
    ) -> str:
        """
        异步导出（提交到 TaskQueue，返回 job_id）。
        适合大数据量导出，完成后可通过 notify_webhook 回调通知。
        """
        from task_queue import get_task_queue
        queue = get_task_queue()
        payload = {
            "export_type": export_type,
            "filters": filters or {},
            "format": fmt,
            "notify_webhook": notify_webhook,
            "tenant_id": tenant_id or (filters or {}).get("tenant_id", ""),
        }
        job_id = queue.enqueue(
            task_type="export_data",
            payload=payload,
            tenant_id=tenant_id,
            priority=priority,
        )
        return job_id

    def list_exports(self, tenant_id: str = "") -> list[dict[str, Any]]:
        """列出已导出的文件"""
        export_dir = Path(_EXPORT_DIR)
        files = sorted(export_dir.glob("*"), key=lambda f: f.stat().st_mtime, reverse=True)
        result = []
        for f in files[:50]:
            if tenant_id and tenant_id not in f.name:
                continue
            result.append({
                "filename": f.name,
                "download_url": f"/api/exports/download/{f.name}",
                "size_bytes": f.stat().st_size,
                "created_at": datetime.fromtimestamp(
                    f.stat().st_mtime, tz=timezone.utc
                ).isoformat(),
            })
        return result

    def list_export_types(self) -> list[dict[str, str]]:
        """列出所有支持的导出类型"""
        return [
            {"type": k, "description": v["description"], "columns": ",".join(v["columns"])}
            for k, v in EXPORT_SCHEMAS.items()
        ]


# ─────────────────────────────────────────────────────────────────
# TaskQueue 处理器注册（export_data 任务类型）
# ─────────────────────────────────────────────────────────────────

def register_export_handler() -> None:
    """将 export_data 处理器注册到 TaskQueue"""
    try:
        from task_queue import register_handler

        @register_handler("export_data")
        def handle_export_data(payload: dict) -> dict:
            exporter = BatchExporter()
            result = exporter.export_to_file(
                export_type=payload.get("export_type", "workflow_runs"),
                filters=payload.get("filters", {}),
                fmt=payload.get("format", "csv"),
            )
            # 可选：发送 Webhook 通知
            webhook_url = payload.get("notify_webhook", "")
            if webhook_url:
                try:
                    import urllib.request
                    data = json.dumps(result).encode()
                    req = urllib.request.Request(
                        webhook_url, data=data,
                        headers={"Content-Type": "application/json"}, method="POST"
                    )
                    urllib.request.urlopen(req, timeout=10)
                except Exception:
                    pass
            return result

    except ImportError:
        pass  # task_queue 未安装时跳过


# 模块加载时自动注册
register_export_handler()


# ─────────────────────────────────────────────────────────────────
# FastAPI 路由（供 app.py include_router）
# ─────────────────────────────────────────────────────────────────

def make_export_router():
    """创建导出相关的 FastAPI Router"""
    try:
        from fastapi import APIRouter, Query
        from fastapi.responses import FileResponse, JSONResponse
    except ImportError:
        return None

    router = APIRouter(prefix="/api/exports", tags=["exports"])
    exporter = BatchExporter()

    @router.get("/types")
    def list_types():
        return exporter.list_export_types()

    @router.get("/list")
    def list_files(tenant_id: str = Query("tenant_main")):
        return exporter.list_exports(tenant_id=tenant_id)

    @router.post("/sync/{export_type}")
    def sync_export(
        export_type: str,
        tenant_id: str = Query("tenant_main"),
        days: int = Query(30),
        fmt: str = Query("csv"),
        limit: int = Query(1000),
    ):
        filters = {"tenant_id": tenant_id, "days": days, "limit": limit}
        result = exporter.export_sync(export_type, filters, fmt)
        from fastapi.responses import PlainTextResponse
        return PlainTextResponse(
            result["content"],
            media_type="text/csv" if fmt == "csv" else "application/json",
            headers={"Content-Disposition": f"attachment; filename={export_type}.{fmt}"}
        )

    @router.post("/async/{export_type}")
    def async_export(
        export_type: str,
        tenant_id: str = Query("tenant_main"),
        days: int = Query(30),
        fmt: str = Query("csv"),
        limit: int = Query(10000),
        notify_webhook: str = Query(""),
    ):
        filters = {"tenant_id": tenant_id, "days": days, "limit": limit}
        job_id = exporter.export_async(
            export_type, filters, fmt, notify_webhook, tenant_id
        )
        return {"job_id": job_id, "status": "queued",
                "message": f"导出任务已提交，job_id={job_id}，完成后可查询状态"}

    @router.get("/download/{filename}")
    def download_file(filename: str):
        file_path = Path(_EXPORT_DIR) / filename
        if not file_path.exists():
            return JSONResponse({"error": "文件不存在"}, status_code=404)
        media_type = "text/csv" if filename.endswith(".csv") else "application/json"
        return FileResponse(str(file_path), media_type=media_type, filename=filename)

    return router


# ─────────────────────────────────────────────────────────────────
# 全局单例
# ─────────────────────────────────────────────────────────────────

_default_exporter: Optional[BatchExporter] = None

def get_batch_exporter() -> BatchExporter:
    global _default_exporter
    if _default_exporter is None:
        _default_exporter = BatchExporter()
    return _default_exporter
