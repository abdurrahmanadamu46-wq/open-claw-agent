# EliFuzz Awesome System Prompts Codex 索引

**来源**：https://github.com/EliFuzz/awesome-system-prompts  
**定位**：70+ 主流 AI 产品泄漏系统提示词库（Manus/Devin/Cursor/Perplexity/Parahelp/Cline 等）  
**分析日期**：2026-04-02  
**状态**：✅ 分析完成，P1/P2 任务已拆解

---

## 文档索引

| 文档 | 说明 |
|------|------|
| [AWESOME_SYSPROMPTS_ELIFUZZ_ANALYSIS.md](./AWESOME_SYSPROMPTS_ELIFUZZ_ANALYSIS.md) | 完整借鉴分析（10大产品逐一解析 + 7层对比 + 4大Prompt规律）|
| [CODEX_TASK_ELIFUZZ_P1.md](./CODEX_TASK_ELIFUZZ_P1.md) | P1 任务（6个，含完整代码实现规格）|

---

## 🏆 本次分析最高价值发现

### Parahelp Manager-Agent 审批机制（惊天发现）

```
传统龙虾执行流程（有缺陷）：
  老健发令 → 龙虾执行 → 汇报结果
  问题：执行中无拦截，墨小雅写了违规内容也无法阻止

借鉴 Parahelp 后的新流程：
  老健发令 → 龙虾生成 draft_action（草稿）
           → Commander Gate 审批（~0.5s）
           → 通过：执行；拒绝：发 feedback 让龙虾修改
           → 执行结果记入 audit_logger
  
审批格式（XML，清晰高效）：
  通过：<commander_verify>accept</commander_verify>
  拒绝：<commander_verify>reject</commander_verify>
         <feedback>具体原因</feedback>
```

---

## P1 任务清单（6项，立即落地）

| # | 任务 | 借鉴自 | 落地文件 | 核心价值 |
|---|------|-------|---------|---------|
| P1-1 | **龙虾指挥官审批层** | Parahelp manager | `commander_gate.py`（新建）| 高风险操作执行前审批，防止越权/违规 |
| P1-2 | **龙虾执行三阶段** | Devin | 升级 `lobster_runner.py` | Plan→Execute→Verify，显式验收标准 |
| P1-3 | **龙虾权限分级 L1-L4** | Manus | 升级 `rbac_permission.py` | 只读/草稿/执行/协调 四级权限边界 |
| P1-4 | **"不确定时问人"规则** | Cline | 升级所有龙虾 KB | 防止自行假设导致执行偏差 |
| P1-5 | **雷达引用标注** | Perplexity | 升级 `web_search_tool.py` | 每条信息带来源+时间+可信度 |
| P1-6 | **边缘破坏性保护** | Cursor | 升级 `marionette_executor.py` | 删除/覆写操作前二次确认 |

## P2 任务清单（2项，计划落地）

| # | 任务 | 借鉴自 | 落地文件 | 核心价值 |
|---|------|-------|---------|---------|
| P2-1 | **Tool call rationale 字段** | Cursor | 升级 `audit_logger.py` | 工具调用附带理由，可追溯决策 |
| P2-2 | **龙虾技能库文档站** | EliFuzz Docusaurus | 新建文档站 | 在线展示龙虾技能和提示词 |

---

## 4 大跨产品 Prompt 工程规律

| # | 规律 | 来源 | 我们的缺口 |
|---|------|------|-----------|
| 规律1 | **角色+禁区+格式 = 最小完整提示词** | 全部产品 | 缺统一输出格式规范（影子/苏思格式不统一）|
| 规律2 | **不确定时提前问，而非事后纠正** | Cline/Cursor/Devin | 龙虾遇到歧义会自行假设 |
| 规律3 | **工具调用=原子操作+理由+确认** | Cursor/Manus | 工具调用缺 rationale 和 expected_result |
| 规律4 | **审批流=高风险操作的护城河** | Parahelp | 完全缺失（P1-1 填补）|

---

## 龙虾权限分级一览（借鉴 Manus）

| 龙虾 | 级别 | 标签 | 核心权限 |
|------|------|------|---------|
| 林桃（雷达）| L1 | 只读侦察 | 搜索/分析/内部报告 |
| 算无遗策（算盘）| L1 | 只读计算 | 计算ROI/读取定价 |
| 墨小雅（墨手）| L2 | 内容草稿 | 写消息草稿（需审批后发出）|
| 影子（可视化）| L2 | 可视化草稿 | 生成图表/报告 |
| 苏思（策略师）| L2 | 策略草稿 | 分析线索/写策略 |
| 阿声（回声）| L3 | 对外执行 | 发消息/打电话（需过 Gate）|
| 铁狗（捕手）| L3 | 线索执行 | 线索资格认定 |
| 小锤（跟进）| L3 | 跟进执行 | 发跟进消息（需过 Gate）|
| 老健（调度）| L4 | 任务协调 | 分配任务/监控进度 |
| 大脑（指挥）| L4 | 最高协调 | 全权限 |

---

## Commander Gate 审批触发规则

```
🔴 必须审批（任何情况）：
  - send_message：向线索发任何消息
  - send_quote：发报价单
  - make_promise：做任何承诺（交期/折扣/功能）

🟡 建议审批（内容检查触发）：
  - 消息含竞品名称
  - 单日向同一线索发送 >2 条消息
  - 消息含"免费""保证""承诺"等关键词

🟢 直接执行（无需审批）：
  - 调研分析（L1 龙虾所有操作）
  - 内部报告生成
  - ROI 计算
  - 数据统计和可视化
```

---

*EliFuzz/awesome-system-prompts | 分析完成 2026-04-02*
