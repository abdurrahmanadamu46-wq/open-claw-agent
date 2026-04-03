# CODEX-UC-01: 用例模板系统

> **编号**: CODEX-UC-01
> **优先级**: P1
> **算力**: 中
> **来源**: awesome-openclaw-usecases-zh (AGENT-GUIDE.md + 46 个标准化用例)
> **前端对齐**: `web/src/app/operations/usecases/page.tsx` — 场景模板选择 + 一键配置页面

---

## 一、背景

awesome-openclaw-usecases-zh 用 46 个标准化用例证明：**统一格式的场景模板是用户上手的最快路径**。
我们的龙虾系统有 46 个技能但**没有任何用例/场景模板**，用户不知道"能做什么"以及"怎么开始"。

用例模板 ≠ 技能。技能是龙虾的能力；用例是"用什么龙虾 + 什么技能 + 什么配置 → 解决什么问题"的端到端方案。

---

## 二、目标

1. 建立标准化的用例模板格式
2. 预置 15 个核心用例，覆盖主要业务场景
3. 前端展示用例市场页面，支持一键应用

---

## 三、用例模板标准格式

### 3.1 模板 Schema `packages/usecase-templates/schema.json`（新建）

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["id", "name", "category", "difficulty", "lobsters", "description", "setup_steps"],
  "properties": {
    "id": { "type": "string", "pattern": "^uc-[a-z0-9-]+$" },
    "name": { "type": "string" },
    "name_en": { "type": "string" },
    "category": {
      "type": "string",
      "enum": ["content_creation", "social_media", "customer_service", "competitive_intel", "ecommerce", "lead_gen", "analytics", "devops"]
    },
    "difficulty": { "type": "string", "enum": ["beginner", "intermediate", "advanced"] },
    "description": { "type": "string" },
    "pain_point": { "type": "string" },
    "lobsters": {
      "type": "array",
      "items": { "type": "string", "enum": ["radar", "strategist", "inkwriter", "visualizer", "dispatcher", "echoer", "catcher", "abacus", "followup"] }
    },
    "skills_required": {
      "type": "array",
      "items": { "type": "string" }
    },
    "channels": {
      "type": "array",
      "items": { "type": "string" }
    },
    "setup_steps": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["step", "action"],
        "properties": {
          "step": { "type": "integer" },
          "action": { "type": "string" },
          "code_type": { "type": "string", "enum": ["bash", "config", "prompt", "none"] },
          "code": { "type": "string" },
          "requires_user_input": { "type": "boolean" }
        }
      }
    },
    "scheduler_config": {
      "type": "object",
      "description": "可选的定时调度配置，关联 CODEX-TD-02",
      "properties": {
        "kind": { "type": "string", "enum": ["cron", "every", "once"] },
        "schedule": { "type": "string" },
        "session_mode": { "type": "string", "enum": ["shared", "isolated"] }
      }
    },
    "tips": { "type": "array", "items": { "type": "string" } },
    "estimated_cost_per_run": { "type": "string" },
    "tags": { "type": "array", "items": { "type": "string" } }
  }
}
```

### 3.2 示例用例 `packages/usecase-templates/uc-xiaohongshu-autopilot.json`

```json
{
  "id": "uc-xiaohongshu-autopilot",
  "name": "小红书内容自动化",
  "name_en": "Xiaohongshu Content Autopilot",
  "category": "social_media",
  "difficulty": "intermediate",
  "description": "从选题、文案、封面图到定时发布的全流程自动化，支持多账号管理",
  "pain_point": "每篇笔记从构思到发布至少一小时，日更多账号时间翻倍",
  "lobsters": ["radar", "inkwriter", "visualizer", "dispatcher"],
  "skills_required": ["trend_detection", "copy_generation", "image_generation", "scheduled_publish"],
  "channels": ["xiaohongshu"],
  "setup_steps": [
    { "step": 1, "action": "配置小红书账号", "code_type": "config", "requires_user_input": true,
      "code": "在 web 控制台 → 渠道管理 → 添加小红书账号，扫码登录" },
    { "step": 2, "action": "选择内容方向", "code_type": "prompt", "requires_user_input": true,
      "code": "请设定你的小红书账号定位（如：美妆/穿搭/美食/科技），触须虾将据此追踪热点" },
    { "step": 3, "action": "配置发布频率", "code_type": "config", "requires_user_input": true,
      "code": "建议每天 1-3 篇，发布时间选择 10:00/18:00/21:00 三个高峰期" },
    { "step": 4, "action": "启动自动化", "code_type": "none", "requires_user_input": false,
      "code": "系统自动创建定时任务：触须虾追热点 → 吐墨虾写文案 → 幻影虾做封面 → 点兵虾发布" }
  ],
  "scheduler_config": {
    "kind": "cron",
    "schedule": "0 9 * * *",
    "session_mode": "isolated"
  },
  "tips": [
    "⚠️ 每天不超过 3-5 篇，避免触发平台风控",
    "💡 AI 生成内容建议人工审核后再发布",
    "📊 使用金算虾分析哪类内容表现最好，持续优化选题"
  ],
  "estimated_cost_per_run": "$0.15-0.30",
  "tags": ["中国特色", "社交媒体", "内容创作", "定时发布"]
}
```

### 3.3 API 路由 `dragon-senate-saas-v2/usecase_registry.py`（新建）

```python
"""
CODEX-UC-01: 用例模板注册表

提供用例模板的 CRUD API，前端用例市场页面对接。
"""

