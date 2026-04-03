# CODEX TASK: 历史战斗日志回填技能 skills_backfill_runner.py

**来源借鉴**: lossless-claw tui/backfill.go（历史JSONL导入并压缩提炼）  
**优先级**: 🔴 高  
**预计工时**: 2-3h  
**产出文件**: `scripts/skills_backfill_runner.py`

---

## 任务背景

lossless-claw 的 `backfill` 功能可以把历史 JSONL 会话导入数据库并压缩成知识。

我们有类似需求：10只龙虾都积累了 `battle_log.json`（战斗记录），但这些记录**从未系统性地提炼为 skills_v3 条目**。历史战斗经验沉睡在日志里，龙虾每次执行还是从零开始。

目标：把历史 `battle_log.json` 中的成功案例批量提炼为 `skills_v3` 条目，追加到 `skills.json` 中。

---

## 实现规格

### 输入数据结构

`docs/lobster-kb/{lobster_id}/battle_log.json` 格式：

```json
{
  "lobster_id": "inkwriter",
  "entries": [
    {
      "entry_id": "bl_ink_20260401_001",
      "task_type": "短视频文案",
      "task_input": "为健身房写一条爆款朋友圈文案",
      "execution_steps": ["分析目标用户", "套用AIDA框架", "写3个版本"],
      "output_snippet": "...",
      "outcome": "success",        # success | partial | failed
      "quality_score": 4.2,        # 0-5
      "lessons_learned": "AIDA框架在健身场景转化率高",
      "skill_v3_ref": null,        # 已提炼过的条目指向 skills_v3.entry_id
      "created_at": "2026-04-01T10:00:00"
    }
  ]
}
```

### 输出数据结构

追加到 `docs/lobster-kb/{lobster_id}/skills.json` 的 `skills_v3` 数组：

```json
{
  "entry_id": "ink_aida_health_v3_001",
  "title": "健身场景AIDA文案框架",
  "category": "短视频文案",
  "source": "backfill",
  "backfill_from": ["bl_ink_20260401_001", "bl_ink_20260315_003"],
  "fixed_assets": {
    "framework": "Attention→Interest→Desire→Action",
    "proven_hooks": ["痛点开头", "数字震撼", "场景代入"]
  },
  "smart_slots": {
    "target_audience": "目标用户描述",
    "core_benefit": "产品核心卖点",
    "cta": "行动号召文案"
  },
  "execution_sop": [
    "1. 确认目标用户画像",
    "2. 选择钩子类型（痛点/数字/场景）",
    "3. 套入AIDA框架写主体",
    "4. 加强CTA"
  ],
  "replication_checklist": [
    "钩子是否在前3秒抓眼球",
    "Desire部分是否有具体数字"
  ],
  "known_anti_patterns": [
    "不要在开头就说产品名（用户会跳过）"
  ],
  "training_ref": "backfill_20260401",
  "quality_floor": 4.0,
  "sample_count": 3
}
```

---

## 主脚本逻辑

```python
# scripts/skills_backfill_runner.py

import json
import asyncio
from pathlib import Path
from typing import Optional

KB_BASE = Path("docs/lobster-kb")
QUALITY_THRESHOLD = 3.5          # 只提炼质量分 >= 3.5 的记录
MIN_SAMPLES_PER_SKILL = 2        # 至少2条相似记录才提炼为技能
SIMILARITY_CLUSTER_KEY = "task_type"  # 按任务类型聚类

ALL_LOBSTERS = [
    "commander", "strategist", "inkwriter", "visualizer",
    "radar", "dispatcher", "echoer", "catcher", "abacus", "followup"
]


async def backfill_lobster(
    lobster_id: str,
    dry_run: bool = True,
    min_quality: float = QUALITY_THRESHOLD,
) -> dict:
    """
    为单只龙虾执行 backfill。
    
    流程：
    1. 加载 battle_log.json
    2. 过滤：只保留 outcome=success 且 quality_score >= min_quality 的记录
    3. 过滤：跳过已有 skill_v3_ref 的记录（已提炼过）
    4. 按 task_type 聚类
    5. 对每个聚类（>=MIN_SAMPLES_PER_SKILL）调用 LLM 提炼 skills_v3
    6. 写入 skills.json（dry_run=True 时只打印，不写入）
    7. 更新 battle_log.json 中已提炼记录的 skill_v3_ref 字段
    
    返回：
    {
      "lobster_id": "inkwriter",
      "total_entries": 45,
      "eligible_entries": 28,
      "clusters": {"短视频文案": 8, "爆款标题": 5, ...},
      "skills_generated": 3,
      "skills_skipped": 2,
      "dry_run": True
    }
    """
```

### 聚类与提炼

```python
def cluster_entries(entries: list[dict]) -> dict[str, list[dict]]:
    """按 task_type 聚类战斗记录"""
    clusters = {}
    for entry in entries:
        key = entry.get(SIMILARITY_CLUSTER_KEY, "通用")
        clusters.setdefault(key, []).append(entry)
    # 过滤掉样本数不足的聚类
    return {k: v for k, v in clusters.items() if len(v) >= MIN_SAMPLES_PER_SKILL}


async def extract_skill_from_cluster(
    lobster_id: str,
    task_type: str,
    entries: list[dict],
) -> dict | None:
    """
    调用 LLM，从一批相似战斗记录中提炼 skills_v3 条目。
    返回 None 表示提炼失败或质量不足。
    """
    prompt = f"""
你是一个专业的技能提炼助手。
请从以下 {len(entries)} 条【{task_type}】类型的成功执行记录中，提炼出一条可复用的 skills_v3 技能条目。

执行记录：
{format_entries(entries)}

要求输出以下 JSON 格式（不要有其他内容）：
{{
  "title": "技能标题（10-20字）",
  "fixed_assets": {{
    "核心框架或方法": "..."
  }},
  "smart_slots": {{
    "变量名": "描述"
  }},
  "execution_sop": ["步骤1", "步骤2", "步骤3"],
  "replication_checklist": ["检查项1", "检查项2"],
  "known_anti_patterns": ["反模式1"],
  "quality_floor": 3.5
}}
"""
    raw = await llm_call_json(prompt)
    if not raw or "title" not in raw:
        return None
    
    # 生成 entry_id
    prefix = lobster_id[:3]
    slug = task_type[:10].replace(" ", "_")
    entry_id = f"{prefix}_{slug}_v3_backfill_{len(entries):02d}"
    
    return {
        "entry_id": entry_id,
        "category": task_type,
        "source": "backfill",
        "backfill_from": [e["entry_id"] for e in entries],
        "sample_count": len(entries),
        "training_ref": f"backfill_{today()}",
        **raw
    }
```

