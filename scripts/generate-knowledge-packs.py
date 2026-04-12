#!/usr/bin/env python3
"""
🦞 龙虾知识包批量填充脚本 — SP2 Knowledge Pack Generator
==========================================================

读取每只虾的 role-card.json + prompt-kit，调用 LLM 生成：
  1. 行业规则库 (industry-rules.json)     — 每虾需要知道的行业规则/最佳实践
  2. 钩子库 (hooks-library.json)          — 每虾可用的触发钩子/行动模板
  3. 评分特征库 (scoring-features.json)   — 每虾评估质量的特征维度
  4. 扩展金案例 (expanded-golden-cases.json) — 扩展 datasets/golden-cases.json

使用方法:
  1. 设置环境变量:
     set OPENAI_API_KEY=sk-xxx
     set OPENAI_BASE_URL=https://www.ananapi.com/v1  (可选，默认 https://api.openai.com/v1)
     set OPENAI_MODEL=gpt-4o  (可选，默认 gpt-4o)
  2. 运行:
     python scripts/generate-knowledge-packs.py
  3. 可选参数:
     --lobster radar          只处理一只虾
     --lobster all            处理全部9只（默认）
     --dry-run                只打印prompt，不调用LLM
     --industries "医疗,教育,家装"  指定行业（默认5个核心行业）
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
LOBSTERS_DIR = REPO_ROOT / "packages" / "lobsters"
OUTPUT_DIR = REPO_ROOT / "dragon-senate-saas-v2" / "data" / "knowledge-packs"

ALL_LOBSTER_IDS = [
    "radar", "strategist", "inkwriter", "visualizer",
    "dispatcher", "echoer", "catcher", "abacus", "followup",
]

DEFAULT_INDUSTRIES = [
    "本地生活_医疗口腔",
    "本地生活_家装装修",
    "本地生活_教育培训",
    "本地生活_婚纱摄影",
    "电商_美妆护肤",
]

# Per-lobster knowledge generation prompts
LOBSTER_KB_INSTRUCTIONS: dict[str, dict[str, str]] = {
    "radar": {
        "industry_rules": "作为触须虾(Radar)，你负责信号扫描和噪音过滤。请生成该行业中：1）平台规则变更的常见模式 2）竞品监控的关键指标 3）信号可信度评估规则 4）噪音过滤规则",
        "hooks": "请生成Radar虾在该行业可用的监控钩子：1）平台公告监控触发器 2）竞品行为变化检测点 3）趋势信号聚合规则 4）预警阈值设置",
        "scoring": "请生成Radar虾评估信号质量的评分特征：1）来源可信度(0-1) 2）信号新鲜度 3）影响范围 4）可操作性 5）噪音概率",
    },
    "strategist": {
        "industry_rules": "作为脑虫虾(Strategist)，你负责目标拆解和策略路由。请生成该行业中：1）典型获客策略模式 2）ROI 优先级排序规则 3）风险评估标准 4）资源分配原则",
        "hooks": "请生成Strategist虾在该行业可用的策略钩子：1）策略触发条件 2）A/B测试框架 3）预算分配模板 4）止损触发点",
        "scoring": "请生成Strategist虾评估策略质量的评分特征：1）目标达成概率 2）资源效率 3）风险暴露度 4）可执行性 5）时间窗口适配度",
    },
    "inkwriter": {
        "industry_rules": "作为吐墨虾(InkWriter)，你负责成交导向文案。请生成该行业中：1）高转化文案结构模板 2）行业专业术语库 3）合规红线词汇 4）情感钩子模式",
        "hooks": "请生成InkWriter虾在该行业可用的文案钩子：1）标题模板库 2）痛点-解决方案对照表 3）行动号召(CTA)模板 4）信任背书元素",
        "scoring": "请生成InkWriter虾评估文案质量的评分特征：1）钩子强度 2）专业度 3）情感共鸣 4）合规安全性 5）CTA清晰度",
    },
    "visualizer": {
        "industry_rules": "作为幻影虾(Visualizer)，你负责分镜和视觉设计。请生成该行业中：1）高完播率视频结构 2）首屏吸引力规则 3）视觉风格标准 4）证据感画面规范",
        "hooks": "请生成Visualizer虾在该行业可用的视觉钩子：1）开场3秒模板 2）分镜节奏模板 3）字幕/标注样式 4）转场效果推荐",
        "scoring": "请生成Visualizer虾评估视觉质量的评分特征：1）首屏停留率预测 2）信息密度 3）品牌一致性 4）证据感强度 5）完播率预测",
    },
    "dispatcher": {
        "industry_rules": "作为点兵虾(Dispatcher)，你负责执行计划拆包。请生成该行业中：1）发布节奏规则 2）渠道选择矩阵 3）灰度发布策略 4）止损条件",
        "hooks": "请生成Dispatcher虾在该行业可用的调度钩子：1）最佳发布时间窗口 2）渠道优先级规则 3）预算分配触发器 4）紧急止损触发器",
        "scoring": "请生成Dispatcher虾评估执行计划质量的评分特征：1）覆盖率 2）节奏合理性 3）资源利用率 4）风险缓释度 5）响应速度",
    },
    "echoer": {
        "industry_rules": "作为回声虾(Echoer)，你负责互动回复和评论管理。请生成该行业中：1）真人感回复模板 2）负面评论处理规则 3）互动转化话术 4）情绪承接策略",
        "hooks": "请生成Echoer虾在该行业可用的互动钩子：1）正面评论跟进模板 2）质疑回应模板 3）引导私聊话术 4）社群互动触发器",
        "scoring": "请生成Echoer虾评估互动质量的评分特征：1）真人感评分 2）情绪匹配度 3）转化引导率 4）回复及时性 5）品牌调性一致性",
    },
    "catcher": {
        "industry_rules": "作为铁网虾(Catcher)，你负责线索识别和过滤。请生成该行业中：1）高意向信号识别规则 2）低质量线索过滤规则 3）预算判断标准 4）紧迫度评估维度",
        "hooks": "请生成Catcher虾在该行业可用的线索捕获钩子：1）意向关键词库 2）行为信号触发器 3）竞品比较信号 4）购买时机信号",
        "scoring": "请生成Catcher虾评估线索质量的评分特征：1）意向强度(0-100) 2）预算匹配度 3）决策阶段 4）时效性 5）转化概率",
    },
    "abacus": {
        "industry_rules": "作为金算虾(Abacus)，你负责评分和ROI计算。请生成该行业中：1）ROI计算公式 2）归因模型规则 3）成本基准线 4）效果对标标准",
        "hooks": "请生成Abacus虾在该行业可用的评估钩子：1）实时ROI计算触发器 2）成本超标预警 3）效果拐点检测 4）归因窗口规则",
        "scoring": "请生成Abacus虾评估效果质量的评分特征：1）CPA(单客成本) 2）ROAS(广告回报) 3）LTV预测 4）渠道效率 5）边际收益",
    },
    "followup": {
        "industry_rules": "作为回访虾(FollowUp)，你负责客户跟进和二次激活。请生成该行业中：1）跟进节奏SOP 2）二次激活话术 3）客户分层规则 4）流失预警信号",
        "hooks": "请生成FollowUp虾在该行业可用的跟进钩子：1）首次跟进时机 2）多次跟进节奏模板 3）激活优惠触发器 4）流失挽回触发器",
        "scoring": "请生成FollowUp虾评估跟进质量的评分特征：1）跟进及时性 2）客户满意度 3）二次转化率 4）流失挽回率 5）LTV提升",
    },
}

# ---------------------------------------------------------------------------
# LLM Client
# ---------------------------------------------------------------------------

def _call_llm(prompt: str, system: str = "", model: str = "gpt-4o", base_url: str = "", api_key: str = "") -> str:
    """Call OpenAI-compatible API. Returns raw text response."""
    import urllib.request
    import ssl

    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")

    url = f"{base_url.rstrip('/')}/chat/completions"

    payload = {
        "model": model,
        "messages": [],
        "temperature": 0.7,
        "max_tokens": 4000,
    }
    if system:
        payload["messages"].append({"role": "system", "content": system})
    payload["messages"].append({"role": "user", "content": prompt})

    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }

    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    ctx = ssl.create_default_context()

    try:
        with urllib.request.urlopen(req, timeout=120, context=ctx) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result["choices"][0]["message"]["content"]
    except Exception as e:
        print(f"  ❌ LLM call failed: {e}")
        raise


def _parse_json_from_llm(text: str) -> Any:
    """Extract JSON from LLM response (handles markdown code fences)."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        # Remove first and last lines (code fences)
        start = 1
        end = len(lines)
        for i in range(len(lines) - 1, 0, -1):
            if lines[i].strip().startswith("```"):
                end = i
                break
        text = "\n".join(lines[start:end])
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try to find JSON object/array in text
        for i, ch in enumerate(text):
            if ch in ("{", "["):
                try:
                    return json.loads(text[i:])
                except json.JSONDecodeError:
                    continue
        print(f"  ⚠️ Could not parse JSON, saving as raw text")
        return {"_raw_text": text}


