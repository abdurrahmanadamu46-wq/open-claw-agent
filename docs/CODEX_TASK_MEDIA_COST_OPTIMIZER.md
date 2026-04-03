# CODEX TASK: 视频/图片 API 成本动态比价优化器
**任务ID**: CODEX-MEDIA-COST-001  
**优先级**: 🟡 P2（视频成本占 76.5%，降成本空间大）  
**依赖文件**: `dragon-senate-saas-v2/provider_registry.py`, `video_composer.py`  
**参考项目**: Replicate、fal.ai、Seedance 2.0（当前主力）  
**预计工期**: 2天

---

## 一、任务背景

V7 单席 AI 成本 ¥784/月，其中视频占 ¥600（76.5%）：
- 视频：20条 × 15s × ¥1/s × 2x损耗 = ¥600/席/月
- 图片：30张 × 2x × ¥0.29 = ¥17.4/席/月
- 数字人：约 ¥125/席/月
- LLM：约 ¥41/席/月

**当前问题**：`provider_registry.py` 已有多 Provider 路由机制，但只支持 LLM 模型切换，**视频/图片 Provider 没有接入比价路由**。

**优化目标**：
- 视频：Seedance 2.0 ¥1/s vs Kling ¥0.6/s vs Runway ¥0.8/s → 某些场景用更便宜的
- 图片：Imagen 4 ¥0.29/张 vs Flux Pro ¥0.05/张 vs DALL-E 3 ¥0.15/张 → 非关键场景用 Flux
- 预计节省：视频成本降 20-30%，图片成本降 50-80%（小项但积少成多）

---

## 二、核心模块设计

