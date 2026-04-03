# CLAWWORK 借鉴分析报告

**来源项目**: https://github.com/HKUDS/ClawWork  
**出处**: 香港大学数据科学实验室 (HKUDS)  
**分析日期**: 2026-04-01  
**分析人**: Codex  
**项目定位**: AI Coworker 经济基准测试平台（LiveBench）

---

## 一、项目定性

ClawWork 是一个 **AI Agent 经济存活仿真系统**，让 Agent 在 44+ 职业中完成真实工作任务，赚取收入、支付 token 成本、维持账户盈余。核心亮点：

- **GDPVal 数据集**：220+ 真实职业任务，有真实市场价值
- **经济追踪**：Agent 每消耗 1 token 就扣费，每完成任务就收入
- **8小时赚 $19K**：最强 Agent (ATIC + Qwen3.5-Plus) 以 $2285/小时的效率盈利
- **LLM-as-Judge**：GPT-4o 自动评分工作质量（0-100分，超过阈值才付款）

**技术栈**：Python + FastAPI + LangGraph + LangChain-MCP + React/Vite + Tailwind

**与我们的关系**：
- 他们：单一 Agent 在职业市场"打工"赚钱，无多龙虾协作，无云边调度
- 我们：10只专业化龙虾团队 + SaaS多租户 + 云边调度 + 边缘执行
- **重叠点**：工具集（沙箱执行、文件处理、视频生成）、LLM评估、前端Dashboard

---

## 二、逐层分析与对比

### 2.1 前端层

**ClawWork 前端架构**：
```
frontend/
├── src/App.jsx              ← 路由和全局状态
├── src/api.js               ← API请求封装
├── src/components/
│   ├── Sidebar.jsx (10KB)   ← 导航侧边栏
│   └── FilePreview.jsx (11KB) ← 文件预览
└── src/pages/
    ├── Dashboard.jsx (17KB)   ← 总览仪表盘
    ├── Leaderboard.jsx (38KB) ← 排行榜（⭐ 最复杂）
    ├── WorkView.jsx (31KB)    ← 工作过程实时视图
    ├── Artifacts.jsx (27KB)   ← 产出物展示
    ├── LearningView.jsx (9KB) ← 学习记录
    └── AgentDetail.jsx        ← Agent详情
```

**亮点1：Leaderboard.jsx（38KB，排行榜页面）**

ClawWork 有一个极其完善的**实时排行榜**，支持：
- 多 Agent 按余额/收入/时薪/质量分排序
- 实时余额更新（WebSocket 推送）
- 每个 Agent 的收益趋势折线图
- Token 成本 vs 收入的 ROI 展示

**我们目前**：`dragon_dashboard.html` 是单文件 HTML，没有多龙虾性能对比视图

**🔴 强烈建议借鉴 #1：龙虾绩效排行榜视图**

为每只龙虾展示类似 LeaderBoard 的绩效卡片：
- 完成任务数 / 成功率
- 平均质量分（llm_quality_judge 的分数）
- Token 消耗成本（来自 llm_call_logger）
- 本月 ROI（产出价值 / token成本）

**亮点2：WorkView.jsx（31KB，工作过程实时视图）**

展示 Agent 正在执行的任务的**实时思考过程**：
- 工具调用链（调了哪些工具，参数是什么，结果是什么）
- 每一步的思考文字（ReAct 链的 Thought 部分）
- 任务进度条（已完成步骤/总步骤）

**我们目前**：无法实时查看龙虾的工具调用过程

**🟡 可选借鉴 #2：龙虾任务执行实时视图**

在 dragon_dashboard 中增加"工作间"视图，实时展示龙虾当前任务的执行流水。

**亮点3：Artifacts.jsx（27KB，产出物展示）**

Agent 产出的各类文件都有专门的预览：
- PDF/Word/PPT 预览
- 代码文件高亮
- 图片预览
- Excel 表格渲染

**我们目前**：`artifact_store.py` 存了 artifacts，但 dashboard 没有文件预览界面

**🟡 可选借鉴 #3：Artifacts 预览界面**

将 ClawWork 的 `FilePreview.jsx`（11KB）理念移植到我们的 dashboard，支持龙虾产出的脚本/图片/视频封面的预览。

---

### 2.2 云端大脑层