# ---------------------------------------------------------------------------
# Knowledge Pack Generator
# ---------------------------------------------------------------------------

def load_role_card(lobster_id: str) -> dict[str, Any]:
    """Load role-card.json for a lobster."""
    path = LOBSTERS_DIR / f"lobster-{lobster_id}" / "role-card.json"
    if not path.exists():
        raise FileNotFoundError(f"Role card not found: {path}")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_system_prompt(lobster_id: str) -> str:
    """Load system.prompt.md for a lobster."""
    path = LOBSTERS_DIR / f"lobster-{lobster_id}" / "prompt-kit" / "system.prompt.md"
    if not path.exists():
        return ""
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def load_existing_golden_cases(lobster_id: str) -> dict[str, Any]:
    """Load existing golden-cases.json."""
    path = LOBSTERS_DIR / f"lobster-{lobster_id}" / "datasets" / "golden-cases.json"
    if not path.exists():
        return {"cases": []}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def generate_knowledge_pack(
    lobster_id: str,
    industry: str,
    pack_type: str,
    *,
    role_card: dict[str, Any],
    system_prompt: str,
    model: str,
    base_url: str,
    api_key: str,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Generate one knowledge pack for one lobster x one industry x one pack type."""

    instructions = LOBSTER_KB_INSTRUCTIONS.get(lobster_id, {})
    specific_instruction = instructions.get(pack_type, "")

    system_msg = (
        f"你是 OpenClaw Agent 龙虾元老院中的 {role_card.get('zhName', lobster_id)} ({role_card.get('displayName', lobster_id)})。\n"
        f"你的职责：{role_card.get('mission', '')}\n"
        f"你的主要工件：{role_card.get('primaryArtifact', '')}\n\n"
        f"已有系统提示词：\n{system_prompt[:800]}\n\n"
        f"请严格以 JSON 格式回答，不要加任何解释文字。"
    )

    user_msg = (
        f"行业：{industry}\n\n"
        f"{specific_instruction}\n\n"
        f"请以 JSON 格式输出，要求：\n"
        f'- 顶层字段: "industry", "lobster_id", "pack_type", "version", "items"\n'
        f'- "items" 是一个数组，每个 item 包含: "id", "title", "description", "examples"(数组), "priority"(high/medium/low)\n'
        f"- 至少生成 8-12 个 items\n"
        f"- 所有内容用中文，但专业术语可保留英文"
    )

    if dry_run:
        print(f"\n--- DRY RUN: {lobster_id} / {industry} / {pack_type} ---")
        print(f"System: {system_msg[:200]}...")
        print(f"User: {user_msg[:200]}...")
        return {"_dry_run": True, "lobster_id": lobster_id, "industry": industry, "pack_type": pack_type}

    print(f"  🤖 Calling LLM for {lobster_id}/{industry}/{pack_type}...")
    raw = _call_llm(user_msg, system=system_msg, model=model, base_url=base_url, api_key=api_key)
    result = _parse_json_from_llm(raw)

    # Ensure metadata
    if isinstance(result, dict):
        result.setdefault("industry", industry)
        result.setdefault("lobster_id", lobster_id)
        result.setdefault("pack_type", pack_type)
        result.setdefault("version", "v0.1")
        result.setdefault("generated_at", time.strftime("%Y-%m-%dT%H:%M:%S%z"))

    return result


def generate_expanded_golden_cases(
    lobster_id: str,
    industry: str,
    *,
    role_card: dict[str, Any],
    system_prompt: str,
    existing_cases: dict[str, Any],
    model: str,
    base_url: str,
    api_key: str,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Generate expanded golden cases for a lobster x industry."""

    existing_count = len(existing_cases.get("cases", []))
    existing_sample = json.dumps(existing_cases.get("cases", [])[:2], ensure_ascii=False, indent=2)

    system_msg = (
        f"你是 {role_card.get('zhName', lobster_id)}，职责是 {role_card.get('mission', '')}。\n"
        f"你的输入契约: {json.dumps(role_card.get('inputContract', []), ensure_ascii=False)}\n"
        f"你的输出契约: {json.dumps(role_card.get('outputContract', []), ensure_ascii=False)}\n"
        f"请严格以 JSON 格式回答。"
    )

    user_msg = (
        f"行业：{industry}\n"
        f"当前已有 {existing_count} 个金案例，样例：\n{existing_sample}\n\n"
        f"请为该行业额外生成 6 个高质量金案例，包含：\n"
        f"- 2个 happy_path（正常成功流程）\n"
        f"- 2个 edge_case（边界情况）\n"
        f"- 2个 failure_case（失败/降级场景）\n\n"
        f"每个案例格式：\n"
        f'{{"id": "...", "label": "happy_path|edge_case|failure_case", '
        f'"input": {{按照输入契约填写}}, '
        f'"expectedSignals": [...], "mustInclude": [...], "mustAvoid": [...]}}\n\n'
        f'输出格式：{{"industry": "...", "cases": [...]}}'
    )

    if dry_run:
        print(f"\n--- DRY RUN: {lobster_id} / {industry} / golden-cases ---")
        return {"_dry_run": True}

    print(f"  🤖 Calling LLM for {lobster_id}/{industry}/golden-cases...")
    raw = _call_llm(user_msg, system=system_msg, model=model, base_url=base_url, api_key=api_key)
    return _parse_json_from_llm(raw)


def save_pack(lobster_id: str, industry: str, pack_type: str, data: dict[str, Any]) -> Path:
    """Save knowledge pack to disk."""
    industry_slug = industry.replace("/", "_").replace(" ", "_")
    out_dir = OUTPUT_DIR / lobster_id / industry_slug
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{pack_type}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return out_path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Generate lobster knowledge packs via LLM")
    parser.add_argument("--lobster", default="all", help="Lobster ID or 'all'")
    parser.add_argument("--industries", default=None, help="Comma-separated industry list")
    parser.add_argument("--dry-run", action="store_true", help="Print prompts without calling LLM")
    parser.add_argument("--pack-types", default="industry_rules,hooks,scoring,golden_cases",
                        help="Comma-separated pack types")
    args = parser.parse_args()

    # Config
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").strip()
    model = os.getenv("OPENAI_MODEL", "gpt-4o").strip()

    if not api_key and not args.dry_run:
        print("❌ OPENAI_API_KEY not set. Use --dry-run to preview prompts.")
        sys.exit(1)

    # Lobsters
    lobster_ids = ALL_LOBSTER_IDS if args.lobster == "all" else [args.lobster]
    for lid in lobster_ids:
        if lid not in ALL_LOBSTER_IDS:
            print(f"❌ Unknown lobster: {lid}")
            sys.exit(1)

    # Industries
    industries = DEFAULT_INDUSTRIES
    if args.industries:
        industries = [x.strip() for x in args.industries.split(",") if x.strip()]

    # Pack types
    pack_types = [x.strip() for x in args.pack_types.split(",") if x.strip()]

    # Stats
    total_calls = 0
    total_saved = 0
    start_time = time.time()

    print("=" * 60)
    print(f"🦞 龙虾知识包填充脚本")
    print(f"   龙虾: {', '.join(lobster_ids)}")
    print(f"   行业: {', '.join(industries)}")
    print(f"   包类型: {', '.join(pack_types)}")
    print(f"   模型: {model}")
    print(f"   API: {base_url}")
    print(f"   Dry Run: {args.dry_run}")
    est_calls = len(lobster_ids) * len(industries) * len(pack_types)
    print(f"   预估调用次数: {est_calls}")
    print("=" * 60)

    for lobster_id in lobster_ids:
        print(f"\n🦞 === {lobster_id.upper()} ===")

        try:
            role_card = load_role_card(lobster_id)
            system_prompt = load_system_prompt(lobster_id)
            existing_golden = load_existing_golden_cases(lobster_id)
        except FileNotFoundError as e:
            print(f"  ⚠️ Skipping {lobster_id}: {e}")
            continue

        print(f"  ✅ Loaded role-card: {role_card.get('zhName', '')} / {role_card.get('mission', '')[:60]}...")

        for industry in industries:
            print(f"\n  📦 Industry: {industry}")

            for pack_type in pack_types:
                if pack_type == "golden_cases":
                    # Special handling for golden cases
                    result = generate_expanded_golden_cases(
                        lobster_id, industry,
                        role_card=role_card,
                        system_prompt=system_prompt,
                        existing_cases=existing_golden,
                        model=model, base_url=base_url, api_key=api_key,
                        dry_run=args.dry_run,
                    )
                else:
                    result = generate_knowledge_pack(
                        lobster_id, industry, pack_type,
                        role_card=role_card,
                        system_prompt=system_prompt,
                        model=model, base_url=base_url, api_key=api_key,
                        dry_run=args.dry_run,
                    )

                total_calls += 1

                if not args.dry_run:
                    path = save_pack(lobster_id, industry, pack_type, result)
                    total_saved += 1
                    print(f"    ✅ Saved: {path.relative_to(REPO_ROOT)}")

                    # Rate limiting: 1 second between calls
                    time.sleep(1)

    elapsed = time.time() - start_time
    print("\n" + "=" * 60)
    print(f"🏁 完成!")
    print(f"   总调用次数: {total_calls}")
    print(f"   总保存文件: {total_saved}")
    print(f"   耗时: {elapsed:.1f}秒")
    print(f"   输出目录: {OUTPUT_DIR.relative_to(REPO_ROOT)}")

    if total_calls >= est_calls:
        print(f"\n⚠️  算力已消耗完毕 — 共 {total_calls} 次 LLM 调用")
        print(f"   请检查你的 API 用量！")

    print("=" * 60)


if __name__ == "__main__":
    main()