```python
# dragon-senate-saas-v2/media_cost_optimizer.py
"""
媒体生成成本动态优化器
根据任务类型、质量要求、当前预算消耗自动选择最优 Provider

接入 provider_registry.py 的多 Provider 路由机制
"""

from dataclasses import dataclass
from typing import Optional, Literal
from enum import Enum


class QualityTier(str, Enum):
    PREMIUM = "premium"     # 高质量（品牌视频/主图）→ 用最好的模型
    STANDARD = "standard"   # 标准质量（日常发布内容）→ 性价比优先
    DRAFT = "draft"         # 草稿/测试（A/B测试变体）→ 最便宜的


@dataclass
class MediaProvider:
    """媒体生成 Provider 配置"""
    name: str
    provider_type: Literal["video", "image"]
    cost_per_unit: float        # 视频=¥/秒，图片=¥/张
    quality_score: float        # 质量评分 0-1（基于历史 A/B 测试）
    avg_latency_seconds: float  # 平均生成耗时
    max_resolution: str         # 最大分辨率
    api_endpoint: str
    api_key_env: str            # 环境变量名
    is_available: bool = True   # 是否可用（熔断状态）
    daily_quota: int = 1000     # API 日限额
    daily_used: int = 0


# ═══════════════════════════════════════════════════════════
# V7 Provider 配置表（基于真实 API 定价 2026-04）
# ═══════════════════════════════════════════════════════════

VIDEO_PROVIDERS = [
    MediaProvider(
        name="seedance_2.0",
        provider_type="video",
        cost_per_unit=1.0,          # ¥1/秒
        quality_score=0.95,
        avg_latency_seconds=45,
        max_resolution="1080p",
        api_endpoint="https://api.seedance.com/v2/generate",
        api_key_env="SEEDANCE_API_KEY",
    ),
    MediaProvider(
        name="kling_v2",
        provider_type="video",
        cost_per_unit=0.6,          # ¥0.6/秒（比 Seedance 便宜 40%）
        quality_score=0.85,
        avg_latency_seconds=60,
        max_resolution="1080p",
        api_endpoint="https://api.klingai.com/v2/video/generate",
        api_key_env="KLING_API_KEY",
    ),
    MediaProvider(
        name="runway_gen3",
        provider_type="video",
        cost_per_unit=0.8,          # ¥0.8/秒
        quality_score=0.90,
        avg_latency_seconds=50,
        max_resolution="1080p",
        api_endpoint="https://api.runwayml.com/v1/generate",
        api_key_env="RUNWAY_API_KEY",
    ),
]

IMAGE_PROVIDERS = [
    MediaProvider(
        name="imagen_4",
        provider_type="image",
        cost_per_unit=0.29,         # ¥0.29/张
        quality_score=0.95,
        avg_latency_seconds=8,
        max_resolution="2048x2048",
        api_endpoint="https://generativelanguage.googleapis.com/v1/models/imagen-4",
        api_key_env="GOOGLE_AI_KEY",
    ),
    MediaProvider(
        name="flux_pro",
        provider_type="image",
        cost_per_unit=0.05,         # ¥0.05/张（比 Imagen 便宜 83%）
        quality_score=0.80,
        avg_latency_seconds=5,
        max_resolution="1024x1024",
        api_endpoint="https://api.fal.ai/fal-ai/flux/pro",
        api_key_env="FAL_AI_KEY",
    ),
    MediaProvider(
        name="dall_e_3",
        provider_type="image",
        cost_per_unit=0.15,         # ¥0.15/张
        quality_score=0.88,
        avg_latency_seconds=12,
        max_resolution="1024x1792",
        api_endpoint="https://api.openai.com/v1/images/generations",
        api_key_env="OPENAI_API_KEY",
    ),
]


class MediaCostOptimizer:
    """
    媒体成本优化器
    
    选择策略：
    - PREMIUM 质量 → 选 quality_score 最高的（不管价格）
    - STANDARD 质量 → 选 quality_score≥0.85 中最便宜的
    - DRAFT 质量 → 选最便宜的（quality_score≥0.75 即可）
    
    熔断机制：Provider API 连续失败3次 → 标记不可用 → 自动切换下一个
    """
    
    def __init__(self):
        self.video_providers = VIDEO_PROVIDERS.copy()
        self.image_providers = IMAGE_PROVIDERS.copy()
        self._failure_counts: dict[str, int] = {}
    
    def select_video_provider(
        self,
        quality: QualityTier = QualityTier.STANDARD,
        duration_seconds: int = 15,
        budget_remaining_pct: float = 1.0,  # 本月配额预算剩余比例
    ) -> MediaProvider:
        """
        选择视频生成 Provider
        
        特殊规则：
        - 月初（预算充足）→ 可以用贵的高质量模型
        - 月末（预算紧张，<30%）→ 自动降级到便宜模型
        - 品牌主图视频 → 强制 PREMIUM
        """
        available = [p for p in self.video_providers if p.is_available]
        
        # 月末预算紧张自动降级
        if budget_remaining_pct < 0.3 and quality != QualityTier.PREMIUM:
            quality = QualityTier.DRAFT
        
        if quality == QualityTier.PREMIUM:
            # 最高质量，不管价格
            candidates = sorted(available, key=lambda p: p.quality_score, reverse=True)
        elif quality == QualityTier.STANDARD:
            # 质量≥0.85 中最便宜
            candidates = [p for p in available if p.quality_score >= 0.85]
            candidates = sorted(candidates, key=lambda p: p.cost_per_unit)
        else:  # DRAFT
            # 最便宜，质量≥0.75
            candidates = [p for p in available if p.quality_score >= 0.75]
            candidates = sorted(candidates, key=lambda p: p.cost_per_unit)
        
        if not candidates:
            candidates = sorted(available, key=lambda p: p.cost_per_unit)
        
        selected = candidates[0]
        
        # 记录选择理由（给 abacus 复盘用）
        self._log_selection(
            provider=selected.name,
            type="video",
            quality=quality.value,
            cost=selected.cost_per_unit * duration_seconds,
            reason=f"质量={selected.quality_score}, 成本=¥{selected.cost_per_unit}/s"
        )
        
        return selected
    
    def select_image_provider(
        self,
        quality: QualityTier = QualityTier.STANDARD,
        count: int = 1,
        budget_remaining_pct: float = 1.0,
    ) -> MediaProvider:
        """选择图片生成 Provider（逻辑同视频）"""
        available = [p for p in self.image_providers if p.is_available]
        
        if budget_remaining_pct < 0.3 and quality != QualityTier.PREMIUM:
            quality = QualityTier.DRAFT
        
        if quality == QualityTier.PREMIUM:
            candidates = sorted(available, key=lambda p: p.quality_score, reverse=True)
        elif quality == QualityTier.STANDARD:
            candidates = [p for p in available if p.quality_score >= 0.85]
            candidates = sorted(candidates, key=lambda p: p.cost_per_unit)
        else:
            candidates = [p for p in available if p.quality_score >= 0.75]
            candidates = sorted(candidates, key=lambda p: p.cost_per_unit)
        
        if not candidates:
            candidates = sorted(available, key=lambda p: p.cost_per_unit)
        
        return candidates[0]
    
    def report_failure(self, provider_name: str):
        """Provider 失败时调用，累计3次自动熔断"""
        self._failure_counts[provider_name] = self._failure_counts.get(provider_name, 0) + 1
        if self._failure_counts[provider_name] >= 3:
            # 熔断
            for p in self.video_providers + self.image_providers:
                if p.name == provider_name:
                    p.is_available = False
    
    def report_success(self, provider_name: str):
        """Provider 成功时重置失败计数"""
        self._failure_counts[provider_name] = 0
    
    def estimate_monthly_cost(
        self,
        seat_count: int,
        video_quality_mix: dict = None,
        image_quality_mix: dict = None,
    ) -> dict:
        """
        预估月度媒体成本（给 abacus 复盘用）
        
        对比：全用 Seedance(¥1/s) vs 混合策略
        """
        if video_quality_mix is None:
            video_quality_mix = {"premium": 0.2, "standard": 0.6, "draft": 0.2}
        if image_quality_mix is None:
            image_quality_mix = {"premium": 0.1, "standard": 0.5, "draft": 0.4}
        
        # 视频成本
        videos_per_seat = 20
        video_seconds = 15
        
        baseline_video = videos_per_seat * video_seconds * 1.0 * seat_count  # 全 Seedance
        
        optimized_video = 0
        for tier, pct in video_quality_mix.items():
            provider = self.select_video_provider(QualityTier(tier))
            optimized_video += videos_per_seat * pct * video_seconds * provider.cost_per_unit * seat_count
        
        # 图片成本
        images_per_seat = 30
        baseline_image = images_per_seat * 0.29 * seat_count  # 全 Imagen 4
        
        optimized_image = 0
        for tier, pct in image_quality_mix.items():
            provider = self.select_image_provider(QualityTier(tier))
            optimized_image += images_per_seat * pct * provider.cost_per_unit * seat_count
        
        video_savings = baseline_video - optimized_video
        image_savings = baseline_image - optimized_image
        
        return {
            "seat_count": seat_count,
            "video": {
                "baseline_cost": round(baseline_video),
                "optimized_cost": round(optimized_video),
                "savings": round(video_savings),
                "savings_pct": round(video_savings / baseline_video * 100, 1),
            },
            "image": {
                "baseline_cost": round(baseline_image),
                "optimized_cost": round(optimized_image),
                "savings": round(image_savings),
                "savings_pct": round(image_savings / baseline_image * 100, 1) if baseline_image else 0,
            },
            "total_monthly_savings": round(video_savings + image_savings),
            "total_annual_savings": round((video_savings + image_savings) * 12),
        }
    
    def _log_selection(self, **kwargs):
        """记录 Provider 选择日志（接入 llm_call_logger 同类机制）"""
        pass  # 接入 observability_api
```