### 写入与更新

```python
def write_skill_to_kb(lobster_id: str, skill: dict) -> bool:
    """将提炼出的技能写入 skills.json"""
    path = KB_BASE / lobster_id / "skills.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    
    # 防重复：如果同 entry_id 已存在则跳过
    existing_ids = {e["entry_id"] for e in data.get("skills_v3", [])}
    if skill["entry_id"] in existing_ids:
        return False
    
    data.setdefault("skills_v3", []).append(skill)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return True


def update_battle_log_refs(
    lobster_id: str,
    entry_ids: list[str],
    skill_v3_ref: str,
):
    """更新 battle_log 中已提炼记录的 skill_v3_ref 字段"""
    path = KB_BASE / lobster_id / "battle_log.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    for entry in data.get("entries", []):
        if entry["entry_id"] in entry_ids:
            entry["skill_v3_ref"] = skill_v3_ref
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
```

---

## CLI 接口

```bash
# 单只龙虾 dry run（预览，不写入）
python scripts/skills_backfill_runner.py --lobster inkwriter --dry-run

# 单只龙虾实际执行
python scripts/skills_backfill_runner.py --lobster inkwriter --apply

# 全部龙虾 dry run
python scripts/skills_backfill_runner.py --all --dry-run

# 全部龙虾批量执行（生产用）
python scripts/skills_backfill_runner.py --all --apply

# 设置质量门槛
python scripts/skills_backfill_runner.py --all --apply --min-quality 4.0

# 查看当前 battle_log 统计
python scripts/skills_backfill_runner.py --stats
```

---

## 输出示例

```
=== BACKFILL DRY RUN: inkwriter ===
总记录: 45 条
合格记录（success + quality >= 3.5）: 28 条
已提炼（跳过）: 12 条
待提炼: 16 条

聚类结果:
  [短视频文案] 8条 → 可提炼
  [爆款标题]   5条 → 可提炼
  [朋友圈文案] 3条 → 样本不足（需 >= 2）跳过

预计生成技能:
  ✅ ink_短视频文案_v3_backfill_08  "短视频AIDA转化框架"
  ✅ ink_爆款标题_v3_backfill_05    "爆款标题五型模板"

DRY RUN 完成，添加 --apply 参数执行写入。
```

---

## stats 子命令

```bash
python scripts/skills_backfill_runner.py --stats
```

输出所有龙虾的知识库现状：

```
龙虾知识库统计 (2026-04-01)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
龙虾          战斗记录  已提炼  待提炼  skills_v3
commander        23      8      15       12
strategist       18      5      13        9
inkwriter        45     12      16       14
visualizer       31      9      22       11
radar            27      7      20        8
dispatcher       19      6      13        7
echoer           22      5      17        6
catcher          16      4      12        5
abacus           14      3      11        4
followup         20      6      14        8
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
总计            235     65     153       84
```

---

## 测试用例

```python
# tests/test_skills_backfill_runner.py

def test_filter_eligible_entries():
    """只保留 success + quality >= 3.5 的记录"""
    entries = [
        {"outcome": "success", "quality_score": 4.0, "skill_v3_ref": None},   # 合格
        {"outcome": "failed",  "quality_score": 4.5, "skill_v3_ref": None},   # 排除（失败）
        {"outcome": "success", "quality_score": 3.0, "skill_v3_ref": None},   # 排除（分低）
        {"outcome": "success", "quality_score": 4.2, "skill_v3_ref": "existing"},  # 排除（已提炼）
    ]
    result = filter_eligible(entries, min_quality=3.5)
    assert len(result) == 1

def test_cluster_entries():
    """按 task_type 聚类，过滤样本不足的"""
    entries = [
        {"task_type": "A", ...}, {"task_type": "A", ...}, {"task_type": "A", ...},
        {"task_type": "B", ...},  # 只有1条，不足 MIN_SAMPLES_PER_SKILL
    ]
    clusters = cluster_entries(entries)
    assert "A" in clusters
    assert "B" not in clusters

def test_write_skill_no_duplicate():
    """不重复写入相同 entry_id"""
    ...

async def test_extract_skill_from_cluster():
    """LLM 提炼结果格式正确"""
    ...
```

---

## 验收标准

- [ ] `--stats` 能正确统计所有10只龙虾的知识库现状
- [ ] `--dry-run` 预览模式不写入任何文件
- [ ] `--apply` 成功提炼技能并写入 `skills.json`
- [ ] 写入后 `battle_log.json` 中对应记录的 `skill_v3_ref` 字段被更新
- [ ] 不重复提炼（已有 `skill_v3_ref` 的记录自动跳过）
- [ ] LLM 调用失败时优雅跳过该聚类（不中断整个 backfill）
- [ ] 单元测试全部通过
