# CODEX-PC-04: 技能效力评级系统

> **优先级**: P2 | **算力**: 中 | **来源**: `docs/PUACLAW_BORROWING_ANALYSIS.md`
> **增强**: CODEX-OCM-01 (LobsterSkillRegistry) — 本任务为其增加 `effectiveness_rating` 维度
> **依赖**: CODEX-OCM-01 必须先落地
> **涉及文件**: `dragon-senate-saas-v2/lobster_skill_registry.py`、`dragon-senate-saas-v2/lobster_pool_manager.py`、`dragon-senate-saas-v2/app.py`、`packages/lobsters/lobster-*/role-card.json`

---

## 背景

PUAClaw 的 🦞1-5 级龙虾评级系统虽然是伪数据，但其评估框架设计值得借鉴。每项技术都有：名称 + 描述 + 合规性提升百分比 + 推荐场景。

当前我们的 `LobsterSkillRegistry` (CODEX-OCM-01) 有 46 个技能注册，但每个技能缺少：
1. **效力评级** — 这个技能在真实场景中的表现如何？
2. **行业适配矩阵** — 这个技能在哪个行业效果最好？
3. **历史表现数据** — 执行了多少次？成功率多少？
4. **推荐权重** — Commander 选择技能时应该优先推荐哪个？

## 目标

为 46 个技能增加效力评级系统，让 Commander 在选择技能时有数据依据，让客户在 Dashboard 上一眼看到哪些技能最有效。

## 交付物

### 1. `LobsterSkill` 增加效力评级字段

在 CODEX-OCM-01 落地的 `lobster_skill_registry.py` 中，扩展 `LobsterSkill` dataclass：

```python
@dataclass
class SkillEffectivenessRating:
    """技能效力评级"""
    overall: int = 3                          # 总体评级 1-5
    by_industry: Dict[str, int] = field(default_factory=dict)  # 行业评级 {"beauty": 5, "b2b": 2}
    by_channel: Dict[str, int] = field(default_factory=dict)   # 渠道评级 {"xiaohongshu": 5, "douyin": 3}
    sample_size: int = 0                      # 评级样本量
    last_calibrated: Optional[str] = None     # 最后校准时间
    confidence: float = 0.0                   # 置信度 0-1（样本量越大越高）
    
    def get_industry_rating(self, industry: str) -> int:
        """获取某行业的评级，无数据时返回总体评级"""
        return self.by_industry.get(industry, self.overall)
    
    def get_channel_rating(self, channel: str) -> int:
        """获取某渠道的评级，无数据时返回总体评级"""
        return self.by_channel.get(channel, self.overall)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "overall": self.overall,
            "by_industry": self.by_industry,
            "by_channel": self.by_channel,
            "sample_size": self.sample_size,
            "last_calibrated": self.last_calibrated,
            "confidence": self.confidence,
        }


@dataclass
class LobsterSkill:
    # ... 已有字段 (来自 CODEX-OCM-01) ...
    
    # 新增效力评级
    effectiveness: SkillEffectivenessRating = field(default_factory=SkillEffectivenessRating)
    
    def to_api_dict(self) -> Dict[str, Any]:
        d = {
            # ... 已有序列化 ...
        }
        d["effectiveness"] = self.effectiveness.to_dict()
        return d
```

### 2. 初始效力评级种子

为 46 个技能设定初始效力评级（人工评估，后续由数据校准）：

```python
# 在 register_builtin_skills() 中
registry.register(LobsterSkill(
    id="inkwriter_copy_generate",
    name="成交文案生成",
    # ...
    effectiveness=SkillEffectivenessRating(
        overall=4,
        by_industry={"beauty": 5, "mother_baby": 4, "3c": 3, "b2b": 2, "education": 4},
        by_channel={"xiaohongshu": 5, "douyin": 4, "wechat": 4, "weibo": 3},
        sample_size=0,  # 初始无数据
        confidence=0.0,
    ),
))

registry.register(LobsterSkill(
    id="radar_web_search",
    name="全网信号搜索",
    # ...
    effectiveness=SkillEffectivenessRating(
        overall=4,
        by_industry={"beauty": 4, "3c": 5, "finance": 3, "b2b": 4},
        by_channel={},  # 信号搜索不区分渠道
        sample_size=0,
        confidence=0.0,
    ),
))

# ... 其他 44 个技能类似
```

