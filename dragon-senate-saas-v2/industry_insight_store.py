"""
行业洞察暂存库
Dragon Senate — Industry Insight Store

这是平台护城河的核心机制：
  每个企业客户的活动结果，脱敏后贡献到行业知识库。
  当同类洞察积累到 n≥3 时，自动升级为"已验证行业规律"，
  写入 enterprise_memory.py 的 INDUSTRY_KNOWLEDGE_TREE（Layer 1）。

数据流：
  企业活动复盘（campaign_lifecycle_manager）
    → _maybe_contribute_to_industry_kb()
    → IndustryInsightStore.submit_insight()
    → 累积到 n≥3 → merge_to_layer1()
    → enterprise_memory.INDUSTRY_KNOWLEDGE_TREE 更新
    → 所有同类新客户入驻时自动获益

脱敏原则：
  ✅ 保留：行业标签/城市级别/策略类型/内容类型/效果指标/平台
  ❌ 移除：企业名称/具体话术/客户姓名/账号信息/联系方式/价格数字

置信度等级：
  single_sample  — 单家企业样本（仅供参考，不对外输出）
  emerging       — 2家企业出现相同规律（值得关注）
  confirmed      — 3家及以上企业验证（写入 Layer 1，全平台共享）
  invalidated    — 被后续数据推翻（标记为失效）
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, asdict
from datetime import datetime
from enum import Enum
from typing import Any


# ─────────────────────────────────────────
# 数据结构
# ─────────────────────────────────────────

class InsightConfidence(str, Enum):
    SINGLE_SAMPLE = "single_sample"    # n=1
    EMERGING = "emerging"              # n=2
    CONFIRMED = "confirmed"            # n≥3，写入 Layer 1
    INVALIDATED = "invalidated"        # 被后续数据推翻


@dataclass
class InsightEvidence:
    """单条支持证据（来自一家企业的一次活动，已脱敏）"""
    evidence_id: str
    industry_l1: str                   # 行业一级：如"美业健康"
    industry_l2: str                   # 行业二级：如"美容院"
    city_tier: str                     # 城市级别："一线/新一线/三线"
    price_position: str                # 价格定位："高端/中端/平价"
    strategy_type: str                 # 策略类型（StrategyType.value）
    content_type: str                  # 内容类型（如"before-after对比"）
    platform: str                      # 平台（如"抖音/小红书"）
    metric_name: str                   # 效果指标名称
    metric_value: float                # 效果值
    baseline_value: float              # 行业/历史基准值
    lift_percent: float                # 提升百分比（vs 基准）
    contributed_at: str                # 贡献时间（脱敏，只保留年月）
    # 以下字段绝对不出现在此结构中：
    # tenant_id / enterprise_name / campaign_id / 具体话术 / 客户信息


@dataclass
class IndustryInsight:
    """
    行业洞察条目（可能由多条证据支撑）
    
    例：
      insight_key: "美业健康>美容院>三线城市>before-after>完播率"
      summary: "三线城市美容院的before-after对比类内容，完播率高于同行均值67%"
      confidence: "confirmed"
      evidence_count: 5
    """
    insight_id: str
    insight_key: str                   # 唯一定位键（行业+城市+内容类型+指标）
    summary: str                       # 一句话洞察描述（可对外输出）
    industry_l1: str
    industry_l2: str
    city_tier: str
    strategy_type: str
    content_type: str
    platform: str
    metric_name: str
    avg_lift_percent: float            # 所有证据的平均提升幅度
    min_lift_percent: float            # 最低提升（稳健性参考）
    max_lift_percent: float            # 最高提升
    confidence: str = InsightConfidence.SINGLE_SAMPLE.value
    evidence_count: int = 0
    evidence_ids: list[str] = field(default_factory=list)
    merged_to_layer1: bool = False     # 是否已写入 Layer 1
    merged_at: str = ""
    invalidated: bool = False
    invalidated_reason: str = ""
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now().isoformat())

    def recalculate_confidence(self) -> None:
        """根据证据数量重新计算置信度"""
        if self.invalidated:
            self.confidence = InsightConfidence.INVALIDATED.value
        elif self.evidence_count >= 3:
            self.confidence = InsightConfidence.CONFIRMED.value
        elif self.evidence_count == 2:
            self.confidence = InsightConfidence.EMERGING.value
        else:
            self.confidence = InsightConfidence.SINGLE_SAMPLE.value


# ─────────────────────────────────────────
# 存储引擎
# ─────────────────────────────────────────

class IndustryInsightStore:
    """
    行业洞察暂存库
    
    使用 JSON 文件持久化（生产环境替换为数据库）：
      data/industry_insights/insights.json   ← 洞察条目
      data/industry_insights/evidences.json  ← 原始证据（脱敏）
    
    使用示例：
      store = IndustryInsightStore()
      
      # 活动复盘后提交洞察
      store.submit_insight(
          industry_l1="美业健康",
          industry_l2="美容院",
          city_tier="三线城市",
          price_position="高端",
          strategy_type="内容增长",
          content_type="before-after对比",
          platform="抖音",
          metric_name="完播率",
          metric_value=0.41,
          baseline_value=0.23,
      )
      
      # 查询某行业的已验证洞察
      insights = store.get_confirmed_insights(
          industry_l1="美业健康",
          industry_l2="美容院",
      )
    """

    # 置信度升级阈值
    EMERGING_THRESHOLD = 2    # n≥2 → emerging
    CONFIRMED_THRESHOLD = 3   # n≥3 → confirmed，触发写入 Layer 1
    # 显著性阈值：提升幅度超过此值才值得记录
    MIN_LIFT_THRESHOLD = 0.20  # 提升超过20%才记录

    def __init__(self, data_dir: str = "data/industry_insights") -> None:
        self._data_dir = data_dir
        os.makedirs(data_dir, exist_ok=True)
        self._insights_path = os.path.join(data_dir, "insights.json")
        self._evidences_path = os.path.join(data_dir, "evidences.json")
        self._insights: dict[str, IndustryInsight] = self._load_insights()
        self._evidences: dict[str, InsightEvidence] = self._load_evidences()

    # ── 提交洞察 ─────────────────────────────

    def submit_insight(
        self,
        industry_l1: str,
        industry_l2: str,
        city_tier: str,
        price_position: str,
        strategy_type: str,
        content_type: str,
        platform: str,
        metric_name: str,
        metric_value: float,
        baseline_value: float,
    ) -> IndustryInsight | None:
        """
        从一次活动复盘中提取并提交洞察。

        自动处理：
        1. 计算提升幅度，低于阈值的不记录
        2. 脱敏（不存储任何企业标识）
        3. 查找或创建对应的洞察条目
        4. 更新证据计数和置信度
        5. 置信度升级到 confirmed 时自动触发 Layer 1 写入

        返回：更新后的 IndustryInsight，或 None（低于阈值）
        """
        # Step 1: 计算提升幅度，判断是否达到显著性阈值
        if baseline_value <= 0:
            return None
        lift_percent = (metric_value - baseline_value) / baseline_value * 100

        if abs(lift_percent) < self.MIN_LIFT_THRESHOLD * 100:
            # 提升幅度不显著，不记录
            return None

        # Step 2: 构建脱敏证据
        evidence_id = self._generate_evidence_id(
            industry_l1, industry_l2, city_tier, content_type, metric_name
        )
        evidence = InsightEvidence(
            evidence_id=evidence_id,
            industry_l1=industry_l1,
            industry_l2=industry_l2,
            city_tier=city_tier,
            price_position=price_position,
            strategy_type=strategy_type,
            content_type=content_type,
            platform=platform,
            metric_name=metric_name,
            metric_value=round(metric_value, 4),
            baseline_value=round(baseline_value, 4),
            lift_percent=round(lift_percent, 1),
            contributed_at=datetime.now().strftime("%Y-%m"),  # 只保留年月
        )
        self._evidences[evidence_id] = evidence

        # Step 3: 定位或创建洞察条目
        insight_key = self._build_insight_key(
            industry_l1, industry_l2, city_tier, content_type, metric_name
        )
        insight = self._insights.get(insight_key)

        if insight is None:
            # 第一次出现这个组合
            insight = IndustryInsight(
                insight_id=insight_key,
                insight_key=insight_key,
                summary=self._generate_summary(
                    industry_l1, industry_l2, city_tier, content_type, metric_name, lift_percent
                ),
                industry_l1=industry_l1,
                industry_l2=industry_l2,
                city_tier=city_tier,
                strategy_type=strategy_type,
                content_type=content_type,
                platform=platform,
                metric_name=metric_name,
                avg_lift_percent=round(lift_percent, 1),
                min_lift_percent=round(lift_percent, 1),
                max_lift_percent=round(lift_percent, 1),
                evidence_count=0,
            )

        # Step 4: 更新证据计数和统计
        insight.evidence_count += 1
        insight.evidence_ids.append(evidence_id)
        insight.updated_at = datetime.now().isoformat()

        # 重新计算平均/最值
        all_lifts = [
            self._evidences[eid].lift_percent
            for eid in insight.evidence_ids
            if eid in self._evidences
        ]
        if all_lifts:
            insight.avg_lift_percent = round(sum(all_lifts) / len(all_lifts), 1)
            insight.min_lift_percent = round(min(all_lifts), 1)
            insight.max_lift_percent = round(max(all_lifts), 1)

        # 更新 summary（用最新平均值）
        insight.summary = self._generate_summary(
            industry_l1, industry_l2, city_tier, content_type, metric_name,
            insight.avg_lift_percent
        )

        # Step 5: 更新置信度
        prev_confidence = insight.confidence
        insight.recalculate_confidence()

        # Step 6: 置信度升级到 confirmed，触发写入 Layer 1
        if (
            insight.confidence == InsightConfidence.CONFIRMED.value
            and prev_confidence != InsightConfidence.CONFIRMED.value
            and not insight.merged_to_layer1
        ):
            self._merge_to_layer1(insight)

        # 持久化
        self._insights[insight_key] = insight
        self._save()

        return insight

    # ── 查询洞察 ─────────────────────────────

    def get_confirmed_insights(
        self,
        industry_l1: str,
        industry_l2: str = "",
        city_tier: str = "",
        platform: str = "",
    ) -> list[IndustryInsight]:
        """
        查询某行业的已验证洞察（confidence=confirmed）
        
        用于：
          - 策略生成时注入相关行业规律
          - 新客户入驻诊断时参考
          - 龙虾执行时的行业最佳实践参考
        """
        results = []
        for insight in self._insights.values():
            if insight.invalidated:
                continue
            if insight.confidence != InsightConfidence.CONFIRMED.value:
                continue
            if insight.industry_l1 != industry_l1:
                continue
            if industry_l2 and insight.industry_l2 != industry_l2:
                continue
            if city_tier and insight.city_tier != city_tier:
                continue
            if platform and insight.platform != platform:
                continue
            results.append(insight)

        # 按提升幅度排序（最高的最先）
        results.sort(key=lambda x: -x.avg_lift_percent)
        return results

    def get_emerging_insights(
        self,
        industry_l1: str,
        industry_l2: str = "",
    ) -> list[IndustryInsight]:
        """查询正在积累证据的新兴洞察（emerging），供内部参考"""
        return [
            i for i in self._insights.values()
            if i.confidence == InsightConfidence.EMERGING.value
            and i.industry_l1 == industry_l1
            and (not industry_l2 or i.industry_l2 == industry_l2)
            and not i.invalidated
        ]

    def get_insight_for_prompt(
        self,
        industry_l1: str,
        industry_l2: str = "",
        city_tier: str = "",
        top_n: int = 3,
    ) -> str:
        """
        返回适合注入 LLM Prompt 的行业洞察文字。
        
        用于：策略生成时，给苏思注入行业规律背景知识。
        
        示例输出：
          "已验证行业规律（基于平台积累数据）：
           1. 三线城市美容院的before-after对比类内容，
              完播率平均高于行业均值67%（已验证，n=5）
           2. 高端美容院节点活动不适合低价促销……"
        """
        insights = self.get_confirmed_insights(industry_l1, industry_l2, city_tier)[:top_n]
        if not insights:
            return ""

        lines = ["已验证行业规律（基于平台积累数据）："]
        for i, insight in enumerate(insights, 1):
            lines.append(
                f"{i}. {insight.summary}"
                f"（已验证，n={insight.evidence_count}，"
                f"提升范围 {insight.min_lift_percent}%~{insight.max_lift_percent}%）"
            )
        return "\n".join(lines)

    # ── 失效标记 ─────────────────────────────

    def invalidate_insight(
        self,
        insight_key: str,
        reason: str,
    ) -> bool:
        """
        标记某条洞察为失效（被后续数据推翻）。
        
        触发场景：
          - 多家新客户的数据显示该规律不成立
          - 平台算法大规模变化导致历史规律失效
        """
        insight = self._insights.get(insight_key)
        if not insight:
            return False
        insight.invalidated = True
        insight.invalidated_reason = reason
        insight.confidence = InsightConfidence.INVALIDATED.value
        insight.updated_at = datetime.now().isoformat()
        self._save()
        return True

    # ── 写入 Layer 1 ─────────────────────────

    def _merge_to_layer1(self, insight: IndustryInsight) -> None:
        """
        把已验证的洞察合并到 enterprise_memory.py 的 INDUSTRY_KNOWLEDGE_TREE。
        
        实际更新路径：
          INDUSTRY_KNOWLEDGE_TREE[industry_l1][industry_l2]["content_patterns"]
            .append(validated_pattern)
        
        当前实现：写入 data/layer1_pending/ 目录，
        由定时任务（或人工审核）合并到 enterprise_memory.py。
        
        这样设计的原因：
          - Layer 1 是代码中的静态字典，不能被运行时随意覆写
          - 需要人工审核后确认，再更新到代码文件
          - 防止异常数据污染全平台知识库
        """
        pending_dir = os.path.join(self._data_dir, "layer1_pending")
        os.makedirs(pending_dir, exist_ok=True)

        pending_path = os.path.join(
            pending_dir,
            f"{insight.insight_id.replace('>', '_')}_{datetime.now().strftime('%Y%m%d')}.json"
        )

        # 生成 Layer 1 更新补丁（可以被工程师直接应用）
        layer1_patch = {
            "action": "add_content_pattern",
            "target_path": f"INDUSTRY_KNOWLEDGE_TREE['{insight.industry_l1}']['{insight.industry_l2}']",
            "field": "content_patterns",
            "value": {
                "pattern_name": insight.content_type,
                "platform": insight.platform,
                "metric": insight.metric_name,
                "avg_lift_percent": insight.avg_lift_percent,
                "confidence": "confirmed",
                "evidence_count": insight.evidence_count,
                "city_tier_applicability": insight.city_tier,
                "description": insight.summary,
                "validated_at": datetime.now().strftime("%Y-%m"),
            },
            "insight_key": insight.insight_key,
            "submitted_at": datetime.now().isoformat(),
            "review_status": "pending",  # 等待人工审核后合并
        }

        with open(pending_path, "w", encoding="utf-8") as f:
            json.dump(layer1_patch, f, ensure_ascii=False, indent=2)

        # 标记为已生成合并请求（但还未实际合并）
        insight.merged_to_layer1 = True
        insight.merged_at = datetime.now().isoformat()

    def list_pending_layer1_patches(self) -> list[dict]:
        """列出待审核合并到 Layer 1 的补丁"""
        pending_dir = os.path.join(self._data_dir, "layer1_pending")
        if not os.path.exists(pending_dir):
            return []
        patches = []
        for fname in os.listdir(pending_dir):
            if fname.endswith(".json"):
                fpath = os.path.join(pending_dir, fname)
                with open(fpath, "r", encoding="utf-8") as f:
                    patches.append(json.load(f))
        return sorted(patches, key=lambda x: x.get("submitted_at", ""))

    def approve_layer1_patch(self, insight_key: str) -> dict | None:
        """
        审核通过某个 Layer 1 补丁，返回可以被工程师复制粘贴到
        enterprise_memory.py 的代码片段。
        """
        patches = self.list_pending_layer1_patches()
        patch = next((p for p in patches if p.get("insight_key") == insight_key), None)
        if not patch:
            return None

        value = patch["value"]
        target_path_parts = str(patch.get("target_path") or "").split("'")
        section_key = target_path_parts[1] if len(target_path_parts) > 1 else ""
        field_key = target_path_parts[3] if len(target_path_parts) > 3 else ""
        code_snippet = (
            f"# 自动生成 - 行业洞察写入 Layer 1\n"
            f"# 来源：{value['evidence_count']}家企业验证，提升幅度 {value['avg_lift_percent']}%\n"
            f"# 适用范围：{value['city_tier_applicability']} / {value['platform']}\n"
            f"# 验证时间：{value['validated_at']}\n"
            f"# ─────────────────\n"
            f"# 在 INDUSTRY_KNOWLEDGE_TREE['{section_key}']"
            f"['{field_key}'] 的 content_patterns 中添加：\n"
            f"# {{\n"
            f"#   'pattern': '{value['pattern_name']}',\n"
            f"#   'platform': '{value['platform']}',\n"
            f"#   'lift': '+{value['avg_lift_percent']}% {value['metric']}',\n"
            f"#   'note': '{value['description']}',\n"
            f"# }}\n"
        )
        patch["code_snippet"] = code_snippet
        patch["review_status"] = "approved"
        return patch

    # ── 统计视图 ─────────────────────────────

    def get_platform_stats(self) -> dict:
        """
        平台级别统计（运营控制台用）
        
        返回：
        {
            "total_insights": 42,
            "confirmed": 15,
            "emerging": 12,
            "single_sample": 13,
            "invalidated": 2,
            "top_industries": [...],
            "layer1_pending_count": 3,
        }
        """
        confirmed = emerging = single = invalidated = 0
        industry_counts: dict[str, int] = {}

        for insight in self._insights.values():
            key = f"{insight.industry_l1}>{insight.industry_l2}"
            industry_counts[key] = industry_counts.get(key, 0) + 1

            if insight.invalidated:
                invalidated += 1
            elif insight.confidence == InsightConfidence.CONFIRMED.value:
                confirmed += 1
            elif insight.confidence == InsightConfidence.EMERGING.value:
                emerging += 1
            else:
                single += 1

        top_industries = sorted(
            industry_counts.items(), key=lambda x: -x[1]
        )[:5]

        return {
            "total_insights": len(self._insights),
            "confirmed": confirmed,
            "emerging": emerging,
            "single_sample": single,
            "invalidated": invalidated,
            "top_industries": [
                {"industry": k, "insight_count": v} for k, v in top_industries
            ],
            "layer1_pending_count": len(self.list_pending_layer1_patches()),
        }

    # ── 内部工具 ─────────────────────────────

    def _build_insight_key(
        self,
        industry_l1: str,
        industry_l2: str,
        city_tier: str,
        content_type: str,
        metric_name: str,
    ) -> str:
        """构建唯一洞察键（用于去重和查找）"""
        return f"{industry_l1}>{industry_l2}>{city_tier}>{content_type}>{metric_name}"

    def _generate_evidence_id(
        self,
        industry_l1: str,
        industry_l2: str,
        city_tier: str,
        content_type: str,
        metric_name: str,
    ) -> str:
        """生成证据 ID（时间戳 + 行业组合哈希）"""
        ts = datetime.now().strftime("%Y%m%d%H%M%S%f")[:17]
        combo = f"{industry_l1}{industry_l2}{city_tier}{content_type}{metric_name}"
        short_hash = str(abs(hash(combo)))[:6]
        return f"ev_{ts}_{short_hash}"

    def _generate_summary(
        self,
        industry_l1: str,
        industry_l2: str,
        city_tier: str,
        content_type: str,
        metric_name: str,
        avg_lift_percent: float,
    ) -> str:
        """生成人类可读的洞察描述（用于 prompt 注入和运营控制台展示）"""
        direction = "高于" if avg_lift_percent > 0 else "低于"
        pct = abs(round(avg_lift_percent, 0))
        return (
            f"{city_tier}{industry_l1}{industry_l2}的"
            f"「{content_type}」类内容，"
            f"{metric_name}{direction}行业均值约 {pct}%"
        )

    # ── 持久化 ────────────────────────────────

    def _load_insights(self) -> dict[str, IndustryInsight]:
        if not os.path.exists(self._insights_path):
            return {}
        try:
            with open(self._insights_path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            return {
                k: IndustryInsight(**v) for k, v in raw.items()
            }
        except Exception:
            return {}

    def _load_evidences(self) -> dict[str, InsightEvidence]:
        if not os.path.exists(self._evidences_path):
            return {}
        try:
            with open(self._evidences_path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            return {
                k: InsightEvidence(**v) for k, v in raw.items()
            }
        except Exception:
            return {}

    def _save(self) -> None:
        """持久化到 JSON 文件"""
        with open(self._insights_path, "w", encoding="utf-8") as f:
            json.dump(
                {k: asdict(v) for k, v in self._insights.items()},
                f, ensure_ascii=False, indent=2,
            )
        with open(self._evidences_path, "w", encoding="utf-8") as f:
            json.dump(
                {k: asdict(v) for k, v in self._evidences.items()},
                f, ensure_ascii=False, indent=2,
            )


# ─────────────────────────────────────────
# 模拟数据生成器（开发/演示用）
# ─────────────────────────────────────────

def seed_demo_insights(store: IndustryInsightStore) -> None:
    """
    写入演示用的行业洞察种子数据。
    用于开发环境演示平台护城河效果。
    """
    demo_data = [
        # 三线城市美容院 - before-after 完播率
        dict(industry_l1="美业健康", industry_l2="美容院", city_tier="三线城市",
             price_position="高端", strategy_type="内容增长",
             content_type="before-after对比", platform="抖音",
             metric_name="完播率", metric_value=0.41, baseline_value=0.23),
        dict(industry_l1="美业健康", industry_l2="美容院", city_tier="三线城市",
             price_position="中端", strategy_type="内容增长",
             content_type="before-after对比", platform="抖音",
             metric_name="完播率", metric_value=0.38, baseline_value=0.23),
        dict(industry_l1="美业健康", industry_l2="美容院", city_tier="三线城市",
             price_position="高端", strategy_type="内容增长",
             content_type="before-after对比", platform="抖音",
             metric_name="完播率", metric_value=0.44, baseline_value=0.23),

        # 三线城市美容院 - 节点活动低价促销（负面案例）
        dict(industry_l1="美业健康", industry_l2="美容院", city_tier="三线城市",
             price_position="高端", strategy_type="活动引流",
             content_type="低价促销活动", platform="抖音",
             metric_name="客单价维持率", metric_value=0.58, baseline_value=0.91),
        dict(industry_l1="美业健康", industry_l2="美容院", city_tier="三线城市",
             price_position="高端", strategy_type="活动引流",
             content_type="低价促销活动", platform="小红书",
             metric_name="客单价维持率", metric_value=0.62, baseline_value=0.91),
        dict(industry_l1="美业健康", industry_l2="美容院", city_tier="三线城市",
             price_position="高端", strategy_type="活动引流",
             content_type="低价促销活动", platform="抖音",
             metric_name="客单价维持率", metric_value=0.55, baseline_value=0.91),

        # 餐饮本地门店 - 数字冲击类内容 CTR
        dict(industry_l1="餐饮", industry_l2="中餐", city_tier="三线城市",
             price_position="中端", strategy_type="内容增长",
             content_type="数字冲击（排队/城市打卡）", platform="抖音",
             metric_name="CTR", metric_value=0.089, baseline_value=0.054),
        dict(industry_l1="餐饮", industry_l2="中餐", city_tier="三线城市",
             price_position="中端", strategy_type="内容增长",
             content_type="数字冲击（排队/城市打卡）", platform="抖音",
             metric_name="CTR", metric_value=0.079, baseline_value=0.054),
        dict(industry_l1="餐饮", industry_l2="中餐", city_tier="新一线城市",
             price_position="中端", strategy_type="内容增长",
             content_type="数字冲击（排队/城市打卡）", platform="抖音",
             metric_name="CTR", metric_value=0.071, baseline_value=0.054),
    ]

    for d in demo_data:
        store.submit_insight(**d)


