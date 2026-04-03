"""
龙虾魔鬼训练执行器 - DEVIL Training Runner v3
核心设计原则：学形化神 · 固定资产+高级填空

v3 新增：
- 训练产出不再只是文字记录，LLM必须同时输出 v3 skill JSON
- v3 skill JSON 按"固定资产+高级填空"结构强制提炼
- 训练完成后自动将神JSON写入对应龙虾的 skills.json（skills_v3 字段）
- battle_log 同时更新，记录"形→神"的转化来源
- 支持10只龙虾的通用训练流程
"""
import asyncio
import aiohttp
import json
import os
import re
from datetime import datetime

API_KEY = "sk-22974aabfb889c51847da87f0bac3518633d27261dff69055c62e9c3caf2fe3f"
API_URL = "https://codex.2api.com.cn/v1/chat/completions"
MODEL = "gpt-4o"
MAX_CONCURRENCY = 2

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KB_DIR = os.path.join(BASE_DIR, "docs", "lobster-kb")
SCHEMA_PATH = os.path.join(KB_DIR, "SKILL_SCHEMA_V3.json")


# ─────────────────────────────────────────────
# 文件操作
# ─────────────────────────────────────────────

def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_text(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def extract_json_block(text: str) -> dict | None:
    """从 LLM 输出中提取第一个合法的 JSON 代码块"""
    # 优先提取 ```json ... ``` 块
    pattern = r"```json\s*([\s\S]+?)\s*```"
    matches = re.findall(pattern, text, re.IGNORECASE)
    for m in matches:
        try:
            return json.loads(m)
        except Exception:
            continue
    # 降级：直接尝试解析整段
    try:
        return json.loads(text.strip())
    except Exception:
        return None


# ─────────────────────────────────────────────
# Prompt 构建
# ─────────────────────────────────────────────

def build_system_prompt(lobster_id: str, kb_text: str, skills: dict, training_task: dict) -> str:
    name = skills["meta"]["name"]
    role = skills["meta"]["role"]
    career = skills["meta"]["career_background"]
    level = skills["meta"]["level"]

    # 加载 v3 schema 作为参考
    schema_ref = ""
    if os.path.exists(SCHEMA_PATH):
        schema_data = load_json(SCHEMA_PATH)
        schema_ref = json.dumps(schema_data["skill_entry_template"], ensure_ascii=False, indent=2)

    # 现有 v3 技能（防止 ID 重复）
    existing_v3_ids = []
    if "skills_v3" in skills:
        existing_v3_ids = [s["entry_id"] for s in skills["skills_v3"]]

    return f"""你是 {name}（{role}），一个专业的内容营销AI龙虾。

## 你的职业背景
{career}

## 你的当前等级
{level}

## 你的知识库（摘要）
{kb_text[:1500]}

## 本次训练任务
{json.dumps(training_task, ensure_ascii=False, indent=2)}

---

## ⚠️ 训练核心原则：学形化神 · 固定资产+高级填空

你的训练产出分为两部分：

### 第一部分：认知层产出（文字）
1. **认知突破**——我以前为什么会犯这个错（思维惰性/认知盲区/错误假设）
2. **底层逻辑**——这件事背后的真实运作机制（用户/平台/协作方）
3. **我的判断原则**——以后遇到类似情况，我用什么标准做决策

### 第二部分：神JSON产出（强制要求）
在完成认知层产出后，你必须把学到的"形"提炼为"神"——即一个可以直接被调用的 v3 skill JSON。

#### 固定资产 vs 高级填空 的判断标准：
- 问题1：换一个行业，这个结论还成立吗？
  - 成立 → 固定资产（写入 fixed_assets）
  - 不成立 → 高级填空（写入 smart_slots）
- 问题2：换一个平台，这个结论还成立吗？
  - 成立 → 固定资产
  - 不成立 → 填空槽（slot_type 加平台选项）
- 问题3：换一个执行者，这个结论还成立吗？
  - 成立 → 固定资产（可直接传递）
  - 不成立 → 填空槽（who_fills 指定判断者）

#### v3 Skill JSON Schema（必须严格按此结构输出）：
{schema_ref}

#### 注意：
- entry_id 必须唯一，格式 [{lobster_id[:3]}_[类别]_v3_xxx]，不得与已有ID重复：{existing_v3_ids}
- fixed_assets 至少2条（不变的骨架）
- smart_slots 至少1条（执行时需要填的变量）
- execution_sop 至少4步
- replication_checklist 至少3条

---

## 输出格式（必须完整包含两部分）

### 【认知突破】
（诚实说出思维惰性/认知盲区）

### 【底层逻辑】
（用户/平台/协作方的真实运作机制）

### 【我的判断原则】
（1-3条，第一人称，内化后的认知）

### 【实战deliverable】
（任务要求的具体交付物文字版）

### 【神JSON】
（以下必须是一个合法的 JSON 代码块，包含完整的 v3 skill entry）

```json
{{
  "entry_id": "...",
  ...
}}
```

用中文回答认知部分，JSON字段中的中文内容保留中文，技术字段名保留英文。
"""


# ─────────────────────────────────────────────
# LLM 调用
# ─────────────────────────────────────────────

async def call_llm(session, system_prompt: str, user_prompt: str, sem) -> str:
    async with sem:
        headers = {
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": MODEL,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.72,
            "max_tokens": 4000
        }
        try:
            async with session.post(
                API_URL, json=payload, headers=headers,
                timeout=aiohttp.ClientTimeout(total=180)
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return data["choices"][0]["message"]["content"]
                else:
                    error_text = await resp.text()
                    return f"[API ERROR {resp.status}] {error_text}"
        except Exception as e:
            return f"[EXCEPTION] {str(e)}"


# ─────────────────────────────────────────────
# 神JSON 写库（核心新增逻辑）
# ─────────────────────────────────────────────

def write_skill_v3_to_kb(lobster_id: str, skill_entry: dict, training_ref: str) -> bool:
    """
    将提炼出的 v3 skill JSON 写入对应龙虾的 skills.json（skills_v3 字段）
    同时更新 battle_log.json 记录这次形→神的转化
    返回 True 表示写入成功
    """
    skills_path = os.path.join(KB_DIR, lobster_id, "skills.json")
    battle_log_path = os.path.join(KB_DIR, lobster_id, "battle_log.json")

    if not os.path.exists(skills_path):
        print(f"  ⚠️ 未找到 skills.json: {skills_path}")
        return False

    skills = load_json(skills_path)

    # 确保 skills_v3 字段存在
    if "skills_v3" not in skills:
        skills["skills_v3"] = []

    # 检查 entry_id 是否已存在（防重复）
    entry_id = skill_entry.get("entry_id", "")
    existing_ids = [s["entry_id"] for s in skills["skills_v3"]]
    if entry_id in existing_ids:
        print(f"  ⚠️ entry_id 已存在，跳过写入: {entry_id}")
        return False

    # 追加 training_ref（如果缺失）
    if "training_ref" not in skill_entry or not skill_entry["training_ref"]:
        skill_entry["training_ref"] = training_ref

    # 确保必要字段存在
    now = datetime.now().strftime("%Y-%m-%d")
    skill_entry.setdefault("status", "验证中")
    skill_entry.setdefault("verified_count", 0)
    skill_entry.setdefault("last_verified", now)
    skill_entry.setdefault("created_at", now)
    skill_entry.setdefault("tags", [])
    skill_entry.setdefault("superseded_by", None)

    skills["skills_v3"].append(skill_entry)
    skills["meta"]["last_updated"] = now
    skills["meta"]["version"] = "3.0"

    save_json(skills_path, skills)
    print(f"  ✅ 神JSON 已写入 skills_v3: {entry_id}")

    # 同步更新 battle_log
    if os.path.exists(battle_log_path):
        battle_log = load_json(battle_log_path)
        if "entries" not in battle_log:
            battle_log["entries"] = []

        # 找到对应的训练记录，追加 skill_v3_ref 字段
        for entry in battle_log["entries"]:
            if entry.get("task_ref") and entry["task_ref"] in training_ref:
                entry["skill_v3_ref"] = entry_id
                break

        battle_log["meta"]["last_updated"] = now
        save_json(battle_log_path, battle_log)
        print(f"  ✅ battle_log 已追加 skill_v3_ref: {entry_id}")

    return True


# ─────────────────────────────────────────────
# 单个训练任务执行
# ─────────────────────────────────────────────

async def execute_training_task(
    session, sem, lobster_id: str, task: dict,
    skills: dict, kb_text: str, session_id: str
) -> dict:
    task_id = task["task_id"]
    print(f"\n{'='*60}")
    print(f"🦞 [{lobster_id.upper()}] 任务: {task_id}")
    print(f"   {task['mission']}")
    print(f"   时限: {task['real_time_limit']} (模拟 {task['sim_time']})")
    print(f"{'='*60}")

    system_prompt = build_system_prompt(lobster_id, kb_text, skills, task)
    user_prompt = f"""开始执行训练任务 {task_id}。

任务：{task['mission']}

要交付的东西：{task['deliverable']}

⚠️ 特别提醒：
1. 认知层产出——先说清楚认知突破/底层逻辑/判断原则
2. 神JSON产出——必须把学到的形提炼为 v3 skill JSON（固定资产+高级填空）
   - fixed_assets：换行业/换平台/换执行者仍然成立的部分
   - smart_slots：需要根据场景填入的变量部分
3. 输出最后必须包含合法的 ```json ... ``` 代码块"""

    result = await call_llm(session, system_prompt, user_prompt, sem)

    # 预览输出
    lines = result.split('\n')
    preview = '\n'.join(lines[:6])
    print(f"\n✅ [{lobster_id.upper()}] {task_id} LLM响应完成")
    print(f"{'─'*50}")
    print(preview)
    print(f"{'─'*50}")

    # 提取神JSON
    skill_v3_entry = extract_json_block(result)
    write_success = False
    skill_entry_id = None

    if skill_v3_entry and isinstance(skill_v3_entry, dict) and "entry_id" in skill_v3_entry:
        training_ref = f"{session_id}-{task_id}"
        write_success = write_skill_v3_to_kb(lobster_id, skill_v3_entry, training_ref)
        skill_entry_id = skill_v3_entry.get("entry_id")
        if write_success:
            print(f"  📦 形→神 转化完成: {skill_entry_id}")
    else:
        print(f"  ⚠️ 未能从输出中提取合法的 v3 skill JSON，请人工检查")

    return {
        "task_id": task_id,
        "lobster": lobster_id,
        "timestamp": datetime.now().isoformat(),
        "status": "COMPLETED",
        "skill_v3_written": write_success,
        "skill_v3_entry_id": skill_entry_id,
        "result": result
    }


# ─────────────────────────────────────────────
# 主流程
# ─────────────────────────────────────────────

# 龙虾 ID → kb 文件名 映射
LOBSTER_KB_MAP = {
    "visualizer": "visualizer-shadow-kb.md",
    "inkwriter":  "inkwriter-moxiaoya-kb.md",
    "strategist": "strategist-susi-kb.md",
    "radar":      "radar-lintao-kb.md",
    "echoer":     "echoer-asheng-kb.md",
    "catcher":    "catcher-tiegou-kb.md",
    "abacus":     "abacus-suanwuyice-kb.md",
    "dispatcher": "dispatcher-laojian-kb.md",
    "followup":   "followup-xiaochui-kb.md",
    "commander":  "commander-chen-kb.md",
}


def load_lobster(lobster_id: str) -> dict | None:
    """加载单只龙虾的所有训练资料"""
    kb_filename = LOBSTER_KB_MAP.get(lobster_id)
    kb_path = os.path.join(KB_DIR, kb_filename) if kb_filename else None
    skills_path = os.path.join(KB_DIR, lobster_id, "skills.json")
    training_path = os.path.join(KB_DIR, lobster_id, "training_plan.json")

    if not os.path.exists(skills_path):
        print(f"⚠️ 未找到 {lobster_id}/skills.json，跳过")
        return None
    if not os.path.exists(training_path):
        print(f"⚠️ 未找到 {lobster_id}/training_plan.json，跳过")
        return None

    kb_text = ""
    if kb_path and os.path.exists(kb_path):
        kb_text = load_text(kb_path)
    else:
        print(f"⚠️ [{lobster_id}] 未找到 kb 文件，将使用空字符串代替")

    return {
        "skills": load_json(skills_path),
        "training": load_json(training_path),
        "kb": kb_text,
    }


async def run_lobster_training(
    session, sem, lobster_id: str, lobster_data: dict,
    session_id: str, round_name: str, task_index: int
) -> dict | None:
    """执行单只龙虾的单个训练任务"""
    training_plan = lobster_data["training"]

    if round_name == "boot":
        tasks_list = training_plan.get("boot_sequence", [])
    else:
        tasks_list = training_plan.get("training_tasks", [])

    if task_index >= len(tasks_list):
        print(f"⚠️ [{lobster_id}] {round_name}[{task_index}] 不存在，跳过")
        return None

    task = tasks_list[task_index]
    return await execute_training_task(
        session, sem, lobster_id, task,
        lobster_data["skills"], lobster_data["kb"], session_id
    )


async def main():
    import argparse
    parser = argparse.ArgumentParser(description="龙虾魔鬼训练执行器 v3")
    parser.add_argument(
        "--lobsters", nargs="+",
        default=["visualizer", "inkwriter"],
        help="要训练的龙虾ID列表（默认：visualizer inkwriter）"
    )
    parser.add_argument(
        "--session", default=None,
        help="训练session ID（默认自动生成）"
    )
    args = parser.parse_args()

    lobster_ids = args.lobsters
    session_id = args.session or f"DEVIL-SESSION-{datetime.now().strftime('%Y%m%d-%H%M')}"

    sem = asyncio.Semaphore(MAX_CONCURRENCY)

    # 加载龙虾数据
    lobsters = {}
    for lid in lobster_ids:
        data = load_lobster(lid)
        if data:
            lobsters[lid] = data

    if not lobsters:
        print("❌ 没有可用的龙虾数据，退出")
        return

    print("=" * 60)
    print(f"🔥 龙虾魔鬼训练系统 v3 启动")
    print(f"   Session: {session_id}")
    print(f"   核心原则：学形化神 · 固定资产+高级填空")
    print(f"   龙虾：{list(lobsters.keys())}")
    print(f"   时间: {datetime.now().isoformat()}")
    print("=" * 60)

    all_results = []

    async with aiohttp.ClientSession() as session:

        # 第一轮：BOOT（并发执行所有龙虾）
        print(f"\n📋 第一轮: BOOT 序列（形→神 提炼）")
        boot_tasks = [
            run_lobster_training(session, sem, lid, lobsters[lid], session_id, "boot", 0)
            for lid in lobsters
        ]
        boot_results = await asyncio.gather(*boot_tasks)
        all_results.extend([r for r in boot_results if r])

        # 第二轮：T001
        print(f"\n📋 第二轮: 训练任务 T001（形→神 提炼）")
        t001_tasks = [
            run_lobster_training(session, sem, lid, lobsters[lid], session_id, "training", 0)
            for lid in lobsters
        ]
        t001_results = await asyncio.gather(*t001_tasks)
        all_results.extend([r for r in t001_results if r])

        # 第三轮：T002
        print(f"\n📋 第三轮: 训练任务 T002（形→神 提炼）")
        t002_tasks = [
            run_lobster_training(session, sem, lid, lobsters[lid], session_id, "training", 1)
            for lid in lobsters
        ]
        t002_results = await asyncio.gather(*t002_tasks)
        all_results.extend([r for r in t002_results if r])

    # 统计写库结果
    written_count = sum(1 for r in all_results if r.get("skill_v3_written"))
    failed_count = len(all_results) - written_count

    # 保存完整会话记录
    output_path = os.path.join(KB_DIR, f"{session_id}.json")
    save_json(output_path, {
        "session_id": session_id,
        "version": "v3-学形化神",
        "schema": "固定资产+高级填空",
        "started_at": datetime.now().isoformat(),
        "lobsters": list(lobsters.keys()),
        "tasks_executed": len(all_results),
        "skill_v3_written": written_count,
        "skill_v3_failed": failed_count,
        "results": all_results
    })

    print(f"\n{'='*60}")
    print(f"🎯 训练完成！")
    print(f"   共执行任务: {len(all_results)} 个")
    print(f"   神JSON 成功写库: {written_count} 条")
    print(f"   需人工处理: {failed_count} 条")
    print(f"   结果保存至: {output_path}")
    print(f"{'='*60}")

    # 打印各任务写库状态
    print("\n📦 写库状态汇总：")
    for r in all_results:
        status = "✅" if r.get("skill_v3_written") else "⚠️ 未写库"
        entry_id = r.get("skill_v3_entry_id") or "（无JSON产出）"
        print(f"   {status} [{r['lobster'].upper()}] {r['task_id']} → {entry_id}")


# ─────────────────────────────────────────────
# 扩展工具：单任务手动写库（用于人工补录）
# ─────────────────────────────────────────────

def manual_write_skill_v3(lobster_id: str, skill_json_path: str, training_ref: str):
    """
    手动将一个 skill v3 JSON 文件写入知识库
    用法：python -c "from scripts.lobster_training_runner import manual_write_skill_v3; manual_write_skill_v3('inkwriter', 'path/to/skill.json', 'DEVIL-SESSION-003-INK-T003')"
    """
    skill_entry = load_json(skill_json_path)
    success = write_skill_v3_to_kb(lobster_id, skill_entry, training_ref)
    if success:
        print(f"✅ 手动写库成功: {skill_entry.get('entry_id')}")
    else:
        print(f"❌ 手动写库失败")


if __name__ == "__main__":
    asyncio.run(main())
