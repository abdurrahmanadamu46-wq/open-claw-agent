# Stanford STORM 借鉴分析报告

**来源**：https://github.com/stanford-oval/storm  
**定位**：Stanford 出品，基于 Internet 搜索自动写 Wikipedia 级别文章的多 Agent LLM 系统  
**核心亮点**：多视角问题生成 + 模拟对话研究 + 协作 STORM（Co-STORM）多 Agent 协作  
**Stars**：14k+（顶级学术 Agent 系统）  
**分析日期**：2026-04-02  
**规则**：已生成 Codex Task 的默认已落地，我们已更好的略过

---

## 一、项目结构概览

```
stanford-oval/storm/
├── knowledge_storm/              # 核心 Python 包
│   ├── interface.py              # 所有 Agent/模块的抽象接口（21KB）
│   ├── storm_wiki/               # STORM 主流程（单 Agent 研究写作）
│   │   ├── engine.py             # 两阶段引擎（预写作+写作）
│   │   └── modules/              # 各阶段功能模块
│   ├── collaborative_storm/     # Co-STORM（多 Agent 协作研究）
│   │   ├── engine.py             # 协作引擎（32KB，最有价值）
│   │   └── modules/              # 协作各模块
│   ├── rm.py                     # 检索模块（47KB：YouRM/Bing/VectorRM）
│   ├── lm.py                     # LLM 抽象层（42KB，litellm集成）
│   ├── dataclass.py              # 数据结构（32KB）
│   └── logging_wrapper.py        # 日志包装器
├── frontend/demo_light/          # Streamlit 前端 Demo
└── examples/                     # 多 LLM 提供商运行示例
```

---

## 二、STORM 核心架构解析

### 2.1 两阶段研究写作（STORM Wiki）

```
阶段1：预写作（Pre-writing）
  Step 1: 话题分解 → 发现多个"视角"（perspective）
    - 通过调研相似话题文章，挖掘不同角度
    - 每个视角代表一类读者/专家的关注点
  
  Step 2: 多视角问答（Perspective-Guided QA）
    - 为每个视角生成一个"虚拟专家"
    - 每个专家向搜索引擎提问
    - 收集 N 个视角的研究结果
  
  Step 3: 模拟对话（Simulated Conversation）
    - Wikipedia 写手 vs 话题专家（LLM vs LLM）
    - 写手提问 → 专家用搜索结果回答
    - 动态更新写手对话题的理解
    - 生成带引用的研究提纲（Outline）

阶段2：写作（Writing）
  Step 4: 基于提纲 + 参考文献 生成带引用的文章
  Step 5: 引用验证（每个声明必须有来源支撑）
```

### 2.2 Co-STORM 协作架构（对我们最有价值）

```
Co-STORM 三类 Agent：
  1. Co-STORM LLM Experts（龙虾对应物）
     - 基于外部知识来源生成有根据的回答
     - 根据对话历史提出跟进问题
     - 每个 Expert 有独立的"关注领域"
  
  2. Moderator（主持人，对应我们的老健）
     - 生成"思考性问题"（不是直接重复已有话题）
     - 问题基于"检索器发现的但对话中未使用"的信息
     - 管理发言权（turn management policy）
  
  3. Human User（人类用户）
     - 可随时介入，提出问题或方向调整
     - 系统适应人类输入，而非强制走预设流程

协作话语协议（Collaborative Discourse Protocol）：
  - 轮次管理：决定谁来发言（Expert/Moderator/Human）
  - 话题追踪：维护 Mind Map（思维导图）记录所有探索过的方向
  - 去重机制：避免重复探讨已充分讨论的话题
  - 信息整合：多来源信息归并，生成结构化知识树
```

### 2.3 interface.py 抽象层设计

```python
# STORM 的核心接口（我们的架构对应）
class KnowledgeBase:       → 我们的 enterprise_memory.py
class Information:          → 我们的 artifact_store.py  
class ConversationTurn:     → 我们的 lobster_session.py
class DiscourseManager:     → 我们的 dispatcher-laojian（调度员）
class Retriever:            → 我们的 radar-lintao（雷达）
class LMConfigs:            → 我们的 provider_registry.py

核心设计原则：
  - 所有组件通过 Interface 抽象，可插拔替换
  - 每个 LLM 调用都有独立配置（不同模块用不同模型）
  - 检索与生成严格分离
```

### 2.4 rm.py 检索层（47KB）

```
支持的检索器：
  YouRM          → You.com 搜索 API
  BingSearch     → Bing 搜索 API  
  VectorRM       → 本地向量数据库（用户上传文档）
  SerperRM       → Google 搜索代理
  BraveRM        → Brave 搜索
  SearXNG        → 自部署搜索引擎
  ArXivRM        → 学术论文检索
  
关键设计：
  - 统一 Retriever 接口，可热插拔
  - 每次检索返回 List[Information]（含 url/title/snippet/date）
  - 支持"按查询并发检索"（多个问题同时搜索）
```

