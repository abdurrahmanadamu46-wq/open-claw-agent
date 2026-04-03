# LOSSLESS_CLAW 借鉴分析报告

**来源项目**: https://github.com/Martian-Engineering/lossless-claw  
**分析日期**: 2026-04-01  
**分析人**: Codex  
**版本**: v0.5.3 (main branch)

---

## 一、项目定性

lossless-claw 是一个专为 **OpenClaw Agent 框架** 设计的 **上下文管理插件**，基于 LCM（Lossless Context Management）论文，用 **DAG式摘要树** 替代滑动窗口截断，实现"对话永不遗忘"。

**技术栈**：TypeScript（核心引擎） + Go（TUI调试工具） + SQLite（持久化）

**与我们的关系**：
- 他们是 OpenClaw 的插件层（上下文管理专项）
- 我们是完整的 SaaS + 多龙虾 + 边缘执行 + 云边调度系统
- **重叠点**：我们都有"龙虾记忆/上下文压缩"需求（conversation_compactor.py）
- **他们强于我们的点**：DAG式无损压缩、Agent工具集、TUI可视化调试

---

## 二、逐层分析与对比

### 2.1 前端层（lossless-claw 无独立前端）

lossless-claw **没有 Web 前端**，只有：
- `tui/`：Go 写的终端 TUI（查看DAG、修复摘要、移植对话）
- `openclaw.plugin.json`：插件声明，配置项通过 OpenClaw UI 暴露

**我们现有**：`dragon_dashboard.html` + React前端（agent-dashboard-server）  
**判断**：我们的前端更完整，略过。

**但有一点值得借鉴**：  
**TUI的"DAG可视化"理念** → 我们的 Web Dashboard 缺少一个"龙虾对话上下文可视化"视图，能看到当前每只龙虾的记忆树是什么状态。

---

### 2.2 云端大脑层

**lossless-claw 的"大脑"机制**：

```
src/engine.ts (92KB!) ← 核心调度引擎
src/compaction.ts (54KB) ← 压缩逻辑
src/assembler.ts (36KB) ← 上下文组装
src/summarize.ts (47KB) ← 摘要生成
```

核心流程：
1. **bootstrap** → 会话启动时从 JSONL 文件对齐 SQLite（崩溃恢复）
2. **ingest/ingestBatch** → 每条新消息写入 DB
3. **afterTurn** → 每轮结束后判断是否触发压缩
4. **上下文组装** → summaries（摘要）+ recent raw messages（保护尾部）

**与我们大脑层对比**：

| 维度 | lossless-claw | 我们（openclaw-agent） |
|------|--------------|----------------------|
| 上下文记忆 | DAG多层摘要，SQLite持久化，0丢失 | conversation_compactor.py，单次摘要压缩 |
| 崩溃恢复 | bootstrap自动从JSONL对齐DB | ❌ 无崩溃对齐机制 |
| 压缩触发 | afterTurn自动 + 手动/compact + 预算触发 | 手动调用 |
| 摘要分层 | Leaf(d0) → Condensed(d1/d2/d3+) 四层 | 单层摘要 |
| 新鲜尾部保护 | freshTailCount（默认64条不压缩） | ❌ 无 |
| 溢出回退 | 正常→激进→确定性截断三级降级 | ❌ 无降级策略 |

**🔴 强烈建议借鉴 #1：为龙虾会话记忆升级为分层摘要**

现在的 `conversation_compactor.py` 是"一锅炖"式单层摘要。借鉴 lossless-claw 的分层思路：

```python
# 当前（我们）：
summary = llm_call(all_messages)  # 单层

# 升级为（借鉴LCM）：
leaf_summaries = [llm_call(chunk) for chunk in message_chunks]  # Leaf层
session_summary = llm_call(leaf_summaries)                       # d1层
arc_summary = llm_call(session_summaries)                        # d2层（跨session）
```

**🔴 强烈建议借鉴 #2：fresh tail 保护机制**

