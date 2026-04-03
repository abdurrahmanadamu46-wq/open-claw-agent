from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import unittest
from pathlib import Path

from langgraph.graph import StateGraph


PROJECT_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PROJECT_ROOT.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from commander_graph_builder import DynamicGraphBuilder
from commander_router import clear_strategy_intensity_manager_cache
from commander_router import CommanderRouter
from commander_router import get_strategy_intensity_manager


def _run(coro):
    return asyncio.run(coro)


def _ctx(**overrides):
    base = {
        "industry": "medical_health",
        "platform": "douyin",
        "budget_level": "medium",
        "urgency": "normal",
        "existing_content": False,
        "has_leads": False,
        "user_id": "test-user",
        "tenant_id": "tenant-test",
    }
    base.update(overrides)
    return base


class CommanderRouterTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        os.environ["POLICY_BANDIT_DB_PATH"] = str(Path(self.tmpdir.name) / "policy_bandit.sqlite")
        os.environ["POLICY_BANDIT_ENABLED"] = "false"
        os.environ["STRATEGY_INTENSITY_STATE_PATH"] = str(Path(self.tmpdir.name) / "strategy_intensity_state.json")
        clear_strategy_intensity_manager_cache()
        self.router = CommanderRouter()

    def tearDown(self) -> None:
        self.tmpdir.cleanup()
        os.environ.pop("POLICY_BANDIT_DB_PATH", None)
        os.environ.pop("POLICY_BANDIT_ENABLED", None)
        os.environ.pop("STRATEGY_INTENSITY_STATE_PATH", None)
        clear_strategy_intensity_manager_cache()

    def test_content_production_goal_selects_content_subset(self) -> None:
        plan = _run(
            self.router.route(
                "help me create a douyin dental clinic video content campaign and prepare publishing",
                _ctx(),
            )
        )

        self.assertIn(
            plan.workflow_id,
            {"wf_topic_scoring", "wf_copy_compliance", "wf_visual_production", "wf_edge_publish"},
        )
        self.assertEqual(
            plan.lobster_sequence,
            ["radar", "strategist", "inkwriter", "visualizer", "dispatcher"],
        )
        self.assertIn(("inkwriter", "visualizer"), plan.parallelizable)
        self.assertIn("publish_external", plan.approval_required)
        self.assertIn("echoer", plan.skip_lobsters)

    def test_lead_acquisition_goal_selects_lead_subset(self) -> None:
        plan = _run(
            self.router.route(
                "help me capture more leads from comments and dm for a dental clinic",
                _ctx(existing_content=True),
            )
        )

        self.assertIn(plan.workflow_id, {"wf_edge_inbox", "wf_interaction_triage", "wf_lead_scoring"})
        self.assertEqual(plan.lobster_sequence, ["echoer", "catcher", "abacus", "followup"])
        self.assertIn(("echoer", "catcher"), plan.parallelizable)
        self.assertIn("radar", plan.skip_lobsters)

    def test_emergency_complaint_routes_to_guard_flow(self) -> None:
        plan = _run(
            self.router.route(
                "customer complaint in dm, handle urgently and contain risk",
                _ctx(urgency="high"),
            )
        )

        self.assertEqual(plan.workflow_id, "wf_complaint_guard")
        self.assertEqual(plan.lobster_sequence, ["echoer", "catcher", "followup"])
        self.assertIn("outbound_call", plan.approval_required)
        self.assertEqual(plan.risk_level, "high")

    def test_empty_goal_degrades_to_signal_scan(self) -> None:
        plan = _run(self.router.route("", _ctx()))

        self.assertEqual(plan.workflow_id, "wf_signal_scan")
        self.assertEqual(plan.lobster_sequence, ["radar", "strategist"])
        self.assertEqual(plan.fallback_mode, "empty_goal")
        self.assertEqual(plan.strategy_intensity.get("current_level"), 1)

    def test_industry_context_can_pull_followup_in_for_education(self) -> None:
        education_plan = _run(
            self.router.route(
                "help me capture more course consultation leads from comments and dm",
                _ctx(industry="education_training", has_leads=False, urgency="high", existing_content=True),
            )
        )
        restaurant_plan = _run(
            self.router.route(
                "help me capture more restaurant leads from comments and dm",
                _ctx(industry="restaurant", has_leads=False, urgency="normal", existing_content=True),
            )
        )

        self.assertIn("followup", education_plan.lobster_sequence)
        self.assertNotIn("followup", restaurant_plan.lobster_sequence)

    def test_dynamic_graph_builder_keeps_governance_and_selected_lobsters(self) -> None:
        plan = _run(
            self.router.route(
                "help me create a douyin dental clinic video content campaign and prepare publishing",
                _ctx(),
            )
        )

        async def _noop(_state):
            return {}

        registry = {
            name: _noop
            for name in [
                "radar",
                "strategist",
                "inkwriter",
                "visualizer",
                "dispatcher",
                "echoer",
                "catcher",
                "abacus",
                "followup",
                "constitutional_guardian_node",
                "verification_gate_node",
                "memory_governor_node",
                "human_approval_gate_preflight",
                "human_approval_gate_after_dispatcher",
                "human_approval_gate_after_abacus",
                "human_approval_gate_after_catcher",
                "human_approval_gate_after_followup",
                "feedback",
                "self_improving_loop",
            ]
        }

        graph = DynamicGraphBuilder(node_registry=registry).build(plan)
        self.assertIsInstance(graph, StateGraph)
        node_names = set(graph.nodes.keys())
        self.assertTrue(
            {"constitutional_guardian_node", "verification_gate_node", "memory_governor_node"}
            <= node_names
        )
        self.assertTrue({"radar", "strategist", "inkwriter", "visualizer", "dispatcher"} <= node_names)
        self.assertNotIn("echoer", node_names)

    def test_strategy_intensity_manager_supports_escalation_and_manual_l4_gate(self) -> None:
        manager = get_strategy_intensity_manager("tenant-intensity-test")

        self.assertEqual(manager.current_level, 1)
        self.assertFalse(manager.requires_approval())
        self.assertTrue(manager.escalate(reason="to_l2"))
        self.assertEqual(manager.current_level, 2)
        self.assertTrue(manager.escalate(reason="to_l3"))
        self.assertEqual(manager.current_level, 3)
        self.assertFalse(manager.escalate(reason="auto_to_l4"))
        self.assertEqual(manager.last_transition_error, "l4_requires_manual_enable")
        self.assertTrue(manager.escalate(manual=True, reason="manual_to_l4"))
        self.assertEqual(manager.current_level, 4)
        self.assertTrue(manager.deescalate(reason="back_to_l3"))
        self.assertEqual(manager.current_level, 3)
        self.assertTrue(manager.requires_approval())

    def test_route_reasons_include_strategy_intensity_context(self) -> None:
        manager = get_strategy_intensity_manager("tenant-escalated")
        self.assertTrue(manager.escalate(reason="l2"))

        plan = _run(
            self.router.route(
                "help me capture more leads from comments and dm for a dental clinic",
                _ctx(existing_content=True, tenant_id="tenant-escalated"),
            )
        )

        self.assertTrue(any(reason.startswith("strategy_intensity=") for reason in plan.reasons))
        self.assertEqual(plan.strategy_intensity.get("current_level"), 2)

    def test_strategy_intensity_history_records_transitions(self) -> None:
        manager = get_strategy_intensity_manager("tenant-history-test")

        self.assertTrue(manager.escalate(manual=True, updated_by="tester", reason="promote", lobster_id="radar"))
        self.assertTrue(manager.deescalate(updated_by="tester", reason="rollback", lobster_id="radar"))

        history = manager.get_history(lobster_id="radar", days=7, limit=20)
        self.assertGreaterEqual(len(history), 2)
        self.assertEqual(history[0]["lobster_id"], "radar")
        self.assertIn(history[0]["new_level"], {1, 2, 3, 4})
        self.assertEqual(history[0]["triggered_by"], "tester")


if __name__ == "__main__":
    unittest.main(verbosity=2)