### 2.5 lm.py LLM 抽象层（42KB）

```
LM 配置系统：
  - 不同阶段用不同模型（写作用 GPT-4o，问题生成用 GPT-4o-mini）
  - 支持：OpenAI / Anthropic / Google / Groq / Ollama / DeepSeek / Mistral
  - litellm 集成：统一调用接口（2025年新增）
  
关键特性：
  - conv_simulator_lm：模拟对话的 LM（可用便宜模型）
  - question_asker_lm：问题生成的 LM
  - outline_gen_lm：提纲生成的 LM
  - article_gen_lm：文章写作的 LM（最贵/最强）
  - article_polish_lm：润色的 LM
  
设计哲学：不同质量要求的任务用不同价位的模型
```

---

## 三、Co-STORM 话语管理（最高价值发现）

### Mind Map（知识地图）机制

```python
# 对我们最有借鉴价值的设计
class MindMap:
    """
    Co-STORM 在整个研究对话过程中维护的知识树
    
    作用：
    1. 记录"已探索的话题"（避免重复）
    2. 记录"发现的关键知识点"（结构化存储）
    3. 为下一轮问题生成提供"未探索的分支"
    4. 最终可导出为结构化大纲（Outline）
    """
    
    nodes: dict[str, Node]   # 话题节点（层级树状）
    edges: list[Edge]         # 话题之间的关联
    
    def get_unexplored_topics(self) -> list[str]:
        """返回还未深入探讨的话题分支"""
    
    def update_with_new_info(self, info: Information):
        """将新检索信息整合到知识树"""
    
    def to_outline(self) -> str:
        """将知识树转换为文章提纲"""
```

### Turn 管理策略

```
Co-STORM 的发言权分配策略（对老健的调度设计有参考价值）：

策略1：专家轮换（Round Robin）
  - 每个 Expert 依次发言
  - 简单但不够智能

策略2：相关性驱动（Relevance-based）
  - 根据当前话题选择最相关的专家发言
  - 保持对话连贯性

策略3：多样性驱动（Diversity-based）
  - 优先选择"还未发言"的专家/视角
  - 确保多角度覆盖

我们的对应设计：
  老健（dispatcher）→ 应该根据任务类型和当前状态
  动态决定"由哪只龙虾处理下一步"
  而不是固定流程（线索来了→苏思分析→墨小雅写→阿声发）
```

---

## 四、前端 Demo 设计（Streamlit）

### demo_light 结构

```
frontend/demo_light/
├── storm.py           # 主入口（tab 切换：STORM/Co-STORM）
├── demo_util.py       # UI 组件工具函数（25KB）
├── stoc.py            # 目录自动生成（Table of Contents）
└── pages_util/        # 各页面组件

关键 UI 设计：
  1. 研究进度实时展示（streaming 方式逐步显示）
  2. 文章大纲树状展示（可折叠/展开章节）
  3. 引用来源侧边栏（点击引用编号跳转来源）
  4. Co-STORM 模式：对话历史 + 实时 Mind Map 展示
  5. 人类可在任意时刻"插话"（中断当前 turn 发表意见）
```

---

## 五、逐层对比（我们的7层架构 vs STORM）

### 🌐 前端 SaaS 控制台

| STORM 设计 | 我们的现状 | 状态 | 价值 |
|-----------|-----------|------|------|
| **结构化文章大纲树展示**（可折叠章节树）| 无 | 🆕 | ✅ P2 — 苏思策略报告的大纲树展示 |
| **实时研究进度 Streaming 展示**（逐步生成）| 已有 workflow_realtime_stream | ✅已落地 | — |
| **引用编号侧边栏**（点击跳转来源）| 无 | 🆕 | ✅ P2 — 雷达报告引用侧边栏 |
| **人类"插话"按钮**（中断 Agent 流程注入意见）| 无 | 🆕 | ✅ **P1** — 运营人员可随时插话给龙虾 |

### 🧠 云端大脑层（Commander）

| STORM 设计 | 我们的现状 | 状态 | 价值 |
|-----------|-----------|------|------|
| **多视角问题生成**（Perspective-Guided QA）| 无，苏思分析是单视角 | 🆕 | ✅ **P1** — 苏思多视角分析客户 |
| **模拟对话研究**（Writer vs Expert 对话）| 无 | 🆕 | ✅ **P1** — 苏思模拟"客户 vs 销售"对话 |
| **Turn 管理策略**（动态选择下一个发言龙虾）| 固定流程 | 🆕 | ✅ P1 — 老健动态调度升级 |
| LMConfigs 差异化配置（不同任务不同模型）| provider_registry 已支持 | ✅已落地 | — |

