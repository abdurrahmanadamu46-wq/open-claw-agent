# CODEX TASK: 龙虾配置中心（LobsterConfigCenter）

**优先级：P1**  
**来源：ONYX_BORROWING_ANALYSIS.md P1-1**  
**借鉴自**：Onyx `web/src/app/admin/agents/` — AI 智能体一站式配置页

---

## 背景

当前运营配置龙虾需要分散到多个页面：`/operations/skills-pool`（技能）、`/operations/strategy`（策略）、`/operations/sessions`（会话）等，操作路径长、无法一眼看清某只龙虾的完整画像。

借鉴 Onyx `admin/agents/` 的设计思路：**一页面配齐角色卡 + 技能 + 知识库 + 工具 + 策略强度**。

---

## 实现

### 后端 API

```python
# dragon-senate-saas-v2/lobster_config_center.py

import time
import logging
from typing import Optional

logger = logging.getLogger(__name__)

VALID_LOBSTER_IDS = [
    "commander", "radar", "strategist", "inkwriter",
    "visualizer", "dispatcher", "echoer", "catcher", "abacus", "followup"
]


class LobsterConfigCenter:
    """
    龙虾配置中心 — 聚合单只龙虾的全部配置，供前端一页面展示和编辑
    
    聚合内容：
      1. 角色卡（role_card）：名称/人格/职责/核心工件
      2. 技能列表（skills）：当前激活技能 + 评级
      3. 工具列表（tools）：绑定的 MCP 工具
      4. 策略强度（strategy_level）：0-5级
      5. 自主策略（autonomy）：HITL/AutoApprove/FullAuto
      6. 知识库摘要（kb_summary）：记忆条数 / 最近更新时间
      7. 工作状态（status）：idle / running / error
    """

    def __init__(self, db, skill_registry, mcp_gateway, autonomy_policy, memory_service):
        self.db = db
        self.skill_registry = skill_registry
        self.mcp_gateway = mcp_gateway
        self.autonomy_policy = autonomy_policy
        self.memory_service = memory_service

    def get_lobster_config(self, lobster_id: str, tenant_id: str) -> dict:
        """获取单只龙虾完整配置快照"""
        if lobster_id not in VALID_LOBSTER_IDS:
            return {"error": f"未知龙虾: {lobster_id}"}

        role_card = self._get_role_card(lobster_id)
        skills = self._get_skills(lobster_id, tenant_id)
        tools = self._get_tools(lobster_id, tenant_id)
        strategy = self._get_strategy(lobster_id, tenant_id)
        autonomy = self._get_autonomy(lobster_id, tenant_id)
        kb_summary = self._get_kb_summary(lobster_id, tenant_id)
        status = self._get_status(lobster_id, tenant_id)

        return {
            "lobster_id": lobster_id,
            "tenant_id": tenant_id,
            "role_card": role_card,
            "skills": skills,
            "tools": tools,
            "strategy": strategy,
            "autonomy": autonomy,
            "kb_summary": kb_summary,
            "status": status,
            "snapshot_at": time.time(),
        }

    def list_all_lobsters(self, tenant_id: str) -> list[dict]:
        """列出所有龙虾的精简状态（用于配置中心列表页）"""
        result = []
        for lid in VALID_LOBSTER_IDS:
            role_card = self._get_role_card(lid)
            status = self._get_status(lid, tenant_id)
            result.append({
                "lobster_id": lid,
                "name_cn": role_card.get("name_cn", lid),
                "name_en": role_card.get("name_en", lid),
                "emoji": role_card.get("emoji", "🦞"),
                "role_desc": role_card.get("role_desc", ""),
                "status": status,
            })
        return result

    def update_lobster_config(
        self,
        lobster_id: str,
        tenant_id: str,
        patch: dict,
    ) -> dict:
        """
        批量更新龙虾配置（支持部分字段）
        
        patch 可包含：
          strategy_level (int 0-5)
          autonomy_mode  (str: hitl / auto_approve / full_auto)
          active_skills  (list[str] skill_id)
          active_tools   (list[str] tool_id)
          custom_prompt  (str 追加到角色 Prompt 的自定义指令)
        """
        updated = {}
        now = time.time()

        if "strategy_level" in patch:
            level = int(patch["strategy_level"])
            if 0 <= level <= 5:
                self.db.upsert("lobster_strategy", {
                    "lobster_id": lobster_id,
                    "tenant_id": tenant_id,
                    "strategy_level": level,
                    "updated_at": now,
                })
                updated["strategy_level"] = level

        if "autonomy_mode" in patch:
            mode = patch["autonomy_mode"]
            if mode in ("hitl", "auto_approve", "full_auto"):
                self.autonomy_policy.set_mode(lobster_id, tenant_id, mode)
                updated["autonomy_mode"] = mode

        if "active_skills" in patch:
            self.skill_registry.set_active_skills(
                lobster_id, tenant_id, patch["active_skills"]
            )
            updated["active_skills"] = patch["active_skills"]

        if "active_tools" in patch:
            self.mcp_gateway.set_lobster_tools(
                lobster_id, tenant_id, patch["active_tools"]
            )
            updated["active_tools"] = patch["active_tools"]

        if "custom_prompt" in patch:
            self.db.upsert("lobster_custom_prompts", {
                "lobster_id": lobster_id,
                "tenant_id": tenant_id,
                "custom_prompt": patch["custom_prompt"],
                "updated_at": now,
            })
            updated["custom_prompt"] = patch["custom_prompt"][:100] + "..."

        logger.info(f"[ConfigCenter] 更新 lobster={lobster_id} tenant={tenant_id} fields={list(updated.keys())}")
        return {"success": True, "updated": updated}

    # ── 内部辅助 ──────────────────────────────────────────────────────

    def _get_role_card(self, lobster_id: str) -> dict:
        ROLE_CARDS = {
            "commander": {"name_cn": "元老院总脑", "emoji": "🧠", "role_desc": "编排、仲裁、异常处理、复盘"},
            "radar":     {"name_cn": "触须虾",   "emoji": "📡", "role_desc": "信号发现、热点、竞品、舆情"},
            "strategist":{"name_cn": "脑虫虾",   "emoji": "🧬", "role_desc": "策略规划、排期、实验、预算"},
            "inkwriter": {"name_cn": "吐墨虾",   "emoji": "✍️", "role_desc": "文案、话术、合规改写"},
            "visualizer":{"name_cn": "幻影虾",   "emoji": "🎨", "role_desc": "分镜、图片、视频、字幕"},
            "dispatcher":{"name_cn": "点兵虾",   "emoji": "📋", "role_desc": "分发、调度、发布时间窗"},
            "echoer":    {"name_cn": "回声虾",   "emoji": "💬", "role_desc": "评论、私信、互动承接"},
            "catcher":   {"name_cn": "铁网虾",   "emoji": "🪤", "role_desc": "线索评分、CRM入库、去重"},
            "abacus":    {"name_cn": "金算虾",   "emoji": "📊", "role_desc": "归因、ROI、报告、反馈回写"},
            "followup":  {"name_cn": "回访虾",   "emoji": "🔔", "role_desc": "多触点跟进、唤醒、成交回写"},
        }
        card = ROLE_CARDS.get(lobster_id, {})
        card["name_en"] = lobster_id
        card["core_artifact"] = self._get_core_artifact(lobster_id)
        return card

    def _get_core_artifact(self, lobster_id: str) -> str:
        ARTIFACTS = {
            "commander": "MissionPlan", "radar": "SignalBrief",
            "strategist": "StrategyRoute", "inkwriter": "CopyPack",
            "visualizer": "StoryboardPack", "dispatcher": "ExecutionPlan",
            "echoer": "EngagementReplyPack", "catcher": "LeadAssessment",
            "abacus": "ValueScoreCard", "followup": "FollowUpActionPlan",
        }
        return ARTIFACTS.get(lobster_id, "")

    def _get_skills(self, lobster_id: str, tenant_id: str) -> list[dict]:
        try:
            return self.skill_registry.get_active_skills(lobster_id, tenant_id)
        except Exception:
            return []

    def _get_tools(self, lobster_id: str, tenant_id: str) -> list[dict]:
        try:
            return self.mcp_gateway.get_lobster_tools(lobster_id, tenant_id)
        except Exception:
            return []

    def _get_strategy(self, lobster_id: str, tenant_id: str) -> dict:
        row = self.db.query_one("lobster_strategy", where={
            "lobster_id": lobster_id, "tenant_id": tenant_id
        })
        return {"strategy_level": row["strategy_level"] if row else 2}

    def _get_autonomy(self, lobster_id: str, tenant_id: str) -> dict:
        try:
            return self.autonomy_policy.get_mode(lobster_id, tenant_id)
        except Exception:
            return {"autonomy_mode": "hitl"}

    def _get_kb_summary(self, lobster_id: str, tenant_id: str) -> dict:
        try:
            stats = self.memory_service.get_stats(lobster_id, tenant_id)
            return {
                "memory_count": stats.get("total", 0),
                "last_updated": stats.get("last_updated", 0),
            }
        except Exception:
            return {"memory_count": 0, "last_updated": 0}

    def _get_status(self, lobster_id: str, tenant_id: str) -> str:
        row = self.db.query_one("lobster_status", where={
            "lobster_id": lobster_id, "tenant_id": tenant_id
        })
        return row["status"] if row else "idle"
```

