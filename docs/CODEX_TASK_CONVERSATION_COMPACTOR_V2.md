# CODEX TASK: 分层摘要压缩器 conversation_compactor_v2.py

**来源借鉴**: lossless-claw Leaf Compaction + Condensed Pass + fresh tail + integrity check  
**优先级**: 🔴 高  
**预计工时**: 3-4h  
**产出文件**: `dragon-senate-saas-v2/conversation_compactor_v2.py`  
**升级对象**: 替换 `conversation_compactor.py` 的单层摘要为两层架构

---

## 任务背景

现有的 `conversation_compactor.py` 是"一锅炖"式：把所有消息扔给 LLM 一次性摘要。

问题：
1. **消息过多时 LLM 被截断**，摘要质量下降
2. **最新消息被一起压缩**，丢失了执行热区上下文
3. **摘要被截断无法感知**，静默失败
4. **无降级策略**，LLM 失败时整个记忆丢失

lossless-claw 的分层方案：Leaf(d0) → Session(d1) → Arc(d2)，配合 fresh tail 保护和三级降级，实现零丢失。

---

## 实现规格

### 核心配置常量

```python
# conversation_compactor_v2.py 顶部

FRESH_TAIL_COUNT = 32          # 最近N条消息不压缩（热区保护）
LEAF_CHUNK_MAX_TOKENS = 8000   # 每个 Leaf 块最多 8000 token（约32000字符）
LEAF_MIN_MESSAGES = 8          # 触发 Leaf 压缩的最少消息数
SESSION_MIN_LEAVES = 3         # 触发 Session(d1) 压缩的最少 Leaf 数
SUMMARY_MAX_TOKENS = 2000      # 单条摘要最大 token 数
CHARS_PER_TOKEN = 4            # 粗略估算：4字符≈1 token
```

---

### 阶段一：Leaf 压缩（d0）

将消息列表按 `LEAF_CHUNK_MAX_TOKENS` 分块，每块生成一条 Leaf 摘要。

```python
def compress_to_leaves(
    lobster_id: str,
    messages: list[dict],       # 原始消息列表（排除 fresh tail）
    previous_summary: str = "",  # 上一条摘要（用于连续性）
) -> list[dict]:
    """
    将消息分块，每块调用 LLM 生成 Leaf 摘要。
    
    返回：
    [
      {
        "leaf_id": "leaf_001",
        "depth": 0,
        "kind": "leaf",
        "content": "...",
        "source_message_ids": [1,2,3,...],
        "token_count": 850,
        "earliest_at": "2026-04-01T10:00:00",
        "latest_at": "2026-04-01T11:30:00",
        "truncated": False,      # 完整性检查结果
      }
    ]
    """
```

**实现要点**：

1. **分块逻辑**：
   ```python
   def chunk_messages(messages, max_tokens):
       chunks = []
       current_chunk = []
       current_tokens = 0
       for msg in messages:
           msg_tokens = len(str(msg)) // CHARS_PER_TOKEN
           if current_tokens + msg_tokens > max_tokens and current_chunk:
               chunks.append(current_chunk)
               current_chunk = []
               current_tokens = 0
           current_chunk.append(msg)
           current_tokens += msg_tokens
       if current_chunk:
           chunks.append(current_chunk)
       return chunks
   ```

2. **Leaf Prompt**（固定，不随深度变化）：
   ```
   你是一个专业的会话摘要助手。
   请将以下对话块提炼为简洁的摘要（500-800字）。
   
   要求：
   - 保留关键决策、执行结果、数字和具体内容
   - 时间范围：{earliest} 至 {latest}
   - 上一摘要结尾：{previous_summary_tail}（避免重复）
   - 以"【摘要完毕】"结尾（用于完整性检测）
   
   对话内容：
   {messages_text}
   ```

3. **完整性检测**（借鉴 lossless-claw integrity.ts）：
   ```python
   def check_integrity(summary: str) -> bool:
       """检测摘要是否完整（未被截断）"""
       return summary.strip().endswith("【摘要完毕】")
   ```

4. **三级降级策略**：
   ```python
   async def summarize_with_fallback(messages_text, prompt_normal, prompt_aggressive):
       # 第1级：正常 prompt
       result = await llm_call(prompt_normal)
       if check_integrity(result) and len(result) <= SUMMARY_MAX_TOKENS * CHARS_PER_TOKEN:
           return result, "normal"
       
       # 第2级：激进 prompt（强制更短）
       result = await llm_call(prompt_aggressive)
       if check_integrity(result):
           return result, "aggressive"
       
       # 第3级：确定性截断兜底
       truncated = deterministic_truncate(messages_text, SUMMARY_MAX_TOKENS)
       return truncated + "\n【摘要完毕-截断版】", "truncated"
   ```

---

### 阶段二：Session 压缩（d1）

将多个 Leaf 摘要合并为一个 Session 级摘要。

```python
def compress_leaves_to_session(
    lobster_id: str,
    leaves: list[dict],         # Leaf 摘要列表
) -> dict | None:
    """
    将 >= SESSION_MIN_LEAVES 条 Leaf 摘要合并为 Session 摘要。
    返回 None 表示 Leaf 数量不足，不触发。
    
    返回：
    {
      "session_id": "session_001",
      "depth": 1,
      "kind": "session",
      "content": "...",
      "source_leaf_ids": ["leaf_001", "leaf_002", ...],
      "token_count": 1500,
      "earliest_at": "...",
      "latest_at": "...",
      "truncated": False,
    }
    """
```

