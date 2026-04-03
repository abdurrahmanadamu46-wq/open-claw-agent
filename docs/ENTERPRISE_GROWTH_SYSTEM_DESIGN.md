# 企业增长系统设计文档
# Dragon Senate — Enterprise Growth System Design

**版本**: v1.0  
**日期**: 2026-04-02  
**来源**: 经过3轮深度推演后的核心设计结论  

---

## 一、系统定位

> **Dragon Senate 是一个能理解企业处境、沉淀企业知识、随企业成长进化的 AI 增长参谋团，而不是通用的内容生产工具。**

**关键差别**：
- 工具：客户说做什么，我做什么，下次再说一遍
- 参谋团：我记得你上次做了什么，这次基于那次结果给你更好的建议，下次我会更懂你

**护城河**：企业记忆库越积越深，越用越换不掉。

---

## 二、标准业务流程

```
Phase 0：客户入驻（一次性，持续更新）
  └─ EnterpriseOnboardingPipeline.run_onboarding(questionnaire_data)
     ├─ Step 1：基本定位问卷（行业树选择，5分钟）
     ├─ Step 2：品牌基因访谈（Commander主导，15分钟对话）
     ├─ Step 3：资源条件清点（账号/人员/预算/拍摄能力）
     └─ Step 4：首次增长诊断（自动生成，3个优先建议）

Phase 1：增长策略制定（每次活动前）
  └─ GrowthStrategyEngine.generate_strategy_options(...)
     ├─ 读取企业记忆三层上下文（行业+区域+企业专属）
     ├─ 生成 3-5 个增长策略备选（含利弊/风险/自动化机会）
     └─ 客户/operator 选定策略 → confirm_strategy()

Phase 2：方案拆解（策略→任务树）
  └─ GrowthStrategyEngine.decompose_to_dag(route, selected_strategy_id)
     ├─ 生成 MissionDAG（任务有向无环图）
     ├─ 每个节点：执行龙虾/输入工件/输出工件/依赖关系
     └─ Commander 调度 get_ready_nodes() 并行执行

Phase 3：业务虾并行执行
  └─ 各龙虾执行前调用 get_lobster_context(tenant_id, lobster_id)
     ├─ inkwriter：读品牌词汇库+禁词+内容调性→定制文案
     ├─ visualizer：读品牌人格+内容类型→定制视觉方案
     ├─ dispatcher：读账号健康+最优发布时间→精准分发
     ├─ echoer：读意向词库+客户说话方式→精准互动
     ├─ catcher：读决策周期+客户画像→评分线索
     └─ followup：读成交路径+品牌词→个性化跟进

Phase 4：复盘沉淀（写回企业记忆库）
  └─ EnterpriseMemoryBank.record_campaign(tenant_id, campaign_record)
     ├─ abacus 出 ValueScoreCard
     ├─ 活动结果写入 growth_history
     └─ 下次策略自动继承本次经验教训
```

---

## 三、企业记忆库三层架构

```
Layer 1：平台公共知识库（由我们维护，所有同类客户共享，只读）
  ├─ INDUSTRY_KNOWLEDGE_TREE（行业树）
  │   ├─ 美业健康 > 美容院 > 高端：content_tone/intent_keywords/conversion_path...
  │   ├─ 餐饮 > 中餐 > 本地门店：...
  │   └─ 教育培训 > K12：...
  └─ enterprise_memory.py: INDUSTRY_KNOWLEDGE_TREE

Layer 2：区域知识库（由我们维护+数据沉淀，半公开）
  ├─ 三线城市：熟人经济强/微信私域极强/口碑传播2.5倍/CTR加成40%
  ├─ 一线城市：陌生人经济/小红书极强
  └─ enterprise_memory.py: REGIONAL_KNOWLEDGE

Layer 3：企业专属记忆库（完全隔离，随时间生长）
  ├─ 基本定位：industry_l1/l2/price_position/city/city_tier
  ├─ 品牌基因：brand_core_value/brand_personality/founder_story
  ├─ 内容资产：platform_accounts/brand_vocabulary
  ├─ 客户画像：primary_customer_profile/decision_trigger
  ├─ 资源条件：staff/content_per_week/budget/filming_capability
  ├─ 历史增长：growth_history（活动→结果→经验教训→下次参考）
  └─ 动态记忆：memory_entries（带过期机制：平台规则90天/竞品30天/永久-1）
```

**合并规则**：三层叠加，企业专属优先级最高（覆盖行业通用）

**定位路径示例**：美业健康 > 美容院 > 三线城市 > 高端 > 荣荣美院

