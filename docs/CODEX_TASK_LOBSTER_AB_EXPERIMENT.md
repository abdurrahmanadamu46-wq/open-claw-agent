# CODEX TASK: 龙虾 A/B 实验引擎 + 特性标志

**优先级：P1**  
**来源：POSTHOG_BORROWING_ANALYSIS.md P1-1 + P1-2**  
**借鉴自**：PostHog `scenes/experiments/` + `posthog/feature_flags/`

---

## 背景

当前龙虾优化完全依赖人工判断哪个 Prompt 更好，无科学对比机制。  
借鉴 PostHog 的 **A/B 实验 + 特性标志**，实现：

```
新龙虾技能/Prompt → Feature Flag 灰度（先5%租户）
                  → A/B 实验对比（统计显著性判断哪个更好）
                  → 胜出方全量发布
```

---

## A. 特性标志引擎

### `dragon-senate-saas-v2/feature_flag_engine.py`

```python
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
import hashlib


@dataclass
class FeatureFlag:
    flag_key: str           # 如 "new_followup_prompt_v2"
    enabled: bool = True
    rollout_pct: float = 100.0   # 0-100，百分比灰度
    tenant_allowlist: list[str] = field(default_factory=list)  # 指定开放租户
    description: str = ""

    def evaluate(self, tenant_id: str, user_id: str = "") -> bool:
        """评估某个租户/用户是否命中此 Flag"""
        if not self.enabled:
            return False
        # 租户白名单直接开放
        if self.tenant_allowlist and tenant_id in self.tenant_allowlist:
            return True
        # 基于 hash 的确定性百分比分流（同一用户每次结果一致）
        key = f"{self.flag_key}:{tenant_id}:{user_id}"
        hash_val = int(hashlib.md5(key.encode()).hexdigest(), 16)
        bucket = (hash_val % 10000) / 100.0  # 0 ~ 99.99
        return bucket < self.rollout_pct


class FeatureFlagEngine:
    """特性标志引擎（内存缓存 + 动态热加载）"""

    def __init__(self):
        self._flags: dict[str, FeatureFlag] = {}

    def register(self, flag: FeatureFlag):
        self._flags[flag.flag_key] = flag

    def is_enabled(self, flag_key: str, tenant_id: str, user_id: str = "") -> bool:
        flag = self._flags.get(flag_key)
        if flag is None:
            return False
        return flag.evaluate(tenant_id, user_id)

    def get_all_flags(self, tenant_id: str, user_id: str = "") -> dict[str, bool]:
        return {k: f.evaluate(tenant_id, user_id) for k, f in self._flags.items()}
```

---

## B. A/B 实验引擎

### `dragon-senate-saas-v2/lobster_ab_experiment.py`

```python
from __future__ import annotations
import math
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class ExperimentStatus(str, Enum):
    DRAFT = "draft"
    RUNNING = "running"
    CONCLUDED = "concluded"


@dataclass
class ExperimentVariant:
    name: str                    # "control" / "variant_a"
    lobster_id: str              # 对应的龙虾
    prompt_version: str          # Prompt 版本号
    traffic_pct: float = 50.0   # 流量比例
    # 指标
    impressions: int = 0
    conversions: int = 0

    @property
    def conversion_rate(self) -> float:
        return self.conversions / self.impressions if self.impressions > 0 else 0.0


@dataclass
class LobsterExperiment:
    """龙虾 A/B 实验"""
    experiment_id: str
    name: str
    metric: str               # 衡量指标："lead_score_avg" | "reply_rate" | "conversion_rate"
    variants: list[ExperimentVariant] = field(default_factory=list)
    status: ExperimentStatus = ExperimentStatus.DRAFT
    winner: Optional[str] = None

    def assign_variant(self, tenant_id: str, task_id: str) -> ExperimentVariant:
        """确定性分流：同一租户+任务每次得到相同变体"""
        import hashlib
        key = f"{self.experiment_id}:{tenant_id}:{task_id}"
        bucket = (int(hashlib.md5(key.encode()).hexdigest(), 16) % 10000) / 100.0
        cumulative = 0.0
        for v in self.variants:
            cumulative += v.traffic_pct
            if bucket < cumulative:
                return v
        return self.variants[-1]

    def record_result(self, variant_name: str, converted: bool):
        for v in self.variants:
            if v.name == variant_name:
                v.impressions += 1
                if converted:
                    v.conversions += 1

    def statistical_significance(self) -> dict:
        """
        计算两组间 Z-test 统计显著性（p值）
        借鉴 PostHog experiments 的统计方法
        """
        if len(self.variants) < 2:
            return {"significant": False, "p_value": 1.0}

        ctrl = self.variants[0]
        test = self.variants[1]

        if ctrl.impressions < 30 or test.impressions < 30:
            return {"significant": False, "reason": "样本量不足30"}

        p1 = ctrl.conversion_rate
        p2 = test.conversion_rate
        n1, n2 = ctrl.impressions, test.impressions
        p_pool = (ctrl.conversions + test.conversions) / (n1 + n2)

        if p_pool == 0 or p_pool == 1:
            return {"significant": False, "reason": "转化率为0或1"}

        se = math.sqrt(p_pool * (1 - p_pool) * (1/n1 + 1/n2))
        z = (p2 - p1) / se if se > 0 else 0

        # 近似 p 值（双尾）
        p_value = 2 * (1 - self._normal_cdf(abs(z)))
        significant = p_value < 0.05

        return {
            "significant": significant,
            "p_value": round(p_value, 4),
            "z_score": round(z, 4),
            "control_rate": round(p1, 4),
            "test_rate": round(p2, 4),
            "lift": round((p2 - p1) / p1, 4) if p1 > 0 else 0,
            "winner": test.name if (significant and p2 > p1) else ctrl.name,
        }

    @staticmethod
    def _normal_cdf(x: float) -> float:
        """标准正态分布 CDF 近似"""
        return (1.0 + math.erf(x / math.sqrt(2))) / 2
```

---

## API 接口

```
# 特性标志
GET  /api/v1/feature-flags                      # 查询所有标志
POST /api/v1/feature-flags                      # 创建标志
PUT  /api/v1/feature-flags/{key}                # 修改（灰度比例/白名单）
GET  /api/v1/feature-flags/evaluate?tenant_id=  # 评估当前租户的所有标志

# A/B 实验
GET  /api/v1/experiments                        # 实验列表
POST /api/v1/experiments                        # 创建实验
PUT  /api/v1/experiments/{id}/start             # 启动实验
GET  /api/v1/experiments/{id}/results           # 查看结果（含显著性）
POST /api/v1/experiments/{id}/conclude          # 结束并选定胜出方
```

---

## 验收标准

### 特性标志
- [ ] `FeatureFlag.evaluate()` 基于 hash 的确定性百分比分流
- [ ] 租户白名单优先级高于百分比
- [ ] API CRUD 完整
- [ ] 前端标志管理页：列表 + 百分比滑块 + 白名单配置

### A/B 实验
- [ ] `assign_variant()` 确定性分流（同请求结果稳定）
- [ ] Z-test 统计显著性计算（p < 0.05 判定显著）
- [ ] `record_result()` 记录各变体曝光/转化
- [ ] 前端实验结果页：转化率对比 + 显著性指示 + 提升幅度
- [ ] 实验结束后自动更新对应 Feature Flag 为胜出变体

---

*Codex Task | 来源：POSTHOG_BORROWING_ANALYSIS.md P1-1+P1-2 | 2026-04-02*