**Session Prompt**（d1，比 Leaf 更抽象）：
```
你是一个专业的会话摘要助手。
请将以下多个对话块摘要提炼为一个更高层次的会话摘要（800-1200字）。

要求：
- 重点提炼：关键决策脉络、任务完成情况、重要结论
- 省略：具体执行细节（但保留重要数字和结果）
- 时间跨度：{earliest} 至 {latest}（共{leaf_count}个对话块）
- 以"【会话摘要完毕】"结尾

各块摘要：
{leaves_text}
```

---

### 主入口函数

```python
async def compact_lobster_session(
    lobster_id: str,
    messages: list[dict],
    existing_summaries: list[dict] = None,
    mode: str = "incremental",   # "incremental" | "full"
) -> dict:
    """
    主压缩函数，整合两阶段压缩。
    
    返回：
    {
      "lobster_id": "inkwriter",
      "mode": "incremental",
      "fresh_tail": [...最近32条消息...],
      "leaves": [...新生成的Leaf摘要...],
      "session_summary": {...Session摘要或None...},
      "context_for_next_turn": "...组装好的下轮上下文字符串...",
      "stats": {
        "messages_compressed": 120,
        "messages_protected": 32,
        "leaves_generated": 4,
        "session_generated": True,
        "degraded_count": 1,   # 触发降级的块数
      }
    }
    """
    
    # 1. 分离 fresh tail
    fresh_tail = messages[-FRESH_TAIL_COUNT:] if len(messages) > FRESH_TAIL_COUNT else messages
    compress_target = messages[:-FRESH_TAIL_COUNT] if len(messages) > FRESH_TAIL_COUNT else []
    
    # 2. 是否需要压缩
    if len(compress_target) < LEAF_MIN_MESSAGES:
        return {"fresh_tail": fresh_tail, "leaves": [], "session_summary": None, ...}
    
    # 3. Leaf 压缩
    leaves = await compress_to_leaves(lobster_id, compress_target)
    
    # 4. Session 压缩（如果 Leaf 够多）
    session_summary = None
    if len(leaves) >= SESSION_MIN_LEAVES:
        session_summary = await compress_leaves_to_session(lobster_id, leaves)
    
    # 5. 组装下轮上下文
    context = assemble_context(session_summary, leaves, fresh_tail)
    
    return {...}
```

---

### 上下文组装

```python
def assemble_context(
    session_summary: dict | None,
    leaves: list[dict],
    fresh_tail: list[dict],
) -> str:
    """
    按优先级组装龙虾下一轮的上下文：
    
    结构（从远到近）：
    [会话摘要（如果有）]
    [最近N条Leaf摘要（如果没有会话摘要）]
    [最近32条原始消息（fresh tail）]
    """
    parts = []
    
    if session_summary:
        parts.append(f"## 历史会话摘要\n{session_summary['content']}")
    elif leaves:
        recent_leaves = leaves[-3:]  # 最近3条 Leaf
        for leaf in recent_leaves:
            parts.append(f"## 对话块摘要（{leaf['earliest_at']} - {leaf['latest_at']}）\n{leaf['content']}")
    
    if fresh_tail:
        parts.append("## 最近对话记录")
        for msg in fresh_tail:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            parts.append(f"[{role}]: {content}")
    
    return "\n\n".join(parts)
```

---

### 持久化（轻量SQLite，可选）

如果不用 SQLite，可以用 JSON 文件存储：

```python
SUMMARY_STORE_PATH = "docs/lobster-kb/{lobster_id}/summary_store.json"

def save_summaries(lobster_id: str, leaves: list, session: dict | None):
    """将摘要持久化到文件，用于下次加载"""
    ...

def load_summaries(lobster_id: str) -> dict:
    """加载上次保存的摘要"""
    ...
```

---

## 与现有代码的接口兼容

为了不破坏现有调用，新版本提供向后兼容的包装器：

```python
# 向后兼容包装器
async def compact_conversation(lobster_id: str, messages: list) -> str:
    """
    向后兼容包装，返回格式与旧版本相同（纯字符串摘要）。
    内部使用 v2 分层压缩，但对外接口不变。
    """
    result = await compact_lobster_session(lobster_id, messages)
    return result["context_for_next_turn"]
```

---

## 测试用例

```python
# test_conversation_compactor_v2.py

def test_fresh_tail_protected():
    """最近32条消息不被压缩"""
    messages = [{"role": "user", "content": f"msg{i}"} for i in range(100)]
    result = await compact_lobster_session("inkwriter", messages)
    assert len(result["fresh_tail"]) == 32
    assert len(result["leaves"]) > 0

def test_integrity_check():
    """摘要完整性检测"""
    assert check_integrity("摘要内容\n【摘要完毕】") == True
    assert check_integrity("摘要内容（被截断）") == False

def test_three_level_fallback():
    """三级降级策略"""
    # Mock LLM 返回超大摘要
    ...

def test_context_assembly():
    """上下文组装顺序正确"""
    ...
```

---

## 验收标准

- [ ] fresh tail 保护：最近32条消息不进入压缩流程
- [ ] Leaf 完整性检测：每条 Leaf 末尾有 `【摘要完毕】` 标记
- [ ] 三级降级：当 LLM 返回超大/截断摘要时自动降级
- [ ] Session 压缩：≥3 条 Leaf 时自动生成 Session 摘要
- [ ] 向后兼容：旧的 `compact_conversation` 调用不报错
- [ ] 所有10只龙虾都能正常调用
