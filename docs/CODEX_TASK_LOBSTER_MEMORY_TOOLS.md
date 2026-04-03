# CODEX TASK: 龙虾记忆检索工具集 lobster_memory_tools.py

**来源借鉴**: lossless-claw lcm_grep / lcm_describe / lcm_expand_query  
**优先级**: 🔴 高  
**预计工时**: 2-3h  
**产出文件**: `dragon-senate-saas-v2/lobster_memory_tools.py`

---

## 任务背景

lossless-claw 给 Agent 暴露了 `lcm_grep`（全文/正则搜索历史）、`lcm_describe`（查看摘要血缘）、`lcm_expand_query`（子Agent深度展开）三个记忆检索工具。

我们的龙虾目前**只有静态知识库（skills.json + battle_log.json）**，但**无法主动检索**。这导致龙虾遇到相似任务时，不能自动调取已有技能，每次都从零开始。

---

## 目标

为10只龙虾实现3个可调用的记忆检索工具函数，并注册到龙虾可用工具列表中。

---

## 实现规格

### 工具 1：kb_grep（知识库全文搜索）

```python
def kb_grep(
    lobster_id: str,
    pattern: str,
    scope: str = "both",       # "skills" | "battle_log" | "both"
    mode: str = "full_text",   # "full_text" | "regex"
    limit: int = 10,
) -> list[dict]:
    """
    在龙虾知识库中搜索相关技能条目和战斗记录。
    
    返回格式：
    [
      {
        "source": "skills_v3",          # 或 "battle_log"
        "entry_id": "ink_hook_v3_001",
        "title": "钩子选择公式",
        "snippet": "...匹配的上下文摘要...",
        "score": 0.85,                  # 相关度（关键词命中数）
        "tags": ["钩子", "标题", "吸引力"]
      },
      ...
    ]
    """
```

**实现要点**：
- 搜索范围：`docs/lobster-kb/{lobster_id}/skills.json` 的 `skills_v3` 字段 + `battle_log.json` 的 `entries` 字段
- full_text 模式：遍历 title、fixed_assets 描述、smart_slots 描述、tags 字段做关键词匹配
- regex 模式：用 `re.search` 对整个条目 JSON 字符串做正则搜索
- 按命中数量降序排列，截取 `limit` 条
- 支持 `lobster_id="all"` 搜索所有龙虾（跨龙虾检索）

---

### 工具 2：kb_describe（展开技能条目完整内容）

```python
def kb_describe(
    entry_id: str,
    lobster_id: str = None,    # None = 自动从所有龙虾中搜索
) -> dict | None:
    """
    展开一条 skills_v3 entry 的完整内容，包括：
    - fixed_assets（不变骨架）
    - smart_slots（执行变量槽）
    - execution_sop（执行步骤）
    - replication_checklist（复刻检查清单）
    - known_anti_patterns（反模式警告）
    - training_ref（来源训练任务）
    
    返回 None 表示未找到。
    """
```

**实现要点**：
- 通过 `entry_id` 前缀判断龙虾（如 `ink_` → inkwriter，`vis_` → visualizer）
- 返回完整 entry dict，不截断
- 同时返回该条目的 `battle_log` 关联记录（`battle_log_entries[].skill_v3_ref == entry_id`）

---

### 工具 3：kb_expand_query（自然语言检索 → 最相关技能推荐）

```python
async def kb_expand_query(
    lobster_id: str,
    query: str,                # 自然语言描述的任务/问题
    top_k: int = 3,
) -> list[dict]:
    """
    用 LLM 语义理解 query，从知识库中检索最相关的 top_k 条技能。
    
    流程：
    1. 用 LLM 把 query 转化为关键词列表
    2. 调用 kb_grep 做多关键词搜索
    3. 用 LLM 从候选结果中选出最相关的 top_k 条
    4. 返回完整的技能条目（调用 kb_describe）
    
    返回格式：
    [
      {
        "entry_id": "...",
        "relevance_reason": "LLM解释为什么这条技能最相关",
        "entry": { ...完整技能条目... }
      }
    ]
    """
```

**实现要点**：
- LLM 调用使用 `prompt_registry.py` 中的 `kb_expand_system_prompt`
- 超时控制：60秒内无结果返回空列表（不阻塞任务）
- 结果缓存：同 lobster_id + query 的结果缓存 5 分钟（内存 LRU）

---

## 注册到龙虾工具链

在 `lobster_runner.py` 的龙虾初始化中，将这3个工具注册为可调用函数：

```python
# lobster_runner.py 中
from dragon_senate_saas_v2.lobster_memory_tools import kb_grep, kb_describe, kb_expand_query

LOBSTER_TOOLS = {
    "kb_grep": kb_grep,
    "kb_describe": kb_describe,
    "kb_expand_query": kb_expand_query,
    # ...原有工具...
}
```

并在龙虾的 system prompt 中加入工具使用说明：

```
## 你的记忆检索工具

当你遇到不确定如何处理的任务时，可以主动检索自己的知识库：

1. kb_grep(lobster_id, pattern) → 快速搜索相关技能关键词
2. kb_describe(entry_id) → 查看某条技能的完整执行步骤
3. kb_expand_query(lobster_id, "我需要做什么") → 用自然语言找最相关技能

原则：遇到相似任务先检索，不要从零开始造轮子。
```

---

## 测试用例

```python
# test_lobster_memory_tools.py

def test_kb_grep_full_text():
    results = kb_grep("inkwriter", "钩子", scope="skills", limit=5)
    assert len(results) > 0
    assert any("钩子" in r["title"] for r in results)

def test_kb_grep_all_lobsters():
    results = kb_grep("all", "发布前检查")
    assert len(results) > 0

def test_kb_describe():
    result = kb_describe("ink_hook_v3_001")
    assert result is not None
    assert "fixed_assets" in result
    assert "execution_sop" in result

def test_kb_describe_not_found():
    result = kb_describe("nonexistent_entry_999")
    assert result is None

async def test_kb_expand_query():
    results = await kb_expand_query("inkwriter", "我要写一条吸引人的短视频标题", top_k=3)
    assert len(results) <= 3
    assert all("entry_id" in r for r in results)
```

---

## 验收标准

- [ ] `kb_grep` 能在 500ms 内返回结果（不调 LLM）
- [ ] `kb_describe` 能正确展开所有10只龙虾的 entry
- [ ] `kb_expand_query` 的 LLM 调用有超时保护
- [ ] 三个工具都有完整的 docstring 和类型注解
- [ ] 单元测试全部通过
