# 🎯 Codex Task: SP1 — Commander 智能路由器

> **给 Codex 的任务说明书**
> 复制以下全部内容发送给 Codex 即可。

---

## 你要做什么

在 `dragon-senate-saas-v2/` 目录下创建一个 **Commander 智能路由器**模块，它能根据用户目标和行业上下文，**动态选择龙虾子集和执行顺序**，替代现有的固定 DAG。

## 项目背景（5分钟速读）

这是一个 AI 增长操作系统，有 1 个 Commander（总脑）+ 9 只龙虾（数字员工），通过 LangGraph 编排执行。

**现状问题**：`dragon_senate.py` 中的 `build_main_graph()` 是硬编码的固定 DAG——无论任务是什么，所有 9 只虾都会执行。我们需要 Commander 根据任务目标智能选择虾子集。

**9只龙虾及其职能**：

| ID | 中文 | 职能 | 主工件 |
|---|------|------|--------|
| radar | 触须虾 | 信号扫描、噪音过滤 | SignalBrief |
| strategist | 脑虫虾 | 目标拆解、策略路由 | StrategyRoute |
| inkwriter | 吐墨虾 | 成交导向文案 | CopyPack |
| visualizer | 幻影虾 | 分镜、视觉设计 | StoryboardPack |
| dispatcher | 点兵虾 | 拆包、依赖、灰度 | ExecutionPlan |
| echoer | 回声虾 | 真人感回复、互动转化 | EngagementReplyPack |
| catcher | 铁网虾 | 高意向识别、风险过滤 | LeadAssessment |
| abacus | 金算虾 | 评分、ROI、归因 | ValueScoreCard |
| followup | 回访虾 | 推进成交、二次激活 | FollowUpActionPlan |

## 你需要创建的文件

### 1. `dragon-senate-saas-v2/commander_router.py`（核心）

```python
"""
Commander Router — 智能路由器
输入: 用户目标 + 行业上下文
输出: 虾子集 + 执行顺序 + 工作流配置
"""

class CommanderRouter:
    """
    核心接口:
    
    async def route(self, goal: str, industry_context: dict) -> RoutePlan:
        '''
        输入:
          - goal: 用户自然语言目标，如 "帮我在抖音上获取口腔诊所客户"
          - industry_context: {
              "industry": "本地生活_医疗口腔",
              "platform": "douyin",
              "budget_level": "medium",
              "urgency": "high",
              "existing_content": true/false,
              "has_leads": true/false
            }
        
        输出:
          RoutePlan(
            workflow_id="wf_...",          # 匹配的workflow ID
            lobster_sequence=["radar", "strategist", "inkwriter", ...],  # 有序执行列表
            skip_lobsters=["visualizer"],   # 跳过的虾
            parallelizable=[("inkwriter", "visualizer")],  # 可并行的虾对
            estimated_steps=5,
            risk_level="medium",
            approval_required=["publish_external"],  # 需要HITL审批的动作
          )
        '''
```

### 2. 路由逻辑要求

**规则优先级**（从高到低）：

1. **workflow-catalog 匹配**：读取 18 个标准 workflow（定义见下文），找到最匹配用户目标的 workflow
2. **行业上下文适配**：根据行业特点调整虾子集（如教育培训行业需要 followup，但不一定需要 visualizer）
3. **policy_bandit 学习**：如果存在历史反馈，用 MAB 推荐更优的策略分支

**核心路由规则**：

```python
# 规则示例（你需要扩展为完整规则集）

# 内容生产任务 → radar + strategist + inkwriter + visualizer + dispatcher
# 线索获取任务 → echoer + catcher + abacus + followup
# 全链路任务 → 全部9虾
# 周报复盘 → radar + abacus + feedback
# 投诉处理 → echoer + catcher + followup（紧急模式）
# 信号扫描 → radar + strategist（轻量模式）
```

### 3. 18个标准 Workflow（已有定义，你的路由器需要匹配它们）