**ClawWork 的"大脑"：live_agent.py (53KB)**

```python
# 核心架构：LangGraph StateGraph
class LiveAgent:
    def __init__(self, model, tools, config):
        self.graph = StateGraph(AgentState)
        # 节点：think → act → observe → think...（ReAct 循环）
        self.graph.add_node("think", self.think_node)
        self.graph.add_node("act", self.act_node)
        self.graph.add_node("observe", self.observe_node)
    
    async def run_task(self, task: Task) -> TaskResult:
        """单任务执行：ReAct 循环直到完成或预算耗尽"""
```

**关键设计：任务执行约束**

每个任务有 `max_steps` 和 `max_cost` 双重约束（ClawWork 原设计）：
- 超过步数 → 触发 wrapup_workflow（强制总结提交）
- 超过成本 → 停止执行（适用于 Agent 经济存活场景）

**⚠️ 我们的借鉴策略（与 ClawWork 原设计不同）**：

龙虾**不是** Agent，同时服务多个客户，**不设 Token/成本预算**。
只借鉴步数+时间的**软约束**思路，防止异常死循环占用执行槽：

**🔴 强烈建议借鉴 #4：龙虾执行软约束守卫（步数+时间，不含 Token）**

```python
# 建议在 lobster_runner.py 中增加
@dataclass
class LobsterExecutionGuard:
    max_steps: int = 25          # 步数上限（正常任务10-15步，留足余量）
    max_time_sec: int = 600      # 时间上限：10分钟
    warn_steps: int = 18         # 步数预警线（注入提示，不中断）
    warn_time_sec: int = 480     # 时间预警线（8分钟时预警）
    
    def check_soft_limit(self, steps, elapsed_sec) -> str | None:
        """超限触发收尾工作流（不是截断，而是优雅退出）"""
        if steps >= self.max_steps: return f"steps_exceeded ({steps})"
        if elapsed_sec >= self.max_time_sec: return f"timeout ({elapsed_sec:.0f}s)"
        return None
```

> 注：ClawWork 的 `max_cost` / `max_tokens` 经济约束在我们的场景中**略去**，成本由平台统一承担，不在龙虾执行层做截断。

**亮点：wrapup_workflow.py (17KB)**

当任务超时或步数超限时，自动触发"收尾工作流"：
1. 汇总已完成的工作
2. 生成部分完成报告
3. 决定是否可以提交（partial submission）
4. 计算可拿到的部分报酬

**我们目前**：龙虾任务失败时没有"部分提交"机制，全部清零

**🔴 强烈建议借鉴 #5：龙虾任务收尾工作流（部分完成机制）**

```python
# dragon-senate-saas-v2/lobster_wrapup.py
async def trigger_wrapup(
    lobster_id: str,
    task_id: str,
    reason: str,               # "steps_exceeded" | "timeout" | "error"
    completed_steps: list,
    remaining_steps: list,
) -> WrapupResult:
    """
    任务超限时触发收尾：
    1. 汇总已完成步骤的产出
    2. LLM 判断是否值得部分提交
    3. 生成"部分完成"状态报告
    4. 通知 Commander 剩余步骤需要重新分配
    """
```

---

### 2.3 龙虾层（Skill 系统 + Task Classifier）

**ClawWork 的 skill 系统**：`clawmode_integration/skill/SKILL.md`

ClawWork 有一个简单的 Skill 文档，描述 Agent 在特定职业场景下的工作方式。但这是**静态文档**，不是我们 skills_v3 那样的结构化知识库。

**我们的 skills_v3 完胜**：固定资产+智能槽+执行SOP+复刻检查清单，远超 ClawWork。

**ClawWork 的 task_classifier.py (5.6KB)**：

```python
class TaskClassifier:
    """将任务描述映射到 44 个职业类别"""
    PROFESSIONS = [
        "Software_Developers", "Financial_Analysts", "Lawyers", 
        "Nurses", "Project_Managers", ...  # 44个职业
    ]
    
    def classify(self, task_description: str) -> str:
        """用 LLM 判断该任务属于哪个职业类别"""
        # 用于选择对应的 meta_prompt（职业角色 prompt）
```

**亮点：44 个职业的 meta_prompts**

