"""
ObservabilityAPI — Trace树状视图 + 成本趋势 Dashboard 后端 API
==============================================================
灵感来源：Langfuse traceRouter + dashboardRouter + scoreAnalyticsRouter
借鉴要点：
  - Trace 详情页：树状 Span → Generation → Score 嵌套结构
  - Dashboard：token用量/成本/延迟的折线图数据接口
  - Score 分析：质量评分趋势，指导 Prompt 优化
  - 所有 API 供前端直接调用（FastAPI Router）

FastAPI 路由：
  GET  /api/observability/traces             → Trace 列表（支持过滤）
  GET  /api/observability/traces/{trace_id}  → Trace 详情（树状结构）
  GET  /api/observability/dashboard          → 成本/token/延迟趋势
  GET  /api/observability/scores/analytics   → 评分分析
  GET  /api/observability/queue/stats        → 任务队列监控
  GET  /api/observability/prompts/stats      → Prompt 版本使用统计
"""

from __future__ import annotations

from typing import Any, Optional


def make_observability_router():
    """
    创建可观测性相关的 FastAPI Router。
    供 app.py: app.include_router(make_observability_router())
    """
    try:
        from fastapi import APIRouter, Body, Query
        from fastapi.responses import JSONResponse
    except ImportError:
        return None

    router = APIRouter(prefix="/api/observability", tags=["observability"])

    @router.post("/traces")
    def create_trace(body: dict = Body(default_factory=dict)):
        try:
            from llm_call_logger import get_llm_call_logger

            logger = get_llm_call_logger()
            trace_id = logger.start_trace(
                workflow_run_id=str(body.get("workflow_run_id") or ""),
                workflow_name=str(body.get("workflow_name") or ""),
                tenant_id=str(body.get("tenant_id") or "tenant_main"),
                name=str(body.get("name") or body.get("workflow_name") or "trace"),
                tags=list(body.get("tags") or []),
                meta=dict(body.get("meta") or {}),
            )
            return {"ok": True, "trace_id": trace_id}
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @router.post("/traces/{trace_id}/end")
    def end_trace(trace_id: str, body: dict = Body(default_factory=dict)):
        try:
            from llm_call_logger import get_llm_call_logger

            get_llm_call_logger().end_trace(trace_id, status=str(body.get("status") or "completed"))
            return {"ok": True, "trace_id": trace_id}
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @router.post("/spans")
    def create_span(body: dict = Body(default_factory=dict)):
        try:
            from llm_call_logger import get_llm_call_logger

            logger = get_llm_call_logger()
            span_id = logger.start_span(
                trace_id=str(body.get("trace_id") or ""),
                lobster=str(body.get("lobster") or ""),
                skill=str(body.get("skill") or ""),
                step_index=body.get("step_index"),
                tenant_id=str(body.get("tenant_id") or "tenant_main"),
                meta=dict(body.get("meta") or {}),
            )
            return {"ok": True, "span_id": span_id}
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @router.post("/spans/{span_id}/end")
    def end_span(span_id: str, body: dict = Body(default_factory=dict)):
        try:
            from llm_call_logger import get_llm_call_logger

            get_llm_call_logger().end_span(
                span_id,
                status=str(body.get("status") or "completed"),
                latency_ms=int(body.get("latency_ms") or 0),
            )
            return {"ok": True, "span_id": span_id}
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @router.post("/generations")
    def create_generation(body: dict = Body(default_factory=dict)):
        try:
            from llm_call_logger import get_llm_call_logger

            logger = get_llm_call_logger()
            gen_id = logger.record_generation(
                trace_id=str(body.get("trace_id") or ""),
                span_id=str(body.get("span_id") or "").strip() or None,
                tenant_id=str(body.get("tenant_id") or "tenant_main"),
                model=str(body.get("model") or ""),
                provider=str(body.get("provider") or ""),
                input_text=str(body.get("input_text") or ""),
                output_text=str(body.get("output_text") or ""),
                system_prompt=str(body.get("system_prompt") or ""),
                prompt_tokens=int(body.get("prompt_tokens") or 0),
                completion_tokens=int(body.get("completion_tokens") or 0),
                latency_ms=int(body.get("latency_ms") or 0),
                status=str(body.get("status") or "success"),
                error_message=str(body.get("error_message") or ""),
                meta=dict(body.get("meta") or {}),
            )
            return {"ok": True, "gen_id": gen_id}
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @router.post("/scores")
    def create_score(body: dict = Body(default_factory=dict)):
        try:
            from llm_call_logger import get_llm_call_logger

            logger = get_llm_call_logger()
            if not body.get("gen_id"):
                return {"ok": True, "score_id": f"trace_score_{body.get('trace_id') or 'noop'}", "stored": False}
            score_id = logger.add_score(
                gen_id=str(body.get("gen_id") or ""),
                name=str(body.get("name") or ""),
                value=body.get("value"),
                string_value=body.get("string_value"),
                boolean_value=body.get("boolean_value"),
                scorer=str(body.get("scorer") or "sdk"),
                comment=str(body.get("comment") or ""),
                tenant_id=str(body.get("tenant_id") or "tenant_main"),
            )
            return {"ok": True, "score_id": score_id}
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    # ── Trace 列表 ─────────────────────────────────────────────────
    @router.get("/traces")
    def list_traces(
        tenant_id: str = Query("tenant_main"),
        workflow_name: str = Query(""),
        status: str = Query(""),
        limit: int = Query(50, le=200),
    ):
        """
        Trace 列表（对应 Langfuse Traces 列表页）。
        前端：工作流执行历史页面，每条记录显示：
          - workflow_name / status / started_at / gen_count / total_cost_usd
        """
        try:
            from llm_call_logger import get_llm_call_logger
            logger = get_llm_call_logger()
            traces = logger.list_traces(
                tenant_id=tenant_id,
                workflow_name=workflow_name or None,
                status=status or None,
                limit=limit,
            )
            return {"total": len(traces), "traces": traces}
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @router.get("/chart/annotations")
    def get_chart_annotations(
        tenant_id: str = Query("tenant_main"),
        start_time: str = Query(""),
        end_time: str = Query(""),
        lobster_id: str = Query(""),
        annotation_types: str = Query(""),
        limit: int = Query(200, le=500),
    ):
        try:
            from annotation_sync import build_annotations
            from tenant_audit_log import get_audit_service

            audit_logs = get_audit_service().query(
                tenant_id,
                from_ts=start_time or None,
                to_ts=end_time or None,
                limit=limit,
            )
            type_set = {item.strip() for item in annotation_types.split(",") if item.strip()} or None
            annotations = build_annotations(
                audit_logs,
                lobster_id=lobster_id or None,
                annotation_types=type_set,
            )
            return {"ok": True, "annotations": [item.to_dict() for item in annotations]}
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @router.get("/event-bus/subjects")
    def list_event_bus_subjects(prefix: str = Query("")):
        try:
            from event_bus_metrics import get_event_bus_metrics

            metrics = get_event_bus_metrics()
            items = metrics.get_stats(prefix_filter=prefix or None)
            return {
                "ok": True,
                "subjects": items,
                "total_subjects": metrics.snapshot().get("total_subjects", len(items)),
            }
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @router.get("/event-bus/prefix-summary")
    def event_bus_prefix_summary():
        try:
            from event_bus_metrics import get_event_bus_metrics

            return {
                "ok": True,
                "prefixes": get_event_bus_metrics().get_prefix_aggregation(),
            }
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @router.get("/event-bus/top")
    def event_bus_top_subjects(limit: int = Query(10, ge=1, le=100)):
        try:
            from event_bus_metrics import get_event_bus_metrics

            return {
                "ok": True,
                "top_subjects": get_event_bus_metrics().get_stats()[:limit],
            }
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    # ── Trace 详情（树状结构）─────────────────────────────────────
    @router.get("/traces/{trace_id}")
    def get_trace_detail(trace_id: str):
        """
        Trace 详情（对应 Langfuse Trace 详情页）。
        返回嵌套结构：Trace → Spans[] → Generations[] → Scores[]
        前端：渲染时间轴树（每个 Span 一行，子级 Generation 缩进展示）

        响应结构示例：
        {
          "trace_id": "tr_xxx",
          "workflow_name": "content-campaign-14step",
          "status": "completed",
          "started_at": "...",
          "spans": [
            {
              "span_id": "sp_xxx",
              "lobster": "inkwriter",
              "skill": "inkwriter_industry_vertical_copy",
              "step_index": 5,
              "latency_ms": 1234,
              "generations": [
                {
                  "gen_id": "gn_xxx",
                  "model": "gpt-4o",
                  "prompt_tokens": 800,
                  "completion_tokens": 400,
                  "cost_usd": 0.006,
                  "latency_ms": 1234,
                  "status": "success",
                  "scores": [
                    {"name": "copy_quality.quality", "value": 0.85, "scorer": "llm-judge"}
                  ]
                }
              ]
            }
          ]
        }
        """
        try:
            from llm_call_logger import get_llm_call_logger
            logger = get_llm_call_logger()
            detail = logger.get_trace_detail(trace_id)
            if not detail:
                return JSONResponse({"error": "Trace 不存在"}, status_code=404)
            return detail
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    # ── Dashboard：成本/token/延迟趋势 ────────────────────────────
    @router.get("/dashboard")
    def get_dashboard(
        tenant_id: str = Query("tenant_main"),
        days: int = Query(30, le=365),
    ):
        """
        Dashboard 数据（对应 Langfuse Dashboard）。
        前端：渲染折线图（recharts/echarts）：
          - daily_trend：每日成本 + token + 调用次数（折线图 X 轴）
          - by_model：按模型分组的成本饼图
          - by_lobster：按龙虾分组的成本柱状图
          - avg_latency_ms：平均延迟
          - total_cost_usd：本期总成本

        前端 echarts 示例：
          series: [{name:"cost", data: daily_trend.map(d=>d.cost)}, ...]
          xAxis: {data: daily_trend.map(d=>d.day)}
        """
        try:
            from llm_call_logger import get_llm_call_logger
            logger = get_llm_call_logger()
            summary = logger.get_cost_summary(tenant_id=tenant_id, days=days)
            return summary
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    # ── Score 分析：质量评分趋势 ───────────────────────────────────
    @router.get("/scores/analytics")
    def get_score_analytics(
        tenant_id: str = Query("tenant_main"),
        score_name: str = Query("copy_quality.quality"),
        days: int = Query(30, le=365),
    ):
        """
        评分趋势分析（对应 Langfuse Score Analytics）。
        前端：渲染折线图（每日平均质量分）+ 高质量率饼图。
        用途：监控 Prompt 改动是否导致质量下降（回归检测）。

        响应示例：
        {
          "avg_score": 0.834,
          "high_quality_rate": 0.72,  # score >= 0.8 的比例
          "daily_trend": [
            {"day": "2026-03-01", "avg_score": 0.81, "count": 12},
            ...
          ]
        }
        """
        try:
            from llm_call_logger import get_llm_call_logger
            logger = get_llm_call_logger()
            return logger.get_score_analytics(
                tenant_id=tenant_id, score_name=score_name, days=days
            )
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    # ── 队列监控 Dashboard ────────────────────────────────────────
    @router.get("/queue/stats")
    def get_queue_stats(
        tenant_id: str = Query(""),
    ):
        """
        任务队列监控（对应 Langfuse Worker Dashboard）。
        前端：渲染队列状态仪表盘：
          - pending/running/completed/failed 计数（数字卡片）
          - by_type：按任务类型的状态分布（堆叠柱状图）
          - recent_failures：最近失败任务列表（可点击查看详情）
        """
        try:
            from task_queue import get_task_queue
            queue = get_task_queue()
            return queue.get_stats(tenant_id=tenant_id)
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @router.get("/queue/jobs")
    def list_queue_jobs(
        status: str = Query(""),
        task_type: str = Query(""),
        tenant_id: str = Query(""),
        limit: int = Query(50),
    ):
        """列出任务列表（支持过滤）"""
        try:
            from task_queue import get_task_queue
            queue = get_task_queue()
            jobs = queue.list_jobs(status=status, task_type=task_type,
                                    tenant_id=tenant_id, limit=limit)
            return {"total": len(jobs), "jobs": jobs}
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @router.get("/queue/jobs/{job_id}")
    def get_job_detail(job_id: str):
        """任务详情（含重试历史）"""
        try:
            from task_queue import get_task_queue
            queue = get_task_queue()
            job = queue.get_job(job_id)
            if not job:
                return JSONResponse({"error": "Job 不存在"}, status_code=404)
            return job
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    # ── Prompt 统计 ───────────────────────────────────────────────
    @router.get("/prompts")
    def list_prompts(lobster: str = Query("")):
        """Prompt 列表（含生产版本号）"""
        try:
            from prompt_registry import get_prompt_registry
            reg = get_prompt_registry()
            return reg.list_prompts(lobster=lobster or None)
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @router.get("/prompts/{name}/versions")
    def list_prompt_versions(name: str):
        """Prompt 版本列表"""
        try:
            from prompt_registry import get_prompt_registry
            reg = get_prompt_registry()
            return reg.list_versions(name)
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @router.get("/prompts/{name}/diff")
    def get_prompt_diff(
        name: str,
        version_a: int = Query(...),
        version_b: int = Query(...),
    ):
        """Prompt 版本 Diff"""
        try:
            from prompt_registry import get_prompt_registry
            reg = get_prompt_registry()
            return reg.diff(name, version_a, version_b)
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @router.post("/prompts/{name}/promote")
    def promote_prompt(
        name: str,
        version: int = Query(...),
        target_label: str = Query("production"),
    ):
        """切换 Prompt 生产版本"""
        try:
            from prompt_registry import get_prompt_registry
            reg = get_prompt_registry()
            ok = reg.promote(name, version, target_label)
            return {"success": ok, "name": name, "version": version, "label": target_label}
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @router.get("/prompts/{name}/usage")
    def get_prompt_usage(name: str, days: int = Query(30)):
        """Prompt 版本使用统计"""
        try:
            from prompt_registry import get_prompt_registry
            reg = get_prompt_registry()
            return reg.get_usage_stats(name, days=days)
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    # ── 数据集 API ────────────────────────────────────────────────
    @router.get("/datasets")
    def list_datasets(tenant_id: str = Query("tenant_main")):
        """数据集列表"""
        try:
            from dataset_store import get_dataset_store
            ds = get_dataset_store()
            return ds.list_datasets(tenant_id=tenant_id)
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @router.get("/datasets/{name}/stats")
    def get_dataset_stats(name: str):
        """数据集统计"""
        try:
            from dataset_store import get_dataset_store
            ds = get_dataset_store()
            return ds.get_dataset_stats(name)
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    # ── 配额使用摘要 ──────────────────────────────────────────────
    @router.get("/quota/summary")
    def get_quota_summary(tenant_id: str = Query("tenant_main")):
        """配额使用摘要（进度条数据）"""
        try:
            from quota_middleware import get_quota_store
            store = get_quota_store()
            return store.get_usage_summary(tenant_id=tenant_id)
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    # ── API Key 管理 ──────────────────────────────────────────────
    @router.get("/api-keys")
    def list_api_keys(tenant_id: str = Query("tenant_main")):
        """列出 API Key"""
        try:
            from api_key_manager import get_api_key_manager
            mgr = get_api_key_manager()
            return mgr.list_keys(tenant_id=tenant_id)
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @router.post("/api-keys")
    def create_api_key(
        tenant_id: str = Query("tenant_main"),
        label: str = Query(""),
        tag: str = Query("production"),
    ):
        """创建 API Key"""
        try:
            from api_key_manager import get_api_key_manager
            mgr = get_api_key_manager()
            return mgr.create_key(tenant_id=tenant_id, label=label, tag=tag)
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @router.delete("/api-keys/{key_id}")
    def revoke_api_key(key_id: str):
        """吊销 API Key"""
        try:
            from api_key_manager import get_api_key_manager
            mgr = get_api_key_manager()
            ok = mgr.revoke_key(key_id)
            return {"success": ok, "key_id": key_id}
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    return router