### 🦞 9个龙虾层

| STORM 设计 | 我们的现状 | 状态 | 价值 |
|-----------|-----------|------|------|
| **Co-STORM Expert 角色**（专家有独立知识领域）| 龙虾有 KB，已落地 | ✅已落地 | — |
| **Mind Map（知识地图）**（对话过程中维护知识树）| 无，靠 enterprise_memory 存储 | 🆕 | ✅ **P1** — 苏思/老健维护客户知识树 |
| **去重机制**（避免重复探讨已分析的话题）| 无 | 🆕 | ✅ P2 — 龙虾对话去重 |
| **引用验证**（每个输出声明必须有来源）| 无系统级引用 | 🆕 | ✅ P1 — 雷达所有输出必须带来源 |

### 🏗️ L1.5 支撑微服务集群

| STORM 设计 | 我们的现状 | 状态 | 价值 |
|-----------|-----------|------|------|
| **VectorRM**（本地向量文档检索）| CODEX_TASK_HYBRID_MEMORY_SEARCH 已落地 | ✅已落地 | — |
| **多搜索引擎热插拔**（统一接口，按需切换）| provider_registry 有基础 | 🆕 | ✅ P2 — 搜索引擎 Provider 池 |
| **litellm 统一 LLM 接口**（一个接口调所有模型）| CODEX_TASK_PROVIDER_HOT_RELOAD 已落地 | ✅已落地 | — |

### 🛰️ 云边调度层

| STORM 设计 | 我们的现状 | 状态 | 价值 |
|-----------|-----------|------|------|
| **并发检索**（多个问题同时发出，等待最快结果）| 无，雷达是串行搜索 | 🆕 | ✅ **P1** — 雷达并发多路搜索 |
| 两阶段流水线（Pre-writing → Writing 严格分离）| workflow YAML 已有阶段概念 | ✅已落地 | — |

### 🖥️ 边缘执行层

STORM 是纯云端系统，无边缘执行概念，此层不适用。

### 💰 整体 SaaS 系统

| STORM 设计 | 我们的现状 | 状态 | 价值 |
|-----------|-----------|------|------|
| **可插拔 Retriever 接口**（YouRM/BingRM等统一接口）| 部分，CODEX_TASK_CHINA_CHANNEL_ADAPTERS | 🆕延伸 | ✅ P2 — 搜索引擎统一适配器 |
| **Article 质量评估**（引用覆盖率/信息密度/去重率）| llm_quality_judge 有基础 | 🆕延伸 | ✅ P2 — 龙虾输出质量评分 |

---

## 六、最高价值发现：客户 Mind Map（知识地图）

这是 STORM 中我们**完全没有**且**对销售业务价值极高**的设计：

```
STORM 的 Mind Map：
  研究过程中实时维护"知识树"
  节点 = 话题/概念
  边 = 话题关联关系
  用于：追踪已探索 / 未探索的话题分支

转化为我们的"客户知识地图"：

  每个线索对应一个 customer_mind_map：
  {
    "lead_id": "lead_001",
    "nodes": {
      "basic_info": {
        "company": "xxx科技",
        "size": "50人",
        "industry": "SaaS",
        "explored": true
      },
      "pain_points": {
        "known": ["销售团队效率低", "跟进不及时"],
        "unexplored": ["是否已有竞品？", "决策人是谁？"],
        "explored": false
      },
      "budget": {
        "known": null,
        "unexplored": ["年度预算？", "谁审批？"],
        "explored": false
      },
      "decision_process": {
        "explored": false
      }
    }
  }

价值：
  1. 苏思分析时，明确知道"还有哪些未探索的维度"
  2. 老健分配任务时，优先补全未探索节点
  3. 墨小雅/阿声发消息时，针对"未探索节点"设计问题
  4. 避免对同一客户重复问相同的问题
  5. 前端可视化展示客户了解程度（探索百分比）
```

---

## 七、最高价值发现2：多视角客户分析

STORM 的"多视角问题生成"对苏思的升级极有价值：

```
STORM 的做法：
  对于一个话题，先发现 N 个"视角"：
  视角1：技术专家（关注实现细节）
  视角2：产品经理（关注用户体验）
  视角3：商业分析师（关注市场数据）
  → 每个视角提不同的问题，全面覆盖话题

转化到苏思分析客户：
  当前苏思：只有一个分析框架（统一的分析报告）
  
  升级后：多视角分析
  视角1：销售角度（痛点/预算/决策人）
  视角2：竞品角度（是否已有竞品/迁移门槛）
  视角3：时机角度（为什么现在？触发事件是什么？）
  视角4：风险角度（合同风险/流失风险/抵触信号）
  
  每个视角生成独立的问题清单 → 分配给不同龙虾调研
  → 苏思汇总各视角的答案 → 生成全面的客户画像
```