### 3. 效力评级自动校准器

在 `dragon-senate-saas-v2/` 新增 `skill_effectiveness_calibrator.py`：

```python
"""
SkillEffectivenessCalibrator — 基于执行历史自动校准技能效力评级

从 lobster_pool_manager.py 的 step reward 数据中，
统计每个技能在不同行业/渠道下的表现，自动更新评级。
"""
from typing import Dict, List, Optional
from datetime import datetime
from lobster_skill_registry import LobsterSkillRegistry, SkillEffectivenessRating


class SkillEffectivenessCalibrator:
    """技能效力评级校准器"""
    
    def __init__(self, registry: LobsterSkillRegistry):
        self._registry = registry
    
    def calibrate_from_rewards(self, reward_history: List[Dict]) -> Dict[str, SkillEffectivenessRating]:
        """
        从 step reward 历史中校准评级
        
        reward_history 格式:
        [
            {
                "skill_id": "inkwriter_copy_generate",
                "industry": "beauty",
                "channel": "xiaohongshu",
                "reward": 0.85,  # 0-1
                "timestamp": "2026-03-31T10:00:00Z"
            }
        ]
        """
        # 按技能聚合
        skill_rewards: Dict[str, List[Dict]] = {}
        for r in reward_history:
            skill_id = r.get("skill_id", "")
            if skill_id not in skill_rewards:
                skill_rewards[skill_id] = []
            skill_rewards[skill_id].append(r)
        
        results = {}
        for skill_id, rewards in skill_rewards.items():
            skill = self._registry.get(skill_id)
            if not skill:
                continue
            
            # 总体评级: reward 均值映射到 1-5
            avg_reward = sum(r["reward"] for r in rewards) / len(rewards)
            overall = max(1, min(5, round(avg_reward * 5)))
            
            # 按行业聚合
            industry_rewards: Dict[str, List[float]] = {}
            for r in rewards:
                ind = r.get("industry", "")
                if ind:
                    industry_rewards.setdefault(ind, []).append(r["reward"])
            by_industry = {
                ind: max(1, min(5, round(sum(rs) / len(rs) * 5)))
                for ind, rs in industry_rewards.items()
            }
            
            # 按渠道聚合
            channel_rewards: Dict[str, List[float]] = {}
            for r in rewards:
                ch = r.get("channel", "")
                if ch:
                    channel_rewards.setdefault(ch, []).append(r["reward"])
            by_channel = {
                ch: max(1, min(5, round(sum(rs) / len(rs) * 5)))
                for ch, rs in channel_rewards.items()
            }
            
            # 置信度: 样本量越大越高，100 条以上为 1.0
            confidence = min(1.0, len(rewards) / 100)
            
            new_rating = SkillEffectivenessRating(
                overall=overall,
                by_industry=by_industry,
                by_channel=by_channel,
                sample_size=len(rewards),
                last_calibrated=datetime.utcnow().isoformat(),
                confidence=confidence,
            )
            
            # 更新注册表
            skill.effectiveness = new_rating
            results[skill_id] = new_rating
        
        return results
    
    def get_recommended_skills(
        self,
        lobster_id: str,
        industry: Optional[str] = None,
        channel: Optional[str] = None,
        top_n: int = 5,
    ) -> List[Dict]:
        """
        获取推荐技能列表（按效力评级排序）
        
        Commander 在选择龙虾执行技能时调用此方法。
        """
        skills = self._registry.get_by_lobster(lobster_id)
        
        scored = []
        for s in skills:
            if not s.enabled:
                continue
            score = s.effectiveness.overall
            if industry:
                score = s.effectiveness.get_industry_rating(industry)
            if channel:
                ch_score = s.effectiveness.get_channel_rating(channel)
                score = (score + ch_score) / 2  # 取行业+渠道均值
            scored.append({"skill": s, "score": score, "confidence": s.effectiveness.confidence})
        
        scored.sort(key=lambda x: (x["score"], x["confidence"]), reverse=True)
        return scored[:top_n]
```

