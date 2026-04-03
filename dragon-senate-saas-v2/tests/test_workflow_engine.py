"""Tests for workflow_engine and workflow fresh-context integration."""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lobster_runner import LobsterRunSpec  # noqa: E402
from lobster_runner import LobsterRunner  # noqa: E402
import tenant_concurrency  # noqa: E402
from workflow_engine import WorkflowEngine  # noqa: E402
from workflow_engine import StepStatus  # noqa: E402
from workflow_engine import load_workflow  # noqa: E402
from workflow_engine import render_template  # noqa: E402


class FakeLobster:
    def __init__(self, role_id: str, tenant_id: str = "tenant-test") -> None:
        self.role_id = role_id
        self.tenant_id = tenant_id
        self.display_name = role_id
        self.system_prompt_full = f"You are {role_id}."
        self.working = {}
        self.agents_rules = ""
        self.heartbeat = {"on_wake": []}

    def bind_runtime_context(self, tenant_id: str) -> None:
        self.tenant_id = tenant_id


class FakeRunner:
    def __init__(self, responses: list[str]) -> None:
        self.responses = list(responses)
        self.calls: list[LobsterRunSpec] = []

    async def run(self, spec: LobsterRunSpec):
        self.calls.append(spec)
        if not self.responses:
            content = "STATUS: done"
        else:
            content = self.responses.pop(0)
        return SimpleNamespace(
            final_content=content,
            error=None,
            stop_reason="completed",
        )


class CapturingRouter:
    def __init__(self, response: str = "STATUS: done") -> None:
        self.response = response
        self.calls: list[dict[str, str]] = []

    async def routed_ainvoke_text(self, *, system_prompt, user_prompt, meta=None, temperature=None, model_override=None, force_tier=None):
        self.calls.append(
            {
                "system_prompt": system_prompt,
                "user_prompt": user_prompt,
            }
        )
        return self.response


