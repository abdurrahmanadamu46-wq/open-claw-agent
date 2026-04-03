from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import yaml

from workflow_engine import WORKFLOWS_DIR


@dataclass
class WorkflowTemplate:
    template_id: str
    name: str
    description: str
    category: str
    use_case: str
    workflow_yaml: str
    lobsters_required: list[str] = field(default_factory=list)
    estimated_duration_seconds: int = 60
    estimated_tokens: int = 2000
    difficulty: str = "beginner"
    tags: list[str] = field(default_factory=list)
    is_featured: bool = False
    use_count: int = 0
    created_by: str = "official"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _template_db() -> Path:
    path = (Path(__file__).resolve().parent / "data" / "workflow_template_gallery.sqlite").resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_template_db()))
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_schema() -> None:
    with _connect() as conn:
      conn.execute("CREATE TABLE IF NOT EXISTS template_usage (template_id TEXT PRIMARY KEY, use_count INTEGER NOT NULL DEFAULT 0)")
      conn.commit()


def _load_yaml(name: str) -> str:
    path = WORKFLOWS_DIR / name
    return path.read_text(encoding="utf-8")


_BASE_CONTENT = _load_yaml("content-campaign.yaml")
_BASE_HEALTH = _load_yaml("account-health-check.yaml")
_BASE_14STEP = _load_yaml("content-campaign-14step.yaml")
_BASE_DEFAULT = _load_yaml("default_mission.yaml")

OFFICIAL_TEMPLATES: list[WorkflowTemplate] = [
    WorkflowTemplate("tpl_ecom_product_copy", "电商产品文案生成", "输入产品卖点，输出多平台文案。", "电商", "淘宝/京东商品详情页文案", _BASE_CONTENT, ["strategist", "visualizer", "dispatcher"], 90, 3500, "beginner", ["电商", "文案"], True),
    WorkflowTemplate("tpl_ecom_review_reply", "差评自动回复", "分析差评情绪并生成回复。", "客服", "电商差评处理", _BASE_HEALTH, ["strategist", "followup"], 45, 1200, "beginner", ["客服", "差评"], True),
    WorkflowTemplate("tpl_social_douyin_script", "抖音爆款脚本", "生成抖音短视频脚本。", "社交媒体", "抖音内容生产", _BASE_CONTENT, ["strategist", "visualizer"], 60, 2200, "intermediate", ["抖音", "脚本"], True),
    WorkflowTemplate("tpl_social_xhs_note", "小红书种草笔记", "生成小红书种草笔记。", "社交媒体", "小红书图文内容", _BASE_CONTENT, ["strategist", "inkwriter"], 50, 1800, "beginner", ["小红书", "种草"], True),
    WorkflowTemplate("tpl_wechat_article", "公众号长文", "输出完整公众号文章。", "内容营销", "公众号文章生产", _BASE_CONTENT, ["strategist", "inkwriter"], 90, 4200, "intermediate", ["公众号", "文章"]),
    WorkflowTemplate("tpl_competitor_report", "竞品分析报告", "分析竞品内容与策略。", "数据分析", "竞品复盘", _BASE_14STEP, ["radar", "strategist", "abacus"], 180, 5000, "advanced", ["竞品", "报告"], True),
    WorkflowTemplate("tpl_account_health", "账号健康检查", "检查账号限流与增长异常。", "数据分析", "账号健康日报", _BASE_HEALTH, ["strategist", "followup"], 45, 1000, "beginner", ["健康检查"]),
    WorkflowTemplate("tpl_local_store_campaign", "本地门店活动内容", "围绕本地门店活动生成内容与分发计划。", "电商", "门店活动拉新", _BASE_CONTENT, ["strategist", "visualizer", "dispatcher"], 75, 2600, "intermediate", ["门店", "活动"]),
    WorkflowTemplate("tpl_hotel_growth", "酒店拉新 Campaign", "适配酒店 / 民宿行业增长动作。", "内容营销", "酒店拉新", _BASE_14STEP, ["radar", "strategist", "dispatcher"], 180, 5200, "advanced", ["酒店", "campaign"]),
    WorkflowTemplate("tpl_restaurant_hot_topic", "餐饮热点借势", "热点内容选题与发布。", "社交媒体", "餐饮热点运营", _BASE_CONTENT, ["radar", "strategist", "inkwriter"], 60, 2100, "intermediate", ["餐饮", "热点"]),
    WorkflowTemplate("tpl_beauty_launch", "美妆新品发布", "新品发布全链路模板。", "电商", "美妆新品上市", _BASE_14STEP, ["strategist", "inkwriter", "visualizer"], 180, 5400, "advanced", ["美妆", "新品"]),
    WorkflowTemplate("tpl_education_signup", "教育报名线索跟进", "从内容到高分线索跟进。", "客服", "教育机构招新", _BASE_14STEP, ["strategist", "catcher", "followup"], 180, 4300, "advanced", ["教育", "线索"]),
    WorkflowTemplate("tpl_fit_workout", "健身课程种草", "课程卖点内容与评论承接。", "社交媒体", "健身内容运营", _BASE_CONTENT, ["strategist", "echoer"], 60, 1600, "beginner", ["健身", "课程"]),
    WorkflowTemplate("tpl_retail_new_arrival", "零售上新通知", "新品上架同步内容与跟进。", "电商", "零售上新", _BASE_CONTENT, ["dispatcher", "followup"], 70, 1700, "beginner", ["零售", "上新"]),
    WorkflowTemplate("tpl_service_followup", "服务商回访链路", "高意向客户多触点回访。", "客服", "客户回访", _BASE_DEFAULT, ["followup", "abacus"], 90, 1500, "intermediate", ["回访", "服务商"]),
    WorkflowTemplate("tpl_lead_cleanup", "线索清洗评分", "去重、评分、回写 CRM。", "数据分析", "线索池整理", _BASE_DEFAULT, ["catcher", "abacus"], 90, 1800, "intermediate", ["线索", "评分"]),
    WorkflowTemplate("tpl_weekly_review", "周报复盘生成", "汇总执行结果和复盘建议。", "数据分析", "运营周报", _BASE_DEFAULT, ["abacus", "followup"], 80, 1900, "beginner", ["周报", "复盘"]),
    WorkflowTemplate("tpl_short_video_matrix", "短视频矩阵分发", "多平台分发与评论监控。", "社交媒体", "矩阵内容分发", _BASE_14STEP, ["dispatcher", "echoer"], 140, 3600, "advanced", ["矩阵", "分发"]),
    WorkflowTemplate("tpl_crm_welcome", "CRM 新客欢迎流", "新客户录入后自动触发欢迎内容。", "客服", "CRM 欢迎流", _BASE_DEFAULT, ["strategist", "followup"], 45, 900, "beginner", ["CRM", "欢迎"]),
    WorkflowTemplate("tpl_incident_notify", "通用错误通知", "工作流失败后的通知补偿模板。", "系统", "Error workflow", _BASE_DEFAULT, ["dispatcher"], 30, 500, "beginner", ["错误", "补偿"]),
]