---

## 四、增长阶段意识

| 阶段 | 主要目标 | 主力龙虾 | 成功指标 |
|------|---------|---------|---------|
| 冷启动（0→1） | 建账号标签，积累精准粉丝 | radar+strategist+inkwriter | 粉丝突破1000，账号标签稳定 |
| 扩张期（1→10） | 批量获客，活动拉新，线索转化 | dispatcher+echoer+catcher+followup | 月新客>20%，转化率>15% |
| 成熟期（10+） | 提效、复购、口碑精细运营 | followup+abacus+strategist | 复购率>40%，客单价提升>15% |
| 唤醒期（停滞后） | 重新激活账号和存量客户 | strategist+radar+inkwriter | 互动率恢复，沉睡客激活>10% |

龙虾团队**不应每次全线出动**——当前阶段不需要的龙虾应处于待命状态，避免资源浪费。

---

## 五、苏思（脑虫虾）v3.0 升级总结

**角色**：内容策略总设计 + 流程工程师  
**版本**：skills.json v3.0（新增3条技能）

**新增技能**：
1. `str_automation_001` — 流程自动化机会识别（标注哪些重复环节可Prompt化/工具化）
2. `str_automation_002` — Prompt模板设计规范（输出 PromptPack → 直接写入 prompt_registry）
3. `str_automation_003` — YAML工作流节点逻辑设计（输出 WorkflowSpec → Commander生成MissionDAG）

**能力边界（明确写入 extended_role_note）**：
- ✅ 能做：Prompt规格设计/YAML节点定义/自动化机会识别/需求规格书
- ❌ 不做：Python实现代码/API集成部署/挤占策略时间的纯工程任务

**StrategyRoute v2 新增字段**：
- `strategy_options`（3-5个备选，不是单一策略）
- `automation_opportunities`（每个策略的可自动化环节）
- `mission_dag`（选定策略后的任务树）
- `confirmed_at`（客户确认机制）

---

## 六、新增核心文件索引

| 文件 | 职责 |
|------|------|
| `dragon-senate-saas-v2/enterprise_memory.py` | 三层知识架构核心模块（Layer1/2/3+EnterpriseMemoryBank） |
| `dragon-senate-saas-v2/enterprise_onboarding.py` | 4步入驻流程+首次增长诊断自动生成 |
| `dragon-senate-saas-v2/growth_strategy_engine.py` | StrategyRouteV2+MissionDAG拆解+自动化机会识别 |
| `docs/lobster-kb/strategist/skills.json` | 苏思技能库v3.0（新增3条自动化/流程工程技能） |
| `dragon-senate-saas-v2/enterprise_memories/` | 企业专属记忆库存储目录（每个客户一个JSON文件，完全隔离） |

---

## 七、行业知识库扩展路线图

当前已内置行业（Layer 1）：
- ✅ 美业健康 > 美容院（高端/中端/平价）
- ✅ 美业健康 > 医美机构（高端）
- ✅ 美业健康 > 养生馆（高端）
- ✅ 餐饮 > 中餐（本地门店）
- ✅ 教育培训 > K12（通用）

待扩展（随客户数据沉淀逐步填入）：
- 🔲 美业 > 美发/美甲
- 🔲 餐饮 > 西餐/咖啡茶饮/火锅
- 🔲 零售 > 服装/化妆品/母婴
- 🔲 健身运动 > 健身房/瑜伽
- 🔲 B2B > SaaS/咨询

**脱敏学习机制**：某个企业客户沉淀的行业规律（如"三线城市美容院before-after内容CTR高3倍"），脱敏后回写Layer 1，惠及所有同类新客户。企业具体数据（粉丝数/话术/客户信息）永远不离开专属空间。

---

## 八、客户参与机制（待开发）

企业不是纯接受方，需要参与以下环节：
- **策略确认**：3-5个策略备选，客户选定1-2个 → `route.confirm_strategy()`
- **内容审核**：发布前，客户能看到并审核内容
- **数据共读**：abacus 的月报，客户能理解并参与复盘讨论
- **实时干预**：活动进行中，客户发现问题能通知 Commander

→ 需要开发"客户协作门户"（Client Portal），独立于运营控制台

---

*本文档由 2026-04-02 推演会话自动生成，融合了以下讨论：*
- *苏思扩编 vs 新增程序虾的方案对比*
- *深度企业融合增长系统的定位讨论*
- *三层企业记忆库架构设计*
- *行业知识树+增长阶段意识+客户参与机制的补充*
