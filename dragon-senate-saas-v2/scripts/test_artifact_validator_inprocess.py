from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from artifact_validator import validate_execution_plan
from artifact_validator import validate_followup_action_plan
from artifact_validator import validate_lead_assessment
from artifact_validator import validate_mission_plan
from artifact_validator import validate_copy_pack
from artifact_validator import validate_signal_brief
from artifact_validator import validate_storyboard_pack
from artifact_validator import validate_strategy_route
from artifact_validator import validate_value_score_card


def main() -> None:
    mission = {
        "mission_type": "growth_campaign",
        "objective": "提升高意向客户预约率",
        "selected_lineup": ["radar", "strategist", "catcher", "followup"],
        "budget_plan": {
            "token_budget": 200000,
            "tool_budget": 300,
            "latency_budget_sec": 600,
        },
        "risk_gate_plan": {
            "approval_required_for": ["outbound_call", "bulk_message"],
            "max_risk_level_without_approval": "L1",
        },
        "stop_loss_rule": {
            "max_retry": 2,
            "max_budget_overrun_ratio": 1.2,
            "kill_on_repeated_failure": True,
        },
    }
    execution = {
        "execution_goal": "完成内容制作并发起首轮线索承接",
        "task_graph": [{"task_id": "t1"}],
        "retry_policy": {"max_retry": 2, "backoff_seconds": 30},
        "fallback_plan": {"on_failure": "manual_fallback"},
        "approval_checkpoints": [{"checkpoint_id": "ap1"}],
        "trace": {"trace_id": "tr_001", "idempotency_key": "exec_tr_001"},
    }
    lead = {
        "lead_id": "lead_001",
        "source_channel": "douyin_private_message",
        "intent_score": 0.86,
        "fit_score": 0.79,
        "risk_score": 0.22,
        "lead_tier": "A",
        "reason_codes": ["主动咨询价格"],
    }
    strategy = {
        "primary_route": {"route_id": "route_a"},
        "priority_order": ["内容可信度", "高意向响应速度"],
        "resource_estimate": {"estimated_cost": 180},
        "risk_tradeoff": {"main_risks": ["平台审核"]},
    }
    copy_pack = {
        "copy_goal": "提升转私信率",
        "core_message": "真实案例 + 清晰流程",
        "hooks": ["为什么很多商家内容做了却没有线索？"],
        "script_body": [{"section": "opening", "text": "先抛出问题"}],
        "cta": ["私信领取诊断"],
        "risk_phrases": ["保证成交"],
    }
    storyboard = {
        "visual_goal": "提升点击率和可信感",
        "cover_direction": {"headline_style": "问题式"},
        "shot_list": [{"shot_id": "s1"}],
        "asset_dependencies": ["品牌Logo"],
        "execution_feasibility_score": 0.87,
    }
    value_card = {
        "subject_type": "lead",
        "subject_id": "lead_001",
        "short_term_score": 0.83,
        "long_term_score": 0.67,
        "roi_estimate": {"expected_value": 4200},
        "reward_signal": {"reward_type": "positive_followup_priority"},
    }
    followup = {
        "lead_id": "lead_001",
        "followup_stage": "appointment_push",
        "contact_plan": [{"step": 1, "channel": "private_message"}],
        "cadence_rule": {"max_touch_per_day": 1},
        "approval_requirements": [{"action": "phone_call", "required": True}],
        "success_signal": ["确认预约时间"],
    }
    signal_brief = {
        "scan_scope": "本地生活短视频平台",
        "time_window": "last_7_days",
        "top_signals": [
            {
                "signal_id": "sig_001",
                "category": "platform_rule_change",
                "summary": "平台加强敏感承诺类内容审核",
                "impact_level": "high",
                "source_reliability": 0.91,
            }
        ],
        "recommended_attention_level": "high",
    }

    validate_mission_plan(mission)
    validate_execution_plan(execution)
    validate_lead_assessment(lead)
    validate_signal_brief(signal_brief)
    validate_strategy_route(strategy)
    validate_copy_pack(copy_pack)
    validate_storyboard_pack(storyboard)
    validate_value_score_card(value_card)
    validate_followup_action_plan(followup)
    print("artifact_validator ok")


if __name__ == "__main__":
    main()