class OfficialWorkflowTemplateGallery:
    def __init__(self) -> None:
        _ensure_schema()

    def _usage_map(self) -> dict[str, int]:
        with _connect() as conn:
            rows = conn.execute("SELECT template_id, use_count FROM template_usage").fetchall()
        return {str(row["template_id"]): int(row["use_count"] or 0) for row in rows}

    def list_templates(
        self,
        *,
        category: str | None = None,
        difficulty: str | None = None,
        featured_only: bool = False,
        search: str | None = None,
    ) -> list[dict[str, Any]]:
        usage = self._usage_map()
        rows = []
        keyword = str(search or "").strip().lower()
        for template in OFFICIAL_TEMPLATES:
            if category and template.category != category:
                continue
            if difficulty and template.difficulty != difficulty:
                continue
            if featured_only and not template.is_featured:
                continue
            if keyword and keyword not in f"{template.name} {template.description} {template.use_case}".lower():
                continue
            payload = template.to_dict()
            payload["use_count"] = usage.get(template.template_id, 0)
            rows.append(payload)
        return rows

    def get_template(self, template_id: str) -> WorkflowTemplate | None:
        return next((item for item in OFFICIAL_TEMPLATES if item.template_id == template_id), None)

    def create_workflow_from_template(self, *, template_id: str, workflow_name: str | None = None, tenant_id: str = "tenant_main") -> dict[str, Any]:
        template = self.get_template(template_id)
        if template is None:
            raise KeyError(template_id)
        payload = yaml.safe_load(template.workflow_yaml) or {}
        workflow_id = f"wf_{uuid.uuid4().hex[:10]}"
        payload["id"] = workflow_id
        payload["name"] = workflow_name or template.name
        payload["description"] = template.description
        payload["source_template_id"] = template.template_id
        payload["tenant_id"] = tenant_id
        target_path = WORKFLOWS_DIR / f"{workflow_id}.yaml"
        target_path.write_text(yaml.safe_dump(payload, allow_unicode=True, sort_keys=False), encoding="utf-8")
        with _connect() as conn:
            conn.execute(
                "INSERT INTO template_usage(template_id, use_count) VALUES (?, 1) ON CONFLICT(template_id) DO UPDATE SET use_count = use_count + 1",
                (template.template_id,),
            )
            conn.commit()
        return {"workflow_id": workflow_id, "workflow_path": str(target_path), "source_template_id": template.template_id}


_gallery: OfficialWorkflowTemplateGallery | None = None


def get_workflow_template_gallery() -> OfficialWorkflowTemplateGallery:
    global _gallery
    if _gallery is None:
        _gallery = OfficialWorkflowTemplateGallery()
    return _gallery
