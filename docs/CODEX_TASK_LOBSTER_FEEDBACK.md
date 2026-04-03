# CODEX TASK: 龙虾输出人工反馈收集系统（LobsterFeedbackCollector）

**优先级：P1**  
**来源：OPENWEBUI_BORROWING_ANALYSIS.md P1-2**  
**借鉴自**：Open WebUI `routers/evaluations.py` + `models/feedbacks.py`

---

## 背景

当前龙虾质量评测仅靠 `llm_quality_judge.py`（LLM 自评），无真实用户反馈闭环。
借鉴 Open WebUI 的 👍👎 人工评分系统，建立**龙虾输出质量人工标注飞轮**：

```
龙虾产出 → 运营人员评分(👍/👎/星级) → 标注原因 → dataset_store 积累 → 微调训练数据
```

---

## 实现方案

### 后端：`dragon-senate-saas-v2/lobster_feedback_collector.py`

```python
from datetime import datetime
from enum import Enum
from pydantic import BaseModel
from typing import Optional
import uuid


class FeedbackRating(str, Enum):
    THUMBS_UP = "thumbs_up"
    THUMBS_DOWN = "thumbs_down"
    STAR_1 = "star_1"
    STAR_2 = "star_2"
    STAR_3 = "star_3"
    STAR_4 = "star_4"
    STAR_5 = "star_5"


class FeedbackTag(str, Enum):
    ACCURATE = "accurate"           # 信息准确
    CREATIVE = "creative"           # 创意好
    ON_BRAND = "on_brand"           # 符合品牌调性
    TOO_LONG = "too_long"           # 太长
    TOO_SHORT = "too_short"         # 太短
    OFF_TOPIC = "off_topic"         # 跑题
    WRONG_TONE = "wrong_tone"       # 语气不对
    FACTUAL_ERROR = "factual_error" # 事实错误
    NEEDS_REVISION = "needs_revision" # 需修改


class LobsterFeedback(BaseModel):
    feedback_id: str = None
    task_id: str                    # 关联的龙虾任务
    lobster_id: str                 # 哪只龙虾产出的
    tenant_id: str
    user_id: str                    # 评分者
    rating: FeedbackRating
    tags: list[FeedbackTag] = []
    comment: Optional[str] = None   # 文字备注
    revised_output: Optional[str] = None  # 运营改写后的正确版本（黄金标准）
    created_at: datetime = None

    def model_post_init(self, __context):
        if not self.feedback_id:
            self.feedback_id = f"fb_{uuid.uuid4().hex[:12]}"
        if not self.created_at:
            self.created_at = datetime.utcnow()


class LobsterFeedbackCollector:
    """
    龙虾输出人工反馈收集器
    - 存储用户评分
    - 聚合质量统计
    - 导出训练数据集
    """

    def __init__(self, db, dataset_store):
        self.db = db
        self.dataset_store = dataset_store

    async def submit(self, feedback: LobsterFeedback) -> dict:
        """提交一条反馈"""
        await self.db.feedbacks.insert_one(feedback.model_dump())
        # 如果包含 revised_output，自动写入 dataset_store 作为训练数据
        if feedback.revised_output:
            await self._push_to_dataset(feedback)
        return {"feedback_id": feedback.feedback_id, "status": "accepted"}

    async def get_lobster_stats(self, lobster_id: str, tenant_id: str, days: int = 30) -> dict:
        """统计某只龙虾近 N 天的质量分布"""
        pipeline = [
            {"$match": {"lobster_id": lobster_id, "tenant_id": tenant_id}},
            {"$group": {
                "_id": "$rating",
                "count": {"$sum": 1},
            }}
        ]
        result = await self.db.feedbacks.aggregate(pipeline).to_list(None)
        thumbs_up = sum(r["count"] for r in result if r["_id"] == "thumbs_up")
        thumbs_down = sum(r["count"] for r in result if r["_id"] == "thumbs_down")
        total = thumbs_up + thumbs_down
        return {
            "lobster_id": lobster_id,
            "thumbs_up": thumbs_up,
            "thumbs_down": thumbs_down,
            "satisfaction_rate": round(thumbs_up / total * 100, 1) if total else None,
            "total_feedbacks": total,
        }

    async def _push_to_dataset(self, feedback: LobsterFeedback):
        """将带有人工改写的反馈写入训练数据集"""
        task = await self.db.tasks.find_one({"task_id": feedback.task_id})
        if not task:
            return
        await self.dataset_store.add_sample(
            dataset_id=f"lobster_{feedback.lobster_id}_golden",
            input=task.get("prompt", ""),
            output=feedback.revised_output,
            metadata={
                "original_output": task.get("output", ""),
                "rating": feedback.rating,
                "tags": feedback.tags,
                "comment": feedback.comment,
            }
        )
```

### API 路由

```python
# POST   /api/v1/feedbacks          → 提交反馈
# GET    /api/v1/feedbacks/{task_id} → 查询任务反馈列表
# GET    /api/v1/lobsters/{id}/quality-stats → 龙虾质量统计
# GET    /api/v1/feedbacks/export?lobster_id=xxx → 导出训练数据集
```

### 前端集成位置

```
任务详情页 /operations/tasks/[task_id]
  └── 输出卡片底部
        ├── 👍 好  👎 差  ⭐⭐⭐⭐⭐
        ├── 标签多选（准确/太长/跑题/...）
        ├── 文字备注（可选）
        └── "提交改写版本"（可选，写入黄金数据集）

龙虾控制台 /operations/lobsters/[id]
  └── "质量分析"面板
        ├── 好评率趋势图（7/30/90天）
        ├── 常见差评标签 TOP5
        └── 待处理反馈列表
```

---

## 验收标准

- [ ] `LobsterFeedback` 数据模型完整（rating/tags/comment/revised_output）
- [ ] `POST /api/v1/feedbacks` 正常写入
- [ ] 提交含 `revised_output` 的反馈自动写入 `dataset_store`
- [ ] `GET /api/v1/lobsters/{id}/quality-stats` 返回好评率统计
- [ ] 前端任务详情页展示评分区（👍👎+标签）
- [ ] 龙虾控制台展示质量趋势图

---

*Codex Task | 来源：OPENWEBUI_BORROWING_ANALYSIS.md P1-2 | 2026-04-02*