`eval/meta_prompts/` 目录下有 44 个 JSON 文件，每个文件是一个职业的完整 meta prompt，包含：
- 职业定义和工作范围
- 该职业常见任务类型
- 质量评估标准（针对该职业）
- 工作产出规范

**🔴 强烈建议借鉴 #6：龙虾职业化 meta prompt 体系**

ClawWork 的 44 个职业 meta_prompt 可以直接为我们的龙虾服务——每只龙虾面对不同类型的用户委托任务时，选择对应的职业 meta_prompt 作为背景知识。

具体：
- 建立 `dragon-senate-saas-v2/profession_meta/` 目录
- 将 ClawWork 的 44 个 JSON 适配成龙虾可读格式
- 在 `lobster_runner.py` 中，任务开始前调用 `task_classifier` 选择对应的职业 meta_prompt 注入

```python
# 使用示例
task = "帮我分析Q1财报并找出利润下滑原因"
profession = classify_task(task)  # → "Financial_Analysts"
meta_prompt = load_profession_meta("Financial_Analysts")
# 注入到龙虾的 system prompt 中
```

---

### 2.4 支撑微服务集群（1.5层）

**ClawWork 的关键工具集**：

```
livebench/tools/productivity/
├── code_execution.py          ← 本地代码执行
├── code_execution_sandbox.py  ← 沙箱执行（E2B/BoxLite，25KB！）
├── file_creation.py           ← 文件生成（PDF/Word/PPT/Excel）
├── file_reading.py            ← 文件读取（PDF解析/图片OCR，23KB！）
├── search.py                  ← 网页搜索（Tavily/Jina）
└── video_creation.py          ← 视频生成（8KB）
```

**重点对比：code_execution_sandbox.py（25KB）**

ClawWork 支持双沙箱后端：
- **E2B**（云端 Docker 沙箱，更安全，需 API key）
- **BoxLite**（本地虚拟化沙箱，实验性）

支持文件上传到沙箱、代码执行、结果下载。

**我们现有**：边缘端有 Marionette 执行器，但缺乏纯代码执行沙箱

**🟡 可选借鉴 #7：E2B 代码沙箱集成**

当龙虾需要执行 Python/JS 代码验证结果时，通过 E2B 沙箱安全执行，避免在本机上直接运行未知代码。

```python
# dragon-senate-saas-v2/code_sandbox.py
from e2b_code_interpreter import Sandbox

async def execute_code_safely(
    code: str,
    language: str = "python",
    timeout: int = 30,
) -> dict:
    """通过 E2B 沙箱安全执行代码，返回输出和错误"""
    async with Sandbox() as sandbox:
        result = await sandbox.run_code(code)
        return {
            "stdout": result.logs.stdout,
            "stderr": result.logs.stderr,
            "error": result.error,
        }
```

**重点对比：file_reading.py（23KB）**

ClawWork 能读取：
- PDF（pdf2image + Pillow + OCR）
- Word/DOCX
- Excel/CSV（pandas）
- 图片（OCR via Qwen-VL）
- 普通文本

**我们目前**：龙虾工具集缺少文件读取能力，尤其是 PDF/Word 解析

**🟡 可选借鉴 #8：龙虾文件读取工具**

将 ClawWork 的 `file_reading.py` 思路移植为我们的 `lobster_file_reader.py`，支持龙虾读取用户上传的文档作为任务背景材料。

**重点对比：economic_tracker.py（33KB）**

这是 ClawWork 最独特的模块——**精确的经济追踪系统**：

```python
class EconomicTracker:
    """追踪 Agent 的收支情况"""
    
    def record_cost(self, tokens_in, tokens_out, model_name):
        """记录 LLM 调用成本（按 token 定价）"""
    
    def record_income(self, task_id, amount, quality_score):
        """记录任务完成收入"""
    
    def get_balance(self) -> float:
        """当前余额 = 初始资金 + 收入 - 成本"""
    
    def get_hourly_rate(self) -> float:
        """每小时净收益"""
    
    def is_solvent(self) -> bool:
        """是否仍有偿债能力（余额 > 0）"""
```

**我们有 `saas_billing.py` 但那是租户计费**，缺少"每只龙虾的成本效益追踪"

**🔴 强烈建议借鉴 #9：龙虾个体成本效益追踪**