```
wf_signal_scan       → radar, strategist（情报扫描）
wf_strategy_seed     → radar, strategist（策略设计）
wf_topic_scoring     → strategist, inkwriter（选题评分）
wf_copy_compliance   → inkwriter, visualizer（文案合规）
wf_visual_production → visualizer, dispatcher（视觉生产）
wf_title_cover       → inkwriter, visualizer（标题封面）
wf_cloud_archive     → dispatcher（云端归档）
wf_edge_publish      → dispatcher（边缘发布）
wf_edge_inbox        → echoer, catcher（互动收件箱）
wf_interaction_triage → echoer, catcher, abacus（互动分流）
wf_lead_scoring      → catcher, abacus（线索评分）
wf_conversion_push   → abacus, followup（转化推进）
wf_high_score_call   → followup（高分外呼）
wf_reactivation      → abacus, followup（二次激活）
wf_recovery_replay   → dispatcher, feedback（故障恢复）
wf_weekly_review     → radar, abacus, feedback（周报复盘）
wf_complaint_guard   → echoer, catcher, followup（投诉防护）
wf_growth_retrofit   → strategist, abacus, feedback（增长改造）
```

### 4. `dragon-senate-saas-v2/commander_graph_builder.py`（动态图构建器）

```python
"""
将 RoutePlan 转化为 LangGraph StateGraph
替代现有的硬编码 build_main_graph()
"""

from langgraph.graph import StateGraph, START, END

class DynamicGraphBuilder:
    def build(self, route_plan: RoutePlan) -> StateGraph:
        '''
        根据 RoutePlan 动态构建 LangGraph 图:
        1. 只添加 route_plan.lobster_sequence 中的虾节点
        2. 按序连接边
        3. 处理 parallelizable 中的并行分支
        4. 在 approval_required 的节点后插入 human_approval_gate
        5. 始终保留 constitutional_guardian 和 verification_gate（治理节点不可跳过）
        '''
```

### 5. 测试文件 `dragon-senate-saas-v2/tests/test_commander_router.py`

需要测试：
- 内容生产目标 → 选出正确的虾子集
- 线索获取目标 → 选出正确的虾子集
- 紧急投诉 → echoer+catcher+followup
- 空目标 → 降级为 wf_signal_scan
- 行业上下文影响路由结果

## 关键约束（红线）

1. **不修改现有文件** — `dragon_senate.py` 和 `app.py` 保持不变，新模块独立创建
2. **治理节点不可跳过** — `constitutional_guardian`、`verification_gate`、`memory_governor` 始终保留
3. **HITL 默认** — 涉及外部发布（`publish_external`）或价格承诺（`price_commitment`）必须审批
4. **Commander 不替虾干活** — 只做路由决策，不执行具体业务逻辑
5. **向后兼容** — 如果路由器无法判断，降级为全虾执行（现有行为）

## 现有文件参考

你可以读取以下文件作为上下文：
- `dragon-senate-saas-v2/dragon_senate.py` — 现有的固定 DAG（`build_main_graph()` 函数在文件末尾）
- `dragon-senate-saas-v2/policy_bandit.py` — MAB 策略学习（`recommend_policy()` 和 `update_policy()`）
- `packages/lobsters/lobster-*/role-card.json` — 每虾的身份卡
- `packages/lobsters/lobster-operating-model.json` — 操作模型（含 workflowCatalog）

## 验收标准

1. `commander_router.py` 能对自然语言目标返回合理的 RoutePlan
2. `commander_graph_builder.py` 能将 RoutePlan 转化为可执行的 LangGraph StateGraph
3. 全部测试通过：`pytest dragon-senate-saas-v2/tests/test_commander_router.py -v`
4. 不依赖外部 LLM 调用（路由决策用规则+MAB，不需要调 GPT）
5. 代码有完整的类型注解和 docstring

## 技术栈

- Python 3.10+
- langgraph (`from langgraph.graph import StateGraph, START, END`)
- 标准库 json/sqlite3/dataclasses
- 不需要 pip install 新依赖

---

*任务ID: SP1-COMMANDER-ROUTER | 预估难度: 中 | 预估文件: 3个 | 预估代码量: 400-600行*