### 4. API 端点

在 `app.py` 中新增：

```python
# GET /api/skills/{skill_id}/effectiveness — 获取技能效力评级
@app.get("/api/skills/{skill_id}/effectiveness")
def get_skill_effectiveness(skill_id: str):
    skill = registry.get(skill_id)
    if not skill:
        raise HTTPException(404, f"Skill {skill_id} not found")
    return skill.effectiveness.to_dict()

# GET /api/skills/recommended?lobster_id=inkwriter&industry=beauty&channel=xiaohongshu
@app.get("/api/skills/recommended")
def get_recommended_skills(lobster_id: str, industry: str = None, channel: str = None, top_n: int = 5):
    calibrator = SkillEffectivenessCalibrator(registry)
    recommendations = calibrator.get_recommended_skills(lobster_id, industry, channel, top_n)
    return [{"skill_id": r["skill"]["id"], "name": r["skill"]["name"], "score": r["score"], "confidence": r["confidence"]} for r in recommendations]

# POST /api/skills/calibrate — 触发效力评级校准
@app.post("/api/skills/calibrate")
def calibrate_skills():
    # 从 lobster_pool_manager 获取 reward 历史
    reward_history = pool_manager.get_reward_history()
    calibrator = SkillEffectivenessCalibrator(registry)
    results = calibrator.calibrate_from_rewards(reward_history)
    return {"calibrated": len(results), "skills": list(results.keys())}
```

### 5. 与 Commander Router 集成

在 `commander_router.py` 中，选择龙虾执行技能时使用推荐：

```python
# Commander 在阵容选择阶段
calibrator = SkillEffectivenessCalibrator(registry)
recommended = calibrator.get_recommended_skills(
    lobster_id="inkwriter",
    industry=mission.industry,
    channel=mission.target_channel,
    top_n=3,
)
# 优先使用评级最高的技能
selected_skill = recommended[0]["skill"] if recommended else fallback_skill
```

### 6. 前端对齐

#### 技能卡片展示效力评级

```typescript
interface SkillEffectiveness {
  overall: number;                    // 1-5 星
  by_industry: Record<string, number>;
  by_channel: Record<string, number>;
  sample_size: number;
  last_calibrated: string | null;
  confidence: number;                 // 0-1
}

// 技能卡片组件
// - 显示 overall 星级（⭐⭐⭐⭐ 4/5）
// - 当选中行业时，显示该行业的评级
// - confidence < 0.3 时显示"评级待验证"标签
// - 支持点击查看 by_industry / by_channel 详情表
```

#### 技能推荐面板

```typescript
// 在策略配置页，选中行业+渠道后：
// GET /api/skills/recommended?lobster_id=inkwriter&industry=beauty&channel=xiaohongshu
// 展示推荐技能排行榜，带评分和置信度
```

#### 校准触发按钮

- 在技能管理页右上角添加"重新校准评级"按钮
- 调用 `POST /api/skills/calibrate`
- 展示校准结果（多少个技能被更新）

## 约束

- 初始评级由人工设定，校准器只在有足够数据（sample_size > 10）时才覆盖人工评级
- 评级是**租户级别**的——不同客户的同一技能可能有不同评级
- 校准器的输入来自 `lobster_pool_manager.py` 已有的 step reward 数据，不引入新的数据源
- 评级不影响技能的启用/禁用，只影响推荐排序

## 验收标准

1. `LobsterSkill` 包含 `effectiveness: SkillEffectivenessRating` 字段
2. 46 个内置技能都有初始效力评级（overall + by_industry + by_channel）
3. `SkillEffectivenessCalibrator` 能从 reward 历史正确计算评级
4. `GET /api/skills/{id}/effectiveness` 返回完整评级数据
5. `GET /api/skills/recommended` 按评级排序返回推荐列表
6. `POST /api/skills/calibrate` 能触发重新校准
7. 前端技能卡片展示星级评级