龙虾最近 N 条消息（上下文热区）不应被压缩，避免截断刚刚发生的协作细节。

```python
FRESH_TAIL_COUNT = 32  # 最近32条消息不压缩
messages_to_compress = all_messages[:-FRESH_TAIL_COUNT]
fresh_tail = all_messages[-FRESH_TAIL_COUNT:]
```

**🟡 可选借鉴 #3：三级降级策略（正常→激进→截断）**

我们的 LLM 调用偶尔会返回超大摘要或失败，需要类似的降级：
1. 正常 prompt → 摘要
2. 激进 prompt（强制更短） → 摘要
3. 确定性截断兜底

---

### 2.3 龙虾层（9只龙虾 + Commander）

**lossless-claw 无"角色化Agent"概念**，是单一的上下文引擎。

**我们的龙虾系统完胜**：10只专业化龙虾、skills_v3 知识库、DEVIL训练、战斗日志等，lossless-claw 完全没有对应物。

**但有一个关键工具集值得借鉴**：

#### Agent 工具三件套

lossless-claw 给 Agent 暴露了 4 个工具：

```
lcm_grep        ← 正则/全文搜索历史消息和摘要
lcm_describe    ← 查看某个摘要的完整内容和血缘（父子关系）
lcm_expand_query← 启动子Agent，深度展开某段压缩历史回答问题
lcm_backfill    ← 导入历史JSONL会话（补档）
```

**🔴 强烈建议借鉴 #4：为龙虾暴露"历史记忆检索工具"**

目前龙虾调用历史只存在 battle_log.json 和 session 里，但龙虾无法主动查询。

建议为龙虾新增：

```python
# 龙虾工具：kb_grep
# 功能：在当前龙虾的 skills.json + battle_log.json 中搜索
# 用于：当龙虾遇到相似任务时，主动检索已有技能条目
def kb_grep(lobster_id: str, pattern: str) -> list[dict]:
    """在知识库中全文搜索"""
    ...

# 龙虾工具：kb_expand
# 功能：展开某条 skills_v3 entry 的完整内容（含 execution_sop）
# 用于：执行任务前加载最相关的技能知识
def kb_expand(entry_id: str) -> dict:
    """展开一条技能条目的完整内容"""
    ...
```

**🟡 可选借鉴 #5：session-patterns 忽略机制**

lossless-claw 有 `ignoreSessionPatterns`（glob匹配的会话忽略列表）和 `statelessSessionPatterns`（只读模式）。

我们的边缘端有 cron 任务和 heartbeat 会话，这些不应该污染龙虾的记忆库。

```yaml
# 建议在龙虾配置中增加
memory_skip_patterns:
  - "edge:*:heartbeat"
  - "agent:*:cron:**"
  - "system:*:health_check"
```

---

### 2.4 支撑微服务集群（1.5层）

**lossless-claw 的微服务支撑**：

```
src/db/          ← SQLite数据库层（消息、摘要、大文件）
src/store/       ← Store抽象（ConversationStore、SummaryStore）
src/plugin/      ← 插件注册和接口
src/integrity.ts ← 数据完整性校验（18KB）
src/large-files.ts ← 大文件拦截和摘要（15KB）
src/transcript-repair.ts ← 对话修复（8KB）
```

**亮点：大文件拦截机制**

`large-files.ts`：当消息中包含巨大文件（代码库、长文档）时，拦截它、存入 DB、生成"探索摘要"，只把摘要放入上下文。

**🟡 可选借鉴 #6：大文件/大 artifact 拦截**

我们有 `artifact_store.py`，但缺少"自动检测大内容 → 摘要替换"的机制。

当龙虾输出的 artifact 超大时（如长视频脚本、完整营销方案），建议：
1. 自动存入 artifact_store
2. 在上下文中只留"摘要引用"（`[artifact:xxx, 约2000字, 营销方案...]`）
3. 龙虾后续可调用 `artifact_expand(id)` 获取完整内容