```python
# dragon-senate-saas-v2/lobster_economics.py
class LobsterEconomics:
    """追踪每只龙虾的成本效益"""
    
    def record_token_cost(self, lobster_id, task_id, tokens_in, tokens_out):
        """记录 LLM 调用成本"""
    
    def record_task_value(self, lobster_id, task_id, value, quality_score):
        """记录任务产出价值（按质量分加权）"""
    
    def get_lobster_roi(self, lobster_id, period="week") -> dict:
        """
        返回：
        {
          "total_cost": 12.5,      # USD token成本
          "total_value": 890.0,    # 任务产出价值
          "roi": 71.2,             # 倍数
          "quality_avg": 4.1,      # 平均质量分
          "cost_per_task": 0.83,   # 每任务成本
        }
        """
```

---

### 2.5 云边调度层

**ClawWork 无云边调度**，是单机本地运行。

**我们完胜**：WSS 云边协议、边缘端注册、任务分发、边缘心跳。略过。

---

### 2.6 边缘执行层

**ClawWork 无边缘执行**，所有工具在本机或云端沙箱（E2B）执行。

**我们完胜**：edge-runtime（WSS接收+Marionette浏览器自动化+上下文导航）远超 ClawWork。

**但有一点值得参考**：

ClawWork 的 **BoxLite 本地沙箱** 思路（轻量级 Docker 容器，限制内存/CPU）可以作为我们边缘端"受控代码执行"的参考。

---

### 2.7 SaaS 系统层

**ClawWork 无 SaaS**，是开源单机工具。没有多租户、计费、RBAC、配额。

**我们完胜**：`saas_billing.py`/`rbac_permission.py`/`quota_middleware.py`/`tenant_audit_log.py` 等完整 SaaS 组件。略过。

**但有两个子系统值得关注**：

**亮点：LLM Evaluator（llm_evaluator.py 30KB）**

ClawWork 的评估器是目前见过最完整的：
- 针对不同职业有专门的评估维度（会计 vs 护士 vs 律师的质量标准不同）
- 评分维度：准确性、完整性、专业性、格式规范、实用性（5维度）
- 有"争议处理"机制：分数在 40-60 分区间时触发第二轮评估
- 支持多模态评估（图表、文件、代码都能评）

**我们有 `llm_quality_judge.py`** 但评估维度较单一

**🔴 强烈建议借鉴 #10：职业化多维评估维度**

```python
# 建议升级 llm_quality_judge.py
EVALUATION_RUBRICS = {
    "content_creation": {
        "dimensions": ["创意性", "吸引力", "品牌一致性", "CTA有效性", "格式规范"],
        "weights": [0.25, 0.30, 0.20, 0.15, 0.10]
    },
    "data_analysis": {
        "dimensions": ["数据准确性", "洞察深度", "可视化质量", "结论有效性"],
        "weights": [0.35, 0.30, 0.20, 0.15]
    },
    "code_generation": {
        "dimensions": ["功能正确性", "代码质量", "文档完整性", "边界处理"],
        "weights": [0.40, 0.25, 0.20, 0.15]
    },
    # ...更多任务类型
}
```

**亮点：生成式任务指标（GDPVal 数据集）**

ClawWork 的 `task_values.jsonl` 和 `hourly_wage.csv` 为每种任务类型定义了**真实市场价值**：
- 会计师时薪：$35/hr
- 律师时薪：$120/hr
- 护士时薪：$45/hr
- 软件工程师：$65/hr

**🟡 可选借鉴 #11：龙虾任务市场价值估算**

给每类龙虾任务标注参考市场价值，用于计算系统的"经济产出"：
- 内容创作（inkwriter）：参考文案撰写师价值
- 数据分析（abacus）：参考数据分析师价值
- 策略规划（strategist）：参考咨询顾问价值

---

## 三、核心借鉴优先级矩阵