import json
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger("usecase_registry")

TEMPLATE_DIR = Path("packages/usecase-templates")

class UsecaseRegistry:
    def __init__(self, template_dir: str = None):
        self._dir = Path(template_dir) if template_dir else TEMPLATE_DIR
        self._cache: dict[str, dict] = {}
        self._load_all()

    def _load_all(self):
        self._cache.clear()
        for f in self._dir.glob("uc-*.json"):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                self._cache[data["id"]] = data
            except Exception as e:
                logger.warning(f"Failed to load usecase {f.name}: {e}")
        logger.info(f"Loaded {len(self._cache)} usecase templates")

    def list_usecases(self, category: Optional[str] = None, difficulty: Optional[str] = None) -> list[dict]:
        results = list(self._cache.values())
        if category:
            results = [u for u in results if u.get("category") == category]
        if difficulty:
            results = [u for u in results if u.get("difficulty") == difficulty]
        return results

    def get_usecase(self, usecase_id: str) -> Optional[dict]:
        return self._cache.get(usecase_id)

    def get_categories(self) -> list[dict]:
        cats = {}
        for u in self._cache.values():
            c = u.get("category", "other")
            cats.setdefault(c, 0)
            cats[c] += 1
        return [{"category": k, "count": v} for k, v in sorted(cats.items())]


def register_usecase_routes(app, registry: UsecaseRegistry):
    """前端对齐: GET /api/usecases, GET /api/usecases/{id}, GET /api/usecases/categories"""

    @app.get("/api/usecases")
    async def list_usecases(category: str = None, difficulty: str = None):
        return {"usecases": registry.list_usecases(category, difficulty)}

    @app.get("/api/usecases/categories")
    async def list_categories():
        return {"categories": registry.get_categories()}

    @app.get("/api/usecases/{usecase_id}")
    async def get_usecase(usecase_id: str):
        uc = registry.get_usecase(usecase_id)
        if not uc:
            from fastapi import HTTPException
            raise HTTPException(404, f"Usecase {usecase_id} not found")
        return uc
```

---

## 四、前端对齐清单

| API | 前端页面 | 功能 |
|-----|---------|------|
| `GET /api/usecases` | `web/src/app/operations/usecases/page.tsx` | 用例市场：卡片网格，按分类/难度筛选 |
| `GET /api/usecases/categories` | 同上侧边栏 | 分类导航 |
| `GET /api/usecases/{id}` | `web/src/app/operations/usecases/[id]/page.tsx` | 用例详情：步骤向导 + 一键配置 |

---

## 五、首批预置用例清单

| # | ID | 名称 | 难度 | 涉及龙虾 |
|---|-----|------|------|---------|
| 1 | `uc-xiaohongshu-autopilot` | 小红书内容自动化 | ⭐⭐ | radar+inkwriter+visualizer+dispatcher |
| 2 | `uc-daily-morning-brief` | 每日早报 | ⭐ | radar+inkwriter |
| 3 | `uc-competitive-intelligence` | 竞品情报周报 | ⭐⭐ | radar+catcher+abacus |
| 4 | `uc-multi-channel-customer-service` | 多渠道客服 | ⭐⭐ | echoer+followup |
| 5 | `uc-ecommerce-sales-assistant` | 电商销售助手 | ⭐⭐ | radar+strategist+abacus |
| 6 | `uc-content-factory` | 多Agent内容工厂 | ⭐⭐⭐ | radar+inkwriter+visualizer+dispatcher |
| 7 | `uc-lead-capture-pipeline` | 线索获取管线 | ⭐⭐ | catcher+followup+abacus |
| 8 | `uc-feishu-ai-assistant` | 飞书AI助手 | ⭐ | echoer |
| 9 | `uc-dingtalk-ai-assistant` | 钉钉AI助手 | ⭐ | echoer |
| 10 | `uc-wecom-ai-assistant` | 企业微信AI助手 | ⭐ | echoer |
| 11 | `uc-douyin-content-pipeline` | 抖音内容管线 | ⭐⭐⭐ | radar+inkwriter+visualizer+dispatcher |
| 12 | `uc-a-share-monitor` | A股行情监控 | ⭐⭐ | radar+abacus |
| 13 | `uc-personal-crm` | 个人CRM | ⭐ | catcher+followup |
| 14 | `uc-podcast-pipeline` | 播客制作管线 | ⭐⭐ | radar+inkwriter+visualizer |
| 15 | `uc-inventory-alert` | 库存预警 | ⭐ | radar+dispatcher |

---

## 六、验收标准

- [ ] 用例模板 Schema 已定义并通过验证
- [ ] ≥ 15 个预置用例 JSON 文件
- [ ] 3 个 API 端点正常工作
- [ ] 前端用例市场页面可展示+筛选
- [ ] 用例详情页可按步骤引导配置