---

## 三、集成到 `video_composer.py`

```python
# dragon-senate-saas-v2/video_composer.py — 改造

from media_cost_optimizer import MediaCostOptimizer, QualityTier

class VideoComposer:
    def __init__(self):
        self.optimizer = MediaCostOptimizer()
    
    async def generate_video(
        self,
        prompt: str,
        duration: int = 15,
        quality: str = "standard",
        seat_id: str = None,
    ) -> dict:
        """
        生成视频（自动选择最优 Provider）
        """
        # 查询本月预算剩余
        budget_pct = await self._get_budget_remaining(seat_id)
        
        # 选择 Provider
        provider = self.optimizer.select_video_provider(
            quality=QualityTier(quality),
            duration_seconds=duration,
            budget_remaining_pct=budget_pct,
        )
        
        try:
            result = await self._call_provider(provider, prompt, duration)
            self.optimizer.report_success(provider.name)
            return {
                "video_url": result["url"],
                "provider": provider.name,
                "cost": round(provider.cost_per_unit * duration, 2),
                "quality_tier": quality,
            }
        except Exception as e:
            self.optimizer.report_failure(provider.name)
            # 自动 fallback 到下一个 Provider
            return await self.generate_video(prompt, duration, quality, seat_id)
```

---

## 四、验收标准

- [ ] `MediaCostOptimizer` 支持3种视频 Provider + 3种图片 Provider
- [ ] STANDARD 质量自动选择性价比最高的 Provider
- [ ] PREMIUM 质量强制选最高质量（不管价格）
- [ ] DRAFT 质量选最便宜的（A/B测试场景）
- [ ] 月末预算 <30% 自动降级到便宜 Provider
- [ ] Provider 连续失败3次自动熔断
- [ ] `estimate_monthly_cost()` 正确计算混合策略节省金额
- [ ] 100席场景：视频成本从 ¥30,000 降到约 ¥22,000（节省 ¥8,000/月）
