"""
FilterUtils — 多维过滤组件工具
================================
灵感来源：Langfuse 全局过滤系统（时间范围/标签/模型/评分范围）
借鉴要点：
  - 所有列表页支持多维过滤：时间范围 + 标签 + 模型 + 龙虾 + 评分范围
  - 过滤条件序列化/反序列化（URL 参数双向转换）
  - 动态构建 SQL WHERE 子句（防 SQL 注入）
  - 提供前端可用的过滤选项枚举接口

使用方式（后端）：
    from filter_utils import FilterBuilder, FilterSpec

    # 从 HTTP 请求参数构建过滤器
    spec = FilterSpec(
        tenant_id="t001",
        days=30,
        models=["gpt-4o", "gpt-4o-mini"],
        lobsters=["inkwriter", "catcher"],
        status=["success"],
        score_min=0.7,
        score_max=1.0,
    )
    builder = FilterBuilder("llm_generations", spec)
    where_clause, params = builder.build()
    # → ("tenant_id=? AND model IN (?,?) AND ...", ["t001", "gpt-4o", "gpt-4o-mini", ...])

使用方式（FastAPI）：
    @router.get("/traces")
    def list_traces(filters: FilterSpec = Depends()):
        builder = FilterBuilder("llm_traces", filters)
        where, params = builder.build()
        ...
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Optional


# ─────────────────────────────────────────────────────────────────
# 过滤选项常量（供前端下拉菜单使用）
# ─────────────────────────────────────────────────────────────────

FILTER_OPTIONS = {
    "models": [
        "gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo",
        "claude-3-5-sonnet", "claude-3-5-haiku", "claude-3-opus",
        "deepseek-chat", "deepseek-reasoner",
        "qwen-max", "qwen-plus", "glm-4",
    ],
    "lobsters": [
        "inkwriter", "catcher", "abacus", "dispatcher",
        "strategist", "visualizer", "followup", "researcher",
        "coordinator", "heartbeat",
    ],
    "platforms": [
        "douyin", "xiaohongshu", "wechat", "weibo",
        "kuaishou", "bilibili", "zhihu", "linkedin",
    ],
    "status": ["success", "error", "timeout", "filtered"],
    "workflow_status": ["running", "completed", "failed", "cancelled"],
    "job_status": ["pending", "running", "completed", "failed", "retrying", "delayed"],
    "score_names": [
        "copy_quality.quality", "copy_quality.relevance",
        "copy_quality.compliance", "copy_quality.conversion_potential",
        "compliance_check.compliance", "lead_score_quality.accuracy",
    ],
    "time_ranges": [
        {"label": "最近1小时", "days": 0, "hours": 1},
        {"label": "今天", "days": 1, "hours": 0},
        {"label": "最近7天", "days": 7, "hours": 0},
        {"label": "最近30天", "days": 30, "hours": 0},
        {"label": "最近90天", "days": 90, "hours": 0},
        {"label": "最近1年", "days": 365, "hours": 0},
    ],
    "export_formats": ["csv", "jsonl", "json"],
    "prompt_labels": ["production", "preview", "experiment"],
    "api_key_tags": ["production", "staging", "development", "test"],
    "plans": ["free", "starter", "pro", "enterprise"],
}


# ─────────────────────────────────────────────────────────────────
# FilterSpec — 过滤条件数据类
# ─────────────────────────────────────────────────────────────────

@dataclass
class FilterSpec:
    """
    多维过滤条件（对应 Langfuse 过滤系统）。
    所有字段均可选，None 表示不过滤该维度。
    """
    tenant_id: str = "tenant_main"
    days: int = 30                              # 时间范围（天）
    hours: int = 0                             # 额外小时偏移
    since: Optional[str] = None               # 精确起始时间（ISO 格式，优先于 days）
    until: Optional[str] = None               # 精确结束时间
    models: Optional[list[str]] = None        # 模型过滤
    lobsters: Optional[list[str]] = None      # 龙虾过滤
    skills: Optional[list[str]] = None        # 技能过滤
    status: Optional[list[str]] = None        # 状态过滤
    platforms: Optional[list[str]] = None     # 平台过滤
    workflow_names: Optional[list[str]] = None # 工作流名称过滤
    score_name: Optional[str] = None          # 评分维度
    score_min: Optional[float] = None         # 最低评分
    score_max: Optional[float] = None         # 最高评分
    search: Optional[str] = None             # 全文搜索（模糊匹配）
    tags: Optional[list[str]] = None          # 标签过滤
    limit: int = 50
    offset: int = 0

    def get_since(self) -> str:
        """计算起始时间（ISO 格式）"""
        if self.since:
            return self.since
        total_hours = self.days * 24 + self.hours
        if total_hours <= 0:
            total_hours = 30 * 24
        return (datetime.now(timezone.utc) - timedelta(hours=total_hours)).isoformat()

    def get_until(self) -> str:
        """计算结束时间"""
        return self.until or datetime.now(timezone.utc).isoformat()

    @classmethod
    def from_query_params(cls, params: dict) -> "FilterSpec":
        """从 HTTP Query 参数字典构建 FilterSpec"""
        def _list(key: str) -> Optional[list[str]]:
            v = params.get(key)
            if not v:
                return None
            if isinstance(v, list):
                return [str(x) for x in v if x]
            return [x.strip() for x in str(v).split(",") if x.strip()]

        def _float(key: str) -> Optional[float]:
            v = params.get(key)
            try:
                return float(v) if v is not None else None
            except (ValueError, TypeError):
                return None

        return cls(
            tenant_id=params.get("tenant_id", "tenant_main"),
            days=int(params.get("days", 30)),
            hours=int(params.get("hours", 0)),
            since=params.get("since"),
            until=params.get("until"),
            models=_list("models"),
            lobsters=_list("lobsters"),
            skills=_list("skills"),
            status=_list("status"),
            platforms=_list("platforms"),
            workflow_names=_list("workflow_names"),
            score_name=params.get("score_name"),
            score_min=_float("score_min"),
            score_max=_float("score_max"),
            search=params.get("search"),
            tags=_list("tags"),
            limit=min(int(params.get("limit", 50)), 500),
            offset=int(params.get("offset", 0)),
        )

    def to_query_params(self) -> dict[str, Any]:
        """序列化为 HTTP Query 参数（用于 URL 分享/缓存）"""
        params: dict[str, Any] = {
            "tenant_id": self.tenant_id,
            "days": self.days,
            "limit": self.limit,
            "offset": self.offset,
        }
        if self.since:
            params["since"] = self.since
        if self.until:
            params["until"] = self.until
        if self.models:
            params["models"] = ",".join(self.models)
        if self.lobsters:
            params["lobsters"] = ",".join(self.lobsters)
        if self.status:
            params["status"] = ",".join(self.status)
        if self.score_name:
            params["score_name"] = self.score_name
        if self.score_min is not None:
            params["score_min"] = self.score_min
        if self.score_max is not None:
            params["score_max"] = self.score_max
        if self.search:
            params["search"] = self.search
        return params


# ─────────────────────────────────────────────────────────────────
# FilterBuilder — SQL WHERE 子句构建器
# ─────────────────────────────────────────────────────────────────

class FilterBuilder:
    """
    动态构建 SQL WHERE 子句（防 SQL 注入，使用参数绑定）。
    支持：llm_generations / llm_traces / llm_spans / llm_scores /
          jobs / prompt_usage / dataset_items
    """

    # 各表的字段映射（字段名 → 列名）
    TABLE_COLUMNS: dict[str, dict[str, str]] = {
        "llm_generations": {
            "tenant_id": "g.tenant_id",
            "date_col":  "g.created_at",
            "model":     "g.model",
            "status":    "g.status",
            "lobster":   "s.lobster",  # JOIN llm_spans
        },
        "llm_traces": {
            "tenant_id":      "t.tenant_id",
            "date_col":       "t.started_at",
            "workflow_name":  "t.workflow_name",
            "status":         "t.status",
        },
        "llm_spans": {
            "tenant_id": "sp.tenant_id",
            "date_col":  "sp.started_at",
            "lobster":   "sp.lobster",
            "skill":     "sp.skill",
            "status":    "sp.status",
        },
        "llm_scores": {
            "tenant_id": "sc.tenant_id",
            "date_col":  "sc.created_at",
            "name":      "sc.name",
        },
        "jobs": {
            "tenant_id": "j.tenant_id",
            "date_col":  "j.created_at",
            "status":    "j.status",
            "task_type": "j.task_type",
        },
        "prompt_usage": {
            "tenant_id": "pu.tenant_id",
            "date_col":  "pu.used_at",
            "lobster":   "pu.lobster",
        },
        "dataset_items": {
            "tenant_id":    "di.tenant_id",
            "date_col":     "di.created_at",
            "dataset_name": "di.dataset_name",
        },
    }

    def __init__(self, table: str, spec: FilterSpec, alias: str = "") -> None:
        self.table = table
        self.spec = spec
        self.alias = alias
        self._conditions: list[str] = []
        self._params: list[Any] = []

    def _add(self, condition: str, *params: Any) -> None:
        self._conditions.append(condition)
        self._params.extend(params)

    def _col(self, field: str) -> str:
        """获取字段的完整列名"""
        mapping = self.TABLE_COLUMNS.get(self.table, {})
        return mapping.get(field, field)

    def build(self) -> tuple[str, list[Any]]:
        """构建 WHERE 子句和参数列表"""
        spec = self.spec
        cols = self.TABLE_COLUMNS.get(self.table, {})

        # 租户隔离（必须）
        if "tenant_id" in cols:
            self._add(f"{cols['tenant_id']} = ?", spec.tenant_id)

        # 时间范围
        if "date_col" in cols:
            date_col = cols["date_col"]
            self._add(f"{date_col} >= ?", spec.get_since())
            if spec.until:
                self._add(f"{date_col} <= ?", spec.until)

        # 模型过滤
        if spec.models and "model" in cols:
            placeholders = ",".join("?" * len(spec.models))
            self._add(f"{cols['model']} IN ({placeholders})", *spec.models)

        # 龙虾过滤
        if spec.lobsters and "lobster" in cols:
            placeholders = ",".join("?" * len(spec.lobsters))
            self._add(f"{cols['lobster']} IN ({placeholders})", *spec.lobsters)

        # 状态过滤
        if spec.status and "status" in cols:
            placeholders = ",".join("?" * len(spec.status))
            self._add(f"{cols['status']} IN ({placeholders})", *spec.status)

        # 工作流名称过滤
        if spec.workflow_names and "workflow_name" in cols:
            placeholders = ",".join("?" * len(spec.workflow_names))
            self._add(f"{cols['workflow_name']} IN ({placeholders})", *spec.workflow_names)

        # 评分范围（仅 llm_scores 表）
        if self.table == "llm_scores":
            if spec.score_name:
                self._add("sc.name = ?", spec.score_name)
            if spec.score_min is not None:
                self._add("sc.value >= ?", spec.score_min)
            if spec.score_max is not None:
                self._add("sc.value <= ?", spec.score_max)

        # 全文搜索（output_text 模糊匹配，仅 llm_generations）
        if spec.search and self.table == "llm_generations":
            self._add("g.output_text LIKE ?", f"%{spec.search}%")

        # 数据集名称过滤
        if self.table == "dataset_items" and spec.tags:
            # tags 存为 JSON array，用 LIKE 模糊匹配
            for tag in spec.tags:
                self._add("di.tags LIKE ?", f"%{tag}%")

        where_clause = " AND ".join(self._conditions) if self._conditions else "1=1"
        return where_clause, self._params

    def build_full_query(self, select_cols: str = "*",
                          order_by: str = "", extra_joins: str = "") -> tuple[str, list[Any]]:
        """构建完整 SELECT 查询"""
        where, params = self.build()
        order = f"ORDER BY {order_by}" if order_by else ""
        query = f"""
            SELECT {select_cols}
            FROM {self.table}
            {extra_joins}
            WHERE {where}
            {order}
            LIMIT {self.spec.limit} OFFSET {self.spec.offset}
        """
        return query.strip(), params


# ─────────────────────────────────────────────────────────────────
# FastAPI 路由：过滤选项枚举
# ─────────────────────────────────────────────────────────────────

def make_filter_router():
    """创建过滤选项枚举路由"""
    try:
        from fastapi import APIRouter
    except ImportError:
        return None

    router = APIRouter(prefix="/api/filters", tags=["filters"])

    @router.get("/options")
    def get_filter_options():
        """
        返回所有过滤选项（供前端下拉菜单）。
        前端在初始化时调用一次，缓存到本地状态。
        """
        return FILTER_OPTIONS

    @router.get("/options/{category}")
    def get_filter_option(category: str):
        """返回指定类别的过滤选项"""
        if category not in FILTER_OPTIONS:
            from fastapi.responses import JSONResponse
            return JSONResponse({"error": f"未知类别: {category}"}, status_code=404)
        return {category: FILTER_OPTIONS[category]}

    return router


# ─────────────────────────────────────────────────────────────────
# 工具函数：前端 Filter 状态 ↔ URL 参数 ↔ FilterSpec 转换
# ─────────────────────────────────────────────────────────────────

def parse_filter_from_request(request_params: dict) -> FilterSpec:
    """从 FastAPI/Flask 请求参数解析 FilterSpec"""
    return FilterSpec.from_query_params(request_params)


def serialize_filter_to_url(spec: FilterSpec) -> str:
    """将 FilterSpec 序列化为 URL Query String"""
    params = spec.to_query_params()
    return "&".join(f"{k}={v}" for k, v in params.items() if v is not None)


def build_filter_summary(spec: FilterSpec) -> dict[str, Any]:
    """
    生成过滤条件摘要（供 UI 展示「当前过滤：模型=gpt-4o, 龙虾=inkwriter...」）
    """
    active_filters = []
    if spec.models:
        active_filters.append({"key": "models", "label": f"模型: {','.join(spec.models)}"})
    if spec.lobsters:
        active_filters.append({"key": "lobsters", "label": f"龙虾: {','.join(spec.lobsters)}"})
    if spec.status:
        active_filters.append({"key": "status", "label": f"状态: {','.join(spec.status)}"})
    if spec.score_min is not None or spec.score_max is not None:
        score_range = f"{spec.score_min or 0:.1f} - {spec.score_max or 1.0:.1f}"
        active_filters.append({"key": "score", "label": f"评分: {score_range}"})
    if spec.search:
        active_filters.append({"key": "search", "label": f"搜索: {spec.search}"})

    return {
        "active_count": len(active_filters),
        "active_filters": active_filters,
        "time_range": f"最近{spec.days}天" if not spec.since else f"自定义",
        "limit": spec.limit,
    }