class WorkflowEngineTestCase(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.root = Path(self.tmpdir.name)
        self.workflows_dir = self.root / "workflows"
        self.workflows_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.root / "workflow.sqlite"
        os.environ["TENANT_CONCURRENCY_DB_PATH"] = str(self.root / "tenant_concurrency.sqlite")
        tenant_concurrency._manager = None  # type: ignore[attr-defined]
        os.environ["MEMORY_COMPRESSION_ENABLED"] = "false"
        os.environ["LOBSTER_FILE_MEMORY_ENABLED"] = "false"
        os.environ["LOBSTER_MEMORY_AUTO_EXTRACT"] = "false"

    def _write_workflow(self, name: str, body: str) -> None:
        (self.workflows_dir / f"{name}.yaml").write_text(textwrap.dedent(body).strip() + "\n", encoding="utf-8")

    async def test_render_template_supports_nested_fields(self) -> None:
        rendered = render_template(
            "任务：{{task}}\n平台：{{platform.name}}\n上一步：{{steps.strategy.output}}",
            {
                "task": "618 活动",
                "platform": {"name": "小红书"},
                "steps": {"strategy": {"output": "STATUS: done\n方向：种草"}},
            },
        )
        self.assertIn("618 活动", rendered)
        self.assertIn("小红书", rendered)
        self.assertIn("方向：种草", rendered)

    async def test_load_seeded_workflow(self) -> None:
        workflow = load_workflow("content-campaign", workflows_dir=Path(__file__).resolve().parent.parent / "workflows")
        self.assertEqual(workflow.workflow_id, "content-campaign")
        self.assertGreaterEqual(len(workflow.steps), 4)
        self.assertEqual(workflow.steps[0].step_type, "debate_judge")
        self.assertEqual(workflow.steps[1].step_type, "ccv_loop")

    async def test_engine_can_run_single_step_workflow(self) -> None:
        self._write_workflow(
            "single-pass",
            """
            id: single-pass
            name: 单步测试
            steps:
              - id: summarize
                agent: radar
                type: single
                input: |
                  任务：{{task}}
                  完成后输出 STATUS: done
                expects: "STATUS: done"
                max_retries: 0
            """,
        )
        engine = WorkflowEngine(
            db_path=str(self.db_path),
            workflows_dir=self.workflows_dir,
            runner=FakeRunner(["STATUS: done\nSUMMARY: ok"]),
            runtime_lobster_factory=lambda role_id, tenant_id: FakeLobster(role_id, tenant_id),
        )

        run_id = await engine.start_run(tenant_id="tenant-a", workflow_id="single-pass", task="生成摘要")
        await asyncio.sleep(0.05)
        status = await engine.get_run_status(run_id)

        self.assertEqual(status["status"], "done")
        self.assertEqual(status["steps"][0]["status"], "done")
        self.assertIn("SUMMARY: ok", status["steps"][0]["output_preview"])

    async def test_engine_pauses_and_can_resume(self) -> None:
        self._write_workflow(
            "retry-once",
            """
            id: retry-once
            name: 重试后恢复
            steps:
              - id: summarize
                agent: radar
                type: single
                input: |
                  任务：{{task}}
                  完成后输出 STATUS: done
                expects: "STATUS: done"
                max_retries: 0
            """,
        )
        runner = FakeRunner(["没有状态", "STATUS: done\nSUMMARY: fixed"])
        engine = WorkflowEngine(
            db_path=str(self.db_path),
            workflows_dir=self.workflows_dir,
            runner=runner,
            runtime_lobster_factory=lambda role_id, tenant_id: FakeLobster(role_id, tenant_id),
        )

        run_id = await engine.start_run(tenant_id="tenant-a", workflow_id="retry-once", task="恢复测试")
        await asyncio.sleep(0.2)
        paused = await engine.get_run_status(run_id)
        self.assertEqual(paused["status"], "paused")
        self.assertEqual(paused["steps"][0]["status"], StepStatus.FAILED.value)

        resumed = await engine.resume_run(run_id)
        self.assertTrue(resumed)
        await asyncio.sleep(0.2)
        final = await engine.get_run_status(run_id)
        self.assertEqual(final["status"], "done")
        self.assertEqual(final["steps"][0]["status"], "done")

    async def test_engine_creates_loop_stories(self) -> None:
        self._write_workflow(
            "loop-pass",
            """
            id: loop-pass
            name: 循环测试
            steps:
              - id: content_plan
                agent: visualizer
                type: loop
                loop_over: platforms
                input: |
                  平台：{{platform.name}}
                  完成后输出 STATUS: done
                expects: "STATUS: done"
                max_retries: 0
            """,
        )
        runner = FakeRunner(["STATUS: done\nA", "STATUS: done\nB"])
        engine = WorkflowEngine(
            db_path=str(self.db_path),
            workflows_dir=self.workflows_dir,
            runner=runner,
            runtime_lobster_factory=lambda role_id, tenant_id: FakeLobster(role_id, tenant_id),
        )

        run_id = await engine.start_run(
            tenant_id="tenant-a",
            workflow_id="loop-pass",
            task="循环生成",
            context={"platforms": [{"name": "小红书"}, {"name": "抖音"}]},
        )
        await asyncio.sleep(0.05)
        status = await engine.get_run_status(run_id)

        self.assertEqual(status["status"], "done")
        self.assertEqual(len(status["steps"][0]["stories"]), 2)
        self.assertTrue(all(item["status"] == "done" for item in status["steps"][0]["stories"]))

    async def test_engine_runs_ccv_loop_step(self) -> None:
        self._write_workflow(
            "ccv-pass",
            """
            id: ccv-pass
            name: CCV 测试
            agents:
              - id: inkwriter
                lobster: inkwriter
              - id: echoer
                lobster: echoer
            steps:
              - id: reviewed_copy
                agent: inkwriter
                type: ccv_loop
                action_lobster: inkwriter
                critique_lobsters:
                  - lobster: echoer
                    focus: "互动友好度"
                max_rounds: 2
                approval_signal: "APPROVED"
                input: |
                  输出一份文案，必须包含 STATUS: done
                expects: "STATUS: done"
                max_retries: 0
            """,
        )
        runner = FakeRunner(
            [
                "STATUS: done\n初稿版本",
                "需要补一条互动引导",
                "STATUS: done\n修正版文案",
                "APPROVED\n通过",
            ]
        )
        engine = WorkflowEngine(
            db_path=str(self.db_path),
            workflows_dir=self.workflows_dir,
            runner=runner,
            runtime_lobster_factory=lambda role_id, tenant_id: FakeLobster(role_id, tenant_id),
        )

        run_id = await engine.start_run(tenant_id="tenant-a", workflow_id="ccv-pass", task="生成文案")
        await asyncio.sleep(0.1)
        status = await engine.get_run_status(run_id)
        self.assertEqual(status["status"], "done")
        details = status["steps"][0]["output_json"]
        self.assertEqual(details["mode"], "ccv_loop")
        self.assertEqual(len(details["rounds"]), 2)
        self.assertTrue(details["rounds"][-1]["approved"])

    async def test_engine_runs_debate_judge_step(self) -> None:
        self._write_workflow(
            "debate-pass",
            """
            id: debate-pass
            name: Debate 测试
            agents:
              - id: strategist
                lobster: strategist
              - id: commander
                lobster: commander
            steps:
              - id: strategy_duel
                agent: strategist
                type: debate_judge
                proposer: strategist
                judge: commander
                debate_rounds: 1
                judge_prompt: "选出更优方案并给出最终结论。"
                input: |
                  输出策略方案，必须包含 STATUS: done
                expects: "STATUS: done"
                max_retries: 0
            """,
        )
        runner = FakeRunner(
            [
                "STATUS: done\n方案A",
                "STATUS: done\n方案B",
                "A 的缺点在于执行成本高",
                "B 的缺点在于转化钩子弱",
                "STATUS: done\nCommander 裁决：选 A",
            ]
        )
        engine = WorkflowEngine(
            db_path=str(self.db_path),
            workflows_dir=self.workflows_dir,
            runner=runner,
            runtime_lobster_factory=lambda role_id, tenant_id: FakeLobster(role_id, tenant_id),
        )

        run_id = await engine.start_run(tenant_id="tenant-a", workflow_id="debate-pass", task="生成策略")
        await asyncio.sleep(0.1)
        status = await engine.get_run_status(run_id)
        self.assertEqual(status["status"], "done")
        details = status["steps"][0]["output_json"]
        self.assertEqual(details["mode"], "debate_judge")
        self.assertIn("proposal_a", details)
        self.assertIn("proposal_b", details)
        self.assertIn("judge_output", details)

    async def test_workflow_context_industry_is_forwarded_into_lobster_prompt(self) -> None:
        self._write_workflow(
            "industry-pass",
            """
            id: industry-pass
            name: 行业知识注入测试
            steps:
              - id: summarize
                agent: radar
                type: single
                input: |
                  任务：{{task}}
                  完成后输出 STATUS: done
                expects: "STATUS: done"
                max_retries: 0
            """,
        )
        router = CapturingRouter("STATUS: done\nSUMMARY: ok")
        runner = LobsterRunner(router)
        engine = WorkflowEngine(
            db_path=str(self.db_path),
            workflows_dir=self.workflows_dir,
            runner=runner,
            runtime_lobster_factory=lambda role_id, tenant_id: FakeLobster(role_id, tenant_id),
        )

        async def fake_memory_context(self, lobster_obj, spec):  # noqa: ARG001
            return ""

        with patch.object(LobsterRunner, "_build_lobster_memory_context", fake_memory_context), patch.object(
            LobsterRunner,
            "_resolve_session_context",
            return_value=(SimpleNamespace(session_id="session-1"), []),
        ), patch("lobster_bootstrap.check_bootstrap_status", return_value=True), patch(
            "lobster_bootstrap.get_bootstrap_data",
            return_value={},
        ), patch.object(
            LobsterRunner,
            "_resolve_strategy_intensity_manager",
            return_value=None,
        ), patch.object(
            LobsterRunner,
            "_resolve_autonomy_policy",
            return_value=None,
        ), patch.object(
            LobsterRunner,
            "_resolve_task_resolution",
            new=AsyncMock(return_value=(None, None)),
        ), patch("feature_flags.ff_is_enabled", return_value=True), patch(
            "feature_flags.is_lobster_enabled",
            return_value=True,
        ), patch.object(LobsterRunner, "_update_working_started", return_value=None), patch.object(
            LobsterRunner,
            "_update_working_completed",
            return_value=None,
        ), patch.object(LobsterRunner, "_update_working_failed", return_value=None), patch.object(
            LobsterRunner,
            "_persist_session_messages",
            return_value=None,
        ):
            run_id = await engine.start_run(
                tenant_id="tenant-a",
                workflow_id="industry-pass",
                task="输出餐饮行业策略摘要",
                context={"industry_tag": "餐饮服务_中餐馆"},
            )
            await asyncio.sleep(0.05)
            status = await engine.get_run_status(run_id)

        self.assertEqual(status["status"], "done")
        self.assertGreaterEqual(len(router.calls), 1)
        self.assertTrue(
            any("## 行业专属规则（餐饮服务_中餐馆）" in call["system_prompt"] for call in router.calls)
        )


class FreshContextTestCase(unittest.IsolatedAsyncioTestCase):
    async def test_runner_skips_session_history_when_fresh_context_enabled(self) -> None:
        os.environ["MEMORY_COMPRESSION_ENABLED"] = "false"
        os.environ["LOBSTER_FILE_MEMORY_ENABLED"] = "false"
        os.environ["LOBSTER_MEMORY_AUTO_EXTRACT"] = "false"

        router = CapturingRouter("STATUS: done")
        runner = LobsterRunner(router)
        lobster = FakeLobster("radar")

        async def fake_memory_context(self, lobster_obj, spec):  # noqa: ARG001
            return "## Recalled Memory\n不应该出现"

        with patch.object(LobsterRunner, "_build_lobster_memory_context", fake_memory_context), patch.object(
            LobsterRunner,
            "_resolve_session_context",
            return_value=(SimpleNamespace(session_id="session-1"), [{"role": "assistant", "content": "历史消息"}]),
        ), patch.object(
            LobsterRunner,
            "_resolve_strategy_intensity_manager",
            return_value=None,
        ), patch.object(
            LobsterRunner,
            "_resolve_autonomy_policy",
            return_value=None,
        ), patch.object(
            LobsterRunner,
            "_resolve_task_resolution",
            new=AsyncMock(return_value=(None, None)),
        ), patch("feature_flags.ff_is_enabled", return_value=True), patch(
            "feature_flags.is_lobster_enabled",
            return_value=True,
        ), patch.object(LobsterRunner, "_update_working_started", return_value=None), patch.object(
            LobsterRunner,
            "_update_working_completed",
            return_value=None,
        ), patch.object(LobsterRunner, "_update_working_failed", return_value=None), patch.object(
            LobsterRunner,
            "_persist_session_messages",
            return_value=None,
        ):
            result = await runner.run(
                LobsterRunSpec(
                    role_id="radar",
                    system_prompt="system",
                    user_prompt="只看这一步输入",
                    lobster=lobster,
                    fresh_context=True,
                    meta={"tenant_id": "tenant-a", "task_id": "task-1", "approved": True},
                )
            )

        self.assertEqual(result.stop_reason, "completed")
        self.assertGreaterEqual(len(router.calls), 1)
        self.assertIn("只看这一步输入", router.calls[-1]["user_prompt"])
        self.assertNotIn("历史消息", router.calls[-1]["user_prompt"])
        self.assertNotIn("不应该出现", router.calls[-1]["user_prompt"])


if __name__ == "__main__":
    unittest.main()
