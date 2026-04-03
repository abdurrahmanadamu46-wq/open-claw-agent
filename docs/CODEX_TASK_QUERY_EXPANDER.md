# CODEX TASK: 查询意图扩展器（QueryExpander）

**优先级：P1**  
**来源：ONYX_BORROWING_ANALYSIS.md P1-3**  
**借鉴自**：Onyx `backend/onyx/secondary_llm_flows/query_expansion.py`

---

## 背景

Commander 当前将用户原始指令直接分发给龙虾。当指令模糊或信息量少时（如"给我分析一下竞品"），各龙虾理解偏差大、召回范围窄。借鉴 Onyx 查询扩展机制，**在 Commander 分发前用一次轻量 LLM 调用将原始意图扩展为 3-5 个子维度查询**，再分别路由给对应龙虾。

---

## 实现

```python
# dragon-senate-saas-v2/query_expander.py

import json
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

EXPAND_PROMPT = """你是一个营销增长 AI 系统的任务拆解助手。

用户原始指令：
{user_query}

当前激活的龙虾（AI 角色）：
{active_lobsters}

请将用户指令拆解为 3-5 个具体子查询，每个子查询指向最合适的龙虾角色。
输出 JSON 格式：
{{
  "expanded": [
    {{"query": "子查询1", "target_lobster": "radar", "priority": 1}},
    {{"query": "子查询2", "target_lobster": "strategist", "priority": 2}},
    ...
  ],
  "intent_summary": "用户核心意图一句话摘要"
}}

规则：
- 同一龙虾不能出现超过2次
- 子查询要具体、可执行，不要模糊
- priority 1=最高优先"""


@dataclass
class ExpandedQuery:
    query: str
    target_lobster: str
    priority: int = 1
    original_query: str = ""


@dataclass
class ExpansionResult:
    original: str
    intent_summary: str
    expanded: list[ExpandedQuery] = field(default_factory=list)
    skipped: bool = False  # True=原始意图已足够清晰，无需扩展


class QueryExpander:
    """
    查询意图扩展器
    
    在 Commander 分发任务给龙虾之前，
    用一次轻量 LLM 调用将模糊/宽泛的用户指令扩展为多个具体子查询。
    
    效果：
      输入："帮我分析一下竞品"
      输出：
        - radar: "采集过去7天竞品账号小红书/抖音热帖内容"
        - strategist: "基于竞品内容分布推断其近期营销策略"
        - abacus: "对比我方与竞品的互动率/涨粉速度数据"
    """

    LOBSTER_DESC = {
        "commander": "总编排、仲裁",
        "radar": "信号发现、热点、竞品监控",
        "strategist": "策略规划、实验设计",
        "inkwriter": "文案、话术、内容创作",
        "visualizer": "分镜、图片、视频",
        "dispatcher": "内容分发、发布调度",
        "echoer": "评论互动、私信承接",
        "catcher": "线索识别、CRM 入库",
        "abacus": "数据归因、ROI 报告",
        "followup": "跟进、唤醒、成交",
    }

    def __init__(self, llm_client, min_query_length: int = 15):
        self.llm = llm_client
        self.min_query_length = min_query_length

    async def expand(
        self,
        user_query: str,
        active_lobsters: Optional[list[str]] = None,
        tenant_id: str = "",
    ) -> ExpansionResult:
        """主入口：扩展用户查询"""

        # 短查询/已有明确目标龙虾 → 跳过扩展
        if len(user_query.strip()) < self.min_query_length:
            logger.debug(f"[QueryExpander] 查询过短，跳过扩展: {user_query!r}")
            return ExpansionResult(
                original=user_query,
                intent_summary=user_query,
                skipped=True,
            )

        lobsters = active_lobsters or list(self.LOBSTER_DESC.keys())
        lobster_desc_str = "\n".join(
            f"- {lid}: {self.LOBSTER_DESC.get(lid, '')}" for lid in lobsters
        )

        prompt = EXPAND_PROMPT.format(
            user_query=user_query,
            active_lobsters=lobster_desc_str,
        )

        try:
            raw = await self.llm.complete(
                prompt=prompt,
                max_tokens=512,
                temperature=0.3,
                tenant_id=tenant_id,
                tag="query_expander",
            )
            parsed = json.loads(raw)
            expanded = [
                ExpandedQuery(
                    query=item["query"],
                    target_lobster=item["target_lobster"],
                    priority=item.get("priority", 1),
                    original_query=user_query,
                )
                for item in parsed.get("expanded", [])
                if item.get("target_lobster") in self.LOBSTER_DESC
            ]
            # 按优先级排序
            expanded.sort(key=lambda x: x.priority)

            result = ExpansionResult(
                original=user_query,
                intent_summary=parsed.get("intent_summary", user_query),
                expanded=expanded,
            )
            logger.info(
                f"[QueryExpander] 扩展完成 tenant={tenant_id} "
                f"original={user_query!r:.30} → {len(expanded)} 子查询"
            )
            return result

        except (json.JSONDecodeError, KeyError) as e:
            logger.warning(f"[QueryExpander] 解析失败，降级返回原始查询 err={e}")
            return ExpansionResult(
                original=user_query,
                intent_summary=user_query,
                skipped=True,
            )
        except Exception as e:
            logger.error(f"[QueryExpander] LLM 调用失败 err={e}")
            return ExpansionResult(
                original=user_query,
                intent_summary=user_query,
                skipped=True,
            )

    def expand_sync(self, user_query: str, active_lobsters=None, tenant_id="") -> ExpansionResult:
        """同步版本（兼容非 async 调用方）"""
        import asyncio
        return asyncio.get_event_loop().run_until_complete(
            self.expand(user_query, active_lobsters, tenant_id)
        )
```

### 集成到 Commander

```python
# dragon-senate-saas-v2/lobster_runner.py（追加到 Commander 分发逻辑前）

async def run_with_expansion(user_query: str, tenant_id: str, session_id: str):
    expander = QueryExpander(llm_client=llm)
    result = await expander.expand(user_query, tenant_id=tenant_id)

    if result.skipped or not result.expanded:
        # 直接按原始查询分发
        await commander.dispatch(user_query, tenant_id, session_id)
    else:
        # 按子查询分别分发给对应龙虾
        tasks = []
        for eq in result.expanded:
            tasks.append(
                lobster_pool.dispatch_to(
                    lobster_id=eq.target_lobster,
                    query=eq.query,
                    tenant_id=tenant_id,
                    session_id=session_id,
                    priority=eq.priority,
                )
            )
        await asyncio.gather(*tasks, return_exceptions=True)
```

---

## 验收标准

- [ ] `QueryExpander.expand()` 对 15 字以上查询返回 3-5 个子查询
- [ ] 短查询（< 15 字）自动 `skipped=True`
- [ ] JSON 解析失败时降级（不抛异常）
- [ ] `target_lobster` 只能是 10 只合法龙虾之一
- [ ] 集成到 Commander 分发链路（expand → dispatch_to 各龙虾）
- [ ] LLM 调用打 `tag="query_expander"` 便于 Langfuse 追踪

---

*Codex Task | 来源：ONYX_BORROWING_ANALYSIS.md P1-3 | 2026-04-02*