---

## 八、最高价值发现3：人类"插话"机制

Co-STORM 最独特的设计：人类可以随时打断并注入意见

```
Co-STORM 的插话机制：
  龙虾们正在讨论 → 运营人员说"等等，这个客户上周刚换了 CEO"
  → 所有龙虾立即将此信息整合到 Mind Map
  → 调整后续研究方向

转化到我们：
  当前问题：一旦老健分配任务，运营人员只能等待结果
  
  升级：运营人员"插话 API"
  POST /api/lobster/inject-context
  {
    "lead_id": "lead_001",
    "injected_by": "operator_001",
    "content": "客户刚说他们下个季度有预算，请重新评估时机",
    "priority": "high"
  }
  
  效果：
  - 正在执行的龙虾收到 mailbox 通知
  - 当前任务暂停，重新评估后继续
  - 插话内容记入 Mind Map 的"人类补充节点"
  - 审计日志记录"谁在何时注入了什么信息"
```

---

## 九、优先级汇总

### 🔴 P1（4项，核心业务价值）

| # | 功能 | 借鉴自 | 落地位置 | 核心价值 |
|---|------|-------|---------|---------|
| P1-1 | **客户 Mind Map（知识地图）** | Co-STORM MindMap | 新建 `customer_mind_map.py` | 追踪"已知/未知"客户信息，避免重复问题 |
| P1-2 | **苏思多视角客户分析** | STORM Perspective-Guided QA | 升级 `strategist-susi-kb.md` + `lobster_runner.py` | 从4个视角全面分析客户，而非单一框架 |
| P1-3 | **运营人员插话 API** | Co-STORM Human Intervention | 新建 `lobster_inject_context_api.py` | 运营随时注入信息，龙虾实时调整执行方向 |
| P1-4 | **雷达并发多路搜索** | STORM Concurrent Retrieval | 升级 `radar-lintao-kb.md` + 雷达执行流程 | 多个搜索并发执行，从串行变并行，3x提速 |

### 🟡 P2（4项）

| # | 功能 | 借鉴自 | 落地位置 | 核心价值 |
|---|------|-------|---------|---------|
| P2-1 | **苏思报告大纲树展示** | STORM 文章大纲树 | 前端新增大纲组件 | 可视化展示分析报告的结构层次 |
| P2-2 | **引用来源侧边栏** | STORM 引用侧边栏 | 前端扩展 | 雷达报告引用可点击跳转来源 |
| P2-3 | **搜索引擎 Provider 池** | STORM 多 Retriever 接口 | 升级 `provider_registry.py` | 统一接口切换 Bing/Google/SearXNG |
| P2-4 | **龙虾输出质量评分** | STORM 文章质量评估 | 升级 `llm_quality_judge.py` | 引用覆盖率/信息密度/无效内容检测 |

---

## 十、STORM 架构对我们的总体评估

| 维度 | STORM | 我们 | 借鉴机会 |
|------|-------|------|---------|
| **多视角分析** | ✅ 强（N个视角并行） | ❌ 弱（单视角）| 苏思升级重点 |
| **知识追踪** | ✅ Mind Map | ❌ 只有静态 memory | customer_mind_map |
| **人机协作** | ✅ 随时插话 | ❌ 无 | 插话 API |
| **并发检索** | ✅ 多线程 | ❌ 串行 | 雷达并发 |
| **引用系统** | ✅ 每句话有来源 | 🟡 部分（P1-5已落地） | 已落地 |
| **模型差异化** | ✅ 不同任务不同模型 | ✅ provider_registry | 已落地 |
| **多 Agent 协作** | ✅ Expert+Moderator+Human | ✅ 9只龙虾+老健 | 已落地，更丰富 |
| **边缘执行** | ❌ 无 | ✅ edge-runtime | 我们更强 |
| **SaaS 多租户** | ❌ 无 | ✅ 完整 | 我们更强 |
| **销售域适配** | ❌ 通用学术写作 | ✅ 销售专用 | 我们更强 |

**结论**：STORM 在"知识研究+多视角+知识追踪"方面远超我们；我们在"销售域适配+边缘执行+SaaS多租户"方面远超 STORM。借鉴 STORM 的知识研究机制，嫁接到我们的销售龙虾团队，是本次最大的升级机会。

---

*来源：stanford-oval/storm | 分析日期：2026-04-02*