**亮点：integrity 检查**

`integrity.ts`：主动检测摘要是否被 LLM 截断（位置感知的 marker 检查），如发现截断则自动 re-summarize。

**🔴 强烈建议借鉴 #7：摘要完整性自检**

我们目前没有机制检测 LLM 输出的摘要是否被 max_tokens 截断。

```python
# 建议在 conversation_compactor.py 中增加
def check_summary_integrity(summary: str, expected_sections: list) -> bool:
    """检测摘要是否被截断（末尾是否有完整结束标志）"""
    # 检查是否以完整句子结束（非截断）
    # 检查关键 section 是否都存在
    ...

def auto_repair_truncated_summary(lobster_id: str, summary: str) -> str:
    """对被截断的摘要发起补充摘要请求"""
    ...
```

---

### 2.5 云边调度层

**lossless-claw 无云边调度**，是纯本地 SQLite + 单机运行。

**我们完胜**：我们有完整的 WSS 协议、边缘端注册、云边任务分发、边缘心跳。略过。

**但有一点值得参考**：

`ignoreSessionPatterns` + `statelessSessionPatterns` 的概念可以用在**云边调度层的会话路由**：

```python
# 边缘端会话分类
STATELESS_EDGE_PATTERNS = [
    "edge:*:probe",      # 探测请求，不写记忆
    "edge:*:health",     # 健康检查
]
IGNORE_PATTERNS = [
    "edge:*:cron:**",    # 定时任务，不进记忆系统
]
```

---

### 2.6 边缘执行层

**lossless-claw 无边缘执行层**。

**我们完胜**：我们有完整的 `edge-runtime/`（WSS接收、上下文导航、Marionette执行器、心跳）。略过。

---

### 2.7 TUI 调试工具（Go 实现）

这是 lossless-claw 最独特的部分之一：

```
tui/main.go (71KB!)   ← 交互式 TUI 主体
tui/doctor.go         ← 检测并修复截断摘要
tui/dissolve.go       ← 撤销一次condensation（恢复父摘要）
tui/transplant.go     ← DAG迁移（跨会话复制摘要树）
tui/backfill.go       ← 历史JSONL导入并压缩
tui/rewrite.go        ← 用新prompt重写摘要节点
tui/repair.go         ← 修复损坏摘要
tui/prompts.go        ← prompt模板管理（导出/自定义/diff）
```

**功能亮点**：
- `doctor`：检测真实截断 vs 正常结束
- `dissolve`：可以"撤销"某次压缩，恢复细节
- `transplant`：把一个会话的DAG复制到另一个会话（跨上下文知识迁移）
- `backfill`：历史数据补档 → 这对我们**超级有用**！

**🔴 强烈建议借鉴 #8：历史知识回填（Backfill）机制**

我们的龙虾知识库（skills_v3）是训练得来的，但历史的 battle_log 数据没有系统性地提炼成技能。

对应的 backfill 思路：

```python
# 脚本：将历史 battle_log 批量提炼为 skills_v3
def backfill_skills_from_battle_log(lobster_id: str, log_file: str):
    """
    读取所有 battle_log entries
    → 按任务类型分组
    → 每组调用 LLM 提炼 skills_v3 entry
    → 写入 skills.json
    """
    ...
```

**🟡 可选借鉴 #9：Prompt模板版本管理**

lossless-claw 有完整的 prompt 版本管理：
- 4层深度感知模板（leaf/d1/d2/d3+）
- CLI 导出、diff、自定义
- 每次重写可以选择用哪个版本的 prompt

我们有 `prompt_registry.py`，但缺少"深度感知"和"diff/版本对比"功能。

---

## 三、核心借鉴优先级矩阵