| 借鉴点 | 影响层 | 优先级 | 实现难度 | 产出物 |
|--------|--------|--------|----------|--------|
| #4 龙虾执行软约束守卫（步数+时间，无Token预算） | 大脑/龙虾 | 🔴高 | 低 | 修改 lobster_runner.py |
| #5 任务收尾工作流（部分提交）| 大脑/龙虾 | 🔴高 | 中 | lobster_wrapup.py |
| #6 44职业 meta_prompt 体系 | 龙虾 | 🔴高 | 中 | profession_meta/ + 修改 lobster_runner.py |
| #9 龙虾个体成本效益追踪 | 支撑服务 | 🔴高 | 低 | lobster_economics.py |
| #10 职业化多维评估维度 | 支撑服务 | 🔴高 | 中 | 升级 llm_quality_judge.py |
| #1 龙虾绩效排行榜视图 | 前端 | 🟡中 | 中 | dragon_dashboard 新视图 |
| #7 E2B 代码沙箱集成 | 支撑服务 | 🟡中 | 低 | code_sandbox.py |
| #8 龙虾文件读取工具 | 龙虾工具 | 🟡中 | 中 | lobster_file_reader.py |
| #2 工作过程实时视图 | 前端 | 🟡中 | 高 | dragon_dashboard 新视图 |
| #11 任务市场价值估算 | 支撑服务 | 🟢低 | 低 | task_value_registry.py |
| #3 Artifacts 预览界面 | 前端 | 🟢低 | 中 | dragon_dashboard 新视图 |

---

## 四、我们完胜的部分

| 我们的优势 | ClawWork | 状态 |
|-----------|---------|------|
| 10只专业化角色龙虾（人格/技能/知识库） | 单一无个性Agent | 我们大幅领先 |
| skills_v3 知识体系（固定资产+智能槽+SOP） | 简单 SKILL.md 文档 | 我们大幅领先 |
| 多租户 SaaS（计费/配额/RBAC） | 无 | 我们独有 |
| 云边调度（WSS + 边缘心跳） | 无 | 我们独有 |
| 边缘执行（Marionette/浏览器自动化） | 无，只有代码沙箱 | 我们独有 |
| 14步内容工作流（YAML DAG） | 无工作流引擎 | 我们独有 |
| 中国渠道适配（微信/抖音） | 无 | 我们独有 |
| 视频合成器（video_composer.py） | 简单 video_creation.py | 我们更完整 |
| DEVIL 训练体系 | 无训练体系 | 我们独有 |

---

## 五、可立即实施的 3 个 Codex Task

### Task A：lobster_economics.py（龙虾成本效益追踪）
```
目标：为每只龙虾建立独立的收支账本
参考：ClawWork economic_tracker.py
整合：llm_call_logger.py（成本）+ llm_quality_judge.py（质量→价值）
输出：每只龙虾的 ROI 报告 + Dashboard 新增成本效益卡片
```

### Task B：职业 meta_prompt 体系（profession_meta/）
```
目标：从 ClawWork 的 44 个职业 meta_prompt 中提取适合我们龙虾的内容
参考：eval/meta_prompts/*.json
适配：按龙虾分工映射职业（inkwriter→Editors/Journalists，abacus→Financial_Analysts）
输出：dragon-senate-saas-v2/profession_meta/ 目录 + task_classifier.py
```

### Task C：lobster_wrapup.py（任务收尾工作流）
```
目标：龙虾任务超预算时自动触发收尾，保存进度、部分提交
参考：ClawWork wrapup_workflow.py + llm_evaluator.py 的 partial credit 机制
增加：剩余步骤通知 Commander 重新分配
输出：dragon-senate-saas-v2/lobster_wrapup.py
```

---

## 六、总结

ClawWork 是一个**高质量的 AI 经济基准测试平台**，其核心价值在于：
1. **经济追踪精细度**（token成本→任务价值→ROI）
2. **44职业 meta_prompt 体系**（职业化的 Agent 身份和评估标准）
3. **任务预算约束 + 收尾工作流**（防止 Agent 无限循环）
4. **LLM-as-Judge 多维评估**（针对不同任务类型的专业评分）

我们在**系统架构深度**（多龙虾、SaaS、云边调度、边缘执行）上全面领先 ClawWork，但在**龙虾个体的经济理性和任务执行约束**上存在空白，值得重点借鉴。

**最高价值借鉴点**：
1. **执行软约束守卫**（步数+时间，防止异常死循环占用执行槽影响其他客户，无 Token/成本截断）
2. **龙虾成本效益追踪**（平台层面的 ROI 洞察，让运营知道哪只龙虾最高效）
3. **职业化多维评估**（llm_quality_judge 按任务类型差异化评分，而非单一质量分）