### API 路由

```python
# dragon-senate-saas-v2/app.py（追加）

@router.get("/api/v1/lobster-config")
async def list_lobster_configs(ctx=Depends(get_tenant_context)):
    center = LobsterConfigCenter(db, skill_registry, mcp_gateway, autonomy_policy, memory_service)
    return center.list_all_lobsters(ctx.tenant_id)

@router.get("/api/v1/lobster-config/{lobster_id}")
async def get_lobster_config(lobster_id: str, ctx=Depends(get_tenant_context)):
    center = LobsterConfigCenter(db, skill_registry, mcp_gateway, autonomy_policy, memory_service)
    return center.get_lobster_config(lobster_id, ctx.tenant_id)

@router.patch("/api/v1/lobster-config/{lobster_id}")
async def update_lobster_config(lobster_id: str, body: dict, ctx=Depends(get_tenant_context)):
    center = LobsterConfigCenter(db, skill_registry, mcp_gateway, autonomy_policy, memory_service)
    return center.update_lobster_config(lobster_id, ctx.tenant_id, body)
```

### 前端页面结构

```
/operations/lobster-config
  ├── 左侧：10只龙虾列表（emoji + 中文名 + 在线状态小圆点）
  └── 右侧：选中龙虾的配置面板（Tab 结构）
        ├── Tab 1 「角色」   — 角色卡展示（职责/人格/核心工件）+ 自定义追加指令
        ├── Tab 2 「技能」   — 技能列表（勾选启用/禁用）+ 技能评级徽标
        ├── Tab 3 「工具」   — MCP 工具绑定（拖拽排序）
        ├── Tab 4 「策略」   — 策略强度滑块（0-5级）+ 自主模式选择
        └── Tab 5 「知识库」 — 记忆条数 + 最近更新 + 清空按钮
```

---

## 验收标准

- [ ] `LobsterConfigCenter.list_all_lobsters()` 返回 10只龙虾精简状态
- [ ] `get_lobster_config()` 聚合6类数据（角色卡/技能/工具/策略/自主/记忆）
- [ ] `update_lobster_config()` 支持 strategy_level / autonomy_mode / active_skills / active_tools / custom_prompt 5个字段
- [ ] `GET /api/v1/lobster-config` / `GET /{lobster_id}` / `PATCH /{lobster_id}` 3条 API
- [ ] 前端 `/operations/lobster-config` — 左侧龙虾列表 + 右侧5个 Tab 配置面板
- [ ] Tab 变更即时保存（debounce 500ms）

---

*Codex Task | 来源：ONYX_BORROWING_ANALYSIS.md P1-1 | 2026-04-02*