| 借鉴点 | 影响层 | 优先级 | 实现难度 | 产出物 |
|--------|--------|--------|----------|--------|
| #1 分层摘要（Leaf→d1→d2） | 大脑/龙虾 | 🔴高 | 中 | conversation_compactor_v2.py |
| #2 fresh tail 保护 | 大脑/龙虾 | 🔴高 | 低 | 修改 conversation_compactor.py |
| #4 kb_grep / kb_expand 工具 | 龙虾 | 🔴高 | 低 | lobster_memory_tools.py |
| #7 摘要完整性自检 | 支撑服务 | 🔴高 | 低 | 修改 conversation_compactor.py |
| #8 历史Backfill提炼技能 | 龙虾知识库 | 🔴高 | 中 | skills_backfill_runner.py |
| #3 三级降级策略 | 大脑 | 🟡中 | 低 | 修改 conversation_compactor.py |
| #5 session-patterns 忽略 | 云边调度 | 🟡中 | 低 | 修改 edge-runtime 配置 |
| #6 大artifact自动摘要 | 支撑服务 | 🟡中 | 中 | 修改 artifact_store.py |
| #9 Prompt深度感知+版本diff | 支撑服务 | 🟡中 | 中 | 修改 prompt_registry.py |
| Dashboard DAG可视化 | 前端 | 🟢低 | 高 | dragon_dashboard 新视图 |

---

## 四、我们完胜的部分（不需要借鉴）

以下是我们明显领先 lossless-claw 的方向：

| 我们的优势 | lossless-claw | 状态 |
|-----------|--------------|------|
| 10只专业化角色龙虾（人格/技能/知识库） | 无角色概念 | 我们大幅领先 |
| 14步内容工作流（YAML DAG） | 无 | 我们独有 |
| 云边调度（WSS + 边缘心跳） | 无 | 我们独有 |
| 边缘执行（Marionette/浏览器自动化） | 无 | 我们独有 |
| 多租户 SaaS（计费/配额/RBAC） | 无 | 我们独有 |
| LLM质量评判器（llm_quality_judge.py） | 无 | 我们独有 |
| 视频合成器（video_composer.py） | 无 | 我们独有 |
| 中国渠道适配（微信/抖音等） | 无 | 我们独有 |
| skills_v3 固定资产+高级填空知识体系 | 无 | 我们独有 |

---

## 五、立即可以实施的 3 个 Codex Task

### Task A：lobster_memory_tools.py（龙虾记忆检索工具集）

```
目标：给龙虾暴露 kb_grep、kb_expand、kb_describe 三个工具
参考：lossless-claw 的 lcm_grep / lcm_describe / lcm_expand_query
我们的版本：查询 skills.json + battle_log.json
```

### Task B：conversation_compactor_v2.py（分层摘要 + fresh tail）

```
目标：将现有单层摘要升级为 Leaf → Session(d1) 两层架构
参考：lossless-claw 的 Leaf compaction + Condensed pass
增加：freshTailCount 保护 + 三级降级 + 完整性自检
```

### Task C：skills_backfill_runner.py（历史战斗日志回填技能）

```
目标：扫描所有龙虾的 battle_log.json，自动提炼为 skills_v3 entries
参考：lossless-claw 的 backfill 操作（历史数据 → 知识库）
输出：每只龙虾的 skills.json 追加新的 v3 条目
```

---

## 六、总结

lossless-claw 是一个**工程质量极高的上下文管理专项工具**，其 DAG 摘要树、无损压缩、Agent工具集、TUI调试系统等核心概念对我们的**龙虾记忆层**有直接参考价值。

我们的系统在**业务深度**（10只专业龙虾、SaaS多租户、云边调度）上远超 lossless-claw，但在**记忆管理的工程精细度**上（分层摘要、完整性自检、fresh tail保护）存在差距。

**最高价值的借鉴点**：
1. 分层摘要（让龙虾有"深度记忆"而不只是"单次总结"）
2. kb_grep/kb_expand 工具（让龙虾能主动检索自己的知识库）
3. 历史 Backfill（把已有的 battle_log 转化为可用的 skills_v3）
