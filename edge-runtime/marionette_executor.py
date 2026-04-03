from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import random
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

from bbp_kernel import HumanMouseMimic
from account_health_monitor import AccountHealthMonitor
from browser_use_planner import BrowserUsePlanner
from browser_engine import BrowserEngine
from content_publisher import ContentPublisher
from context_navigator import ContextNavigator
from edge_telemetry import get_tracer
from execution_snapshot import SnapshotCollector
from feature_flag_proxy import EdgeFlagContext, edge_ff_is_enabled
from memory_store import EdgeMemoryStore
from telemetry_buffer import EdgeTelemetryBuffer, TelemetryEvent

logger = logging.getLogger(__name__)


class StepResult:
    __slots__ = ("step_id", "action", "success", "duration_ms", "error", "data")

    def __init__(self, step_id: str, action: str, success: bool = True, duration_ms: int = 0, error: str = "", data: Optional[dict[str, Any]] = None):
        self.step_id = step_id
        self.action = action
        self.success = success
        self.duration_ms = duration_ms
        self.error = error
        self.data = data or {}

    def as_dict(self) -> dict[str, Any]:
        return {
            "step_id": self.step_id,
            "action": self.action,
            "success": self.success,
            "duration_ms": self.duration_ms,
            "error": self.error,
            "data": self.data,
        }


class StagehandSession:
    PLATFORM_RISK = {
        "xiaohongshu": "HIGH",
        "douyin": "HIGH",
        "weibo": "MEDIUM",
        "wechat": "HIGH",
        "default": "LOW",
    }

    def __init__(self) -> None:
        self.stagehand: Any = None
        self.page: Any = None
        self.account_id = ""
        self.platform = ""
        self._ctx_manager: Any = None
        self.use_camoufox = False
        self.browser_backend = ""
        self.risk_level = "LOW"

    @classmethod
    def select_browser_strategy(cls, platform: str) -> str:
        risk = cls.PLATFORM_RISK.get(str(platform or "").strip(), cls.PLATFORM_RISK["default"])
        return "camoufox" if risk == "HIGH" else "stagehand"

    @classmethod
    async def create(cls, account_id: str, platform: str) -> "StagehandSession":
        session = cls()
        session.account_id = str(account_id or "default").strip() or "default"
        session.platform = str(platform or "generic").strip() or "generic"
        session.risk_level = cls.PLATFORM_RISK.get(session.platform, cls.PLATFORM_RISK["default"])
        profile_dir = Path.home() / ".openclaw" / "browser_profiles" / session.account_id
        profile_dir.mkdir(parents=True, exist_ok=True)
        strategy = cls.select_browser_strategy(session.platform)
        if strategy == "camoufox":
            engine = BrowserEngine(
                headless=str(os.getenv("BROWSER_HEADLESS", "true")).strip().lower() in {"1", "true", "yes", "on"},
                proxy=os.getenv("BROWSER_PROXY", "").strip() or None,
            )
            manager = engine.new_context(
                profile_dir=str(profile_dir),
                prefer_camoufox=True,
                humanize=True,
                geoip=True,
                headless_mode="virtual",
            )
            session.page = await manager.__aenter__()
            session._ctx_manager = manager
            session.use_camoufox = True
            session.browser_backend = str(getattr(session.page, "_browser_backend", "camoufox"))
        else:
            try:  # pragma: no cover
                from stagehand import Stagehand, StagehandConfig  # type: ignore

                config = StagehandConfig(
                    env="LOCAL",
                    model_name=os.getenv("STAGEHAND_MODEL_NAME", "claude-sonnet-4-5"),
                    model_api_key=os.getenv("ANTHROPIC_API_KEY", "").strip() or None,
                    headless=str(os.getenv("BROWSER_HEADLESS", "true")).strip().lower() in {"1", "true", "yes", "on"},
                    verbose=1,
                    user_data_dir=str(profile_dir),
                )
                stagehand = Stagehand(config=config)
                await stagehand.init()
                session.stagehand = stagehand
                session.page = stagehand.page
                session.browser_backend = "stagehand"
            except Exception:
                engine = BrowserEngine(
                    headless=str(os.getenv("BROWSER_HEADLESS", "true")).strip().lower() in {"1", "true", "yes", "on"},
                    proxy=os.getenv("BROWSER_PROXY", "").strip() or None,
                )
                manager = engine.new_context(profile_dir=str(profile_dir), prefer_camoufox=False)
                session.page = await manager.__aenter__()
                session._ctx_manager = manager
                session.browser_backend = str(getattr(session.page, "_browser_backend", "playwright_firefox"))
        await session._restore_cookies()
        return session

    async def act(self, instruction: str) -> None:
        if self.stagehand is not None:  # pragma: no cover
            await self.stagehand.act(instruction)
            return
        text = str(instruction or "").strip()
        if not text:
            return
        if text.startswith("点击"):
            target = text.replace("点击", "").replace("按钮", "").replace("后", "").strip(" ：:")
            for selector in [f'button:has-text("{target}")', f'text="{target}"', '[role="button"]']:
                try:
                    await self.page.locator(selector).first.click(timeout=3000)
                    return
                except Exception:
                    continue
            raise RuntimeError(f"click_target_not_found:{target}")
        if "输入" in text:
            value = text.split(":", 1)[1].strip() if ":" in text else (text.split("：", 1)[1].strip() if "：" in text else "")
            selectors = ["textarea", "input", '[contenteditable="true"]']
            if "标题" in text:
                selectors = ['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]', *selectors]
            for selector in selectors:
                try:
                    locator = self.page.locator(selector).first
                    await locator.click(timeout=3000)
                    await locator.fill(value)
                    return
                except Exception:
                    continue
            raise RuntimeError(f"fill_target_not_found:{text}")
        if text.startswith("等待") or text.lower().startswith("wait"):
            await asyncio.sleep(1)
            return
        if "上传" in text:
            return
        raise RuntimeError(f"fallback_act_unsupported:{text}")

    async def extract(self, instruction: str, schema: dict[str, Any]) -> dict[str, Any]:
        if self.stagehand is not None:  # pragma: no cover
            from pydantic import create_model

            model = create_model("ExtractedData", **{k: (str, ...) for k in schema.keys()})
            result = await self.stagehand.extract(instruction, schema=model)
            return result.model_dump()
        current_url = str(getattr(self.page, "url", ""))
        payload: dict[str, Any] = {}
        for key in schema.keys():
            low = str(key).lower()
            if "url" in low or "link" in low:
                payload[key] = current_url
            elif low.endswith("_id") and current_url:
                payload[key] = current_url.rstrip("/").split("/")[-1]
            else:
                payload[key] = current_url or ""
        return payload

    async def observe(self, instruction: str) -> str:
        if self.stagehand is not None:  # pragma: no cover
            return str(await self.stagehand.observe(instruction))
        return json.dumps({"instruction": instruction, "url": str(getattr(self.page, "url", ""))}, ensure_ascii=False)

    async def screenshot(self) -> str:
        if self.page is None:
            return ""
        return base64.b64encode(await self.page.screenshot()).decode()

    async def save_cookies(self) -> None:
        if self.page is None or not hasattr(self.page, "context"):
            return
        try:
            cookies = await self.page.context.cookies()
            path = self._cookie_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(cookies, ensure_ascii=False), encoding="utf-8")
        except Exception:
            return

    async def close(self) -> None:
        await self.save_cookies()
        if self.stagehand is not None:  # pragma: no cover
            await self.stagehand.close()
            return
        if self._ctx_manager is not None:
            await self._ctx_manager.__aexit__(None, None, None)

    async def _restore_cookies(self) -> None:
        path = self._cookie_path()
        if self.page is None or not hasattr(self.page, "context") or not path.exists():
            return
        try:
            cookies = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(cookies, list) and cookies:
                await self.page.context.add_cookies(cookies)
        except Exception:
            return

    def _cookie_path(self) -> Path:
        return Path.home() / ".openclaw" / "cookies" / f"{self.account_id}_{self.platform}.json"


class MarionetteExecutor:
    def __init__(
        self,
        navigator: Optional[ContextNavigator] = None,
        mimic: Optional[HumanMouseMimic] = None,
        default_typing_cpm: int = 80,
        edge_node_id: str = "",
        tenant_id: str = "tenant_main",
        edge_node_tags: Optional[list[str]] = None,
        telemetry_buffer: Optional[EdgeTelemetryBuffer] = None,
        snapshot_uploader: Optional[Callable[[dict[str, Any]], Awaitable[Any]]] = None,
    ):
        self.navigator = navigator or ContextNavigator()
        self.mimic = mimic or HumanMouseMimic()
        self.default_typing_cpm = default_typing_cpm
        self._current_mouse_x = 960.0
        self._current_mouse_y = 540.0
        self.memory = EdgeMemoryStore()
        self.edge_node_id = edge_node_id
        self.tenant_id = str(tenant_id or "tenant_main").strip() or "tenant_main"
        self.edge_node_tags = list(edge_node_tags or [])
        self.telemetry = telemetry_buffer
        self._sessions: dict[str, StagehandSession] = {}
        self.health_monitor = AccountHealthMonitor()
        self.planner = BrowserUsePlanner()
        self.snapshot_collector = SnapshotCollector(
            node_id=self.edge_node_id or "edge_runtime",
            tenant_id=self.tenant_id,
            uploader=snapshot_uploader,
        )

    def set_snapshot_uploader(self, uploader: Callable[[dict[str, Any]], Awaitable[Any]] | None) -> None:
        self.snapshot_collector.uploader = uploader

    async def execute(self, sop_payload: dict[str, Any]) -> dict[str, Any]:
        sop_type = str(sop_payload.get("sop_type") or "unknown").strip() or "unknown"
        account_id = str(sop_payload.get("account_id") or "default").strip() or "default"
        platform = str(sop_payload.get("platform") or "generic").strip() or "generic"
        tenant_id = str(sop_payload.get("tenant_id") or sop_payload.get("tenantId") or self.tenant_id or "tenant_main").strip() or "tenant_main"
        variables = dict(sop_payload.get("variables") or {})
        attachments = sop_payload.get("attachments") or []
        steps = sop_payload.get("steps") or []
        if not steps:
            goal = str(sop_payload.get("goal") or sop_payload.get("instruction") or "").strip()
            if goal:
                steps = await self.planner.plan_task(goal, platform=platform)
        result: dict[str, Any] = {}
        screenshots: list[dict[str, Any]] = []
        execution_log: list[dict[str, Any]] = []
        started = datetime.now(timezone.utc).isoformat()
        session = await self._get_session(account_id, platform)
        self.snapshot_collector.tenant_id = tenant_id
        self.snapshot_collector.account_id = account_id
        self.snapshot_collector.platform = platform
        async with self.snapshot_collector.session(
            sop_type,
            str(sop_payload.get("task_id") or sop_payload.get("taskId") or "").strip() or None,
            metadata={"mode": "stagehand_sop", "step_count": len(steps)},
        ) as snap:
            await snap.capture_before(session.page)
            try:
                for index, raw_step in enumerate(steps):
                    step = self._interpolate(raw_step, variables)
                    action = str(step.get("action") or "").strip().lower()
                    step_started = time.perf_counter()
                    log = {"step": index + 1, "action": action, "instruction": str(step.get("instruction") or ""), "started_at": datetime.now(timezone.utc).isoformat()}
                    try:
                        if action == "navigate":
                            await session.page.goto(str(step.get("url") or "").strip(), wait_until="domcontentloaded")
                            log["result"] = "navigated"
                        elif action == "act":
                            await session.act(str(step.get("instruction") or ""))
                            log["result"] = "acted"
                        elif action == "extract":
                            extracted = await session.extract(str(step.get("instruction") or ""), dict(step.get("schema") or {}))
                            result.update(extracted)
                            log["extracted"] = extracted
                        elif action == "observe":
                            log["result"] = await session.observe(str(step.get("instruction") or ""))
                        elif action == "wait":
                            await asyncio.sleep(float(step.get("seconds") or 2))
                            log["result"] = "waited"
                        elif action == "screenshot":
                            shot = await session.screenshot()
                            log["screenshot"] = shot
                            screenshots.append({"step": index + 1, "data": shot})
                        elif action == "upload":
                            uploaded = await self._upload_files(session, self._resolve_attachments(step, variables, attachments))
                            log["result"] = f"uploaded:{uploaded}"
                        else:
                            raise RuntimeError(f"unsupported_stagehand_action:{action}")
                        health = await self.health_monitor.check_after_action(session, platform)
                        if not bool(health.get("healthy", True)):
                            log["health"] = health
                            raise RuntimeError(f"account_risk_detected:{','.join(health.get('risks') or [])}")
                        log["success"] = True
                        await snap.step(
                            action or f"step_{index + 1}",
                            session.page,
                            status="ok",
                            metadata={"instruction": log["instruction"], "result": log.get("result"), "step": index + 1},
                        )
                    except Exception as exc:  # noqa: BLE001
                        log["success"] = False
                        log["error"] = str(exc)
                        try:
                            shot = await session.screenshot()
                            log["screenshot"] = shot
                            screenshots.append({"step": "failure", "data": shot})
                        except Exception:
                            pass
                        await snap.step(
                            action or f"step_{index + 1}",
                            session.page,
                            status="error",
                            error_msg=str(exc),
                            metadata={"instruction": log["instruction"], "step": index + 1},
                        )
                        execution_log.append(self._finish_log(log, step_started))
                        raise
                    execution_log.append(self._finish_log(log, step_started))
                await session.save_cookies()
                await snap.capture_after(session.page)
                snap.mark_result(f"{sop_type} completed")
                return {"success": True, "sop_type": sop_type, "account_id": account_id, "result": result, "screenshots": screenshots[-3:], "execution_log": execution_log, "error": None, "started_at": started, "finished_at": datetime.now(timezone.utc).isoformat()}
            except Exception as exc:
                snap.snapshot.status = "failed"
                snap.snapshot.error_detail = str(exc)
                await snap.capture_after(session.page)
                snap.mark_result("failed")
                return {"success": False, "sop_type": sop_type, "account_id": account_id, "result": result, "screenshots": screenshots, "execution_log": execution_log, "error": str(exc), "started_at": started, "finished_at": datetime.now(timezone.utc).isoformat()}

    async def execute_packet(self, packet: dict[str, Any], page: Any = None) -> dict[str, Any]:
        tracer = get_tracer()
        total_start = time.perf_counter()
        protocol = str(packet.get("protocol") or "").strip()
        task_id = str(packet.get("taskId") or "").strip()
        tenant_id = str(packet.get("tenant_id") or packet.get("tenantId") or "tenant_main").strip() or "tenant_main"
        lobster_id = str(packet.get("lobster_id") or packet.get("lobsterId") or "edge_runtime").strip() or "edge_runtime"
        description = str(packet.get("description") or packet.get("task_description") or task_id or "packet").strip()
        span_ctx = tracer.start_span("edge.execute_task")
        span = span_ctx.__enter__()
        span.set_attribute("task.id", task_id)
        span.set_attribute("task.type", description or "packet")
        span.set_attribute("edge.node_id", self.edge_node_id or "")
        span.set_attribute("tenant.id", tenant_id)
        if packet.get("sop_type") and isinstance(packet.get("steps"), list):
            result = await self.execute(packet)
            span.set_attribute("task.success", bool(result.get("success")))
            span.set_attribute("task.duration_ms", int((time.perf_counter() - total_start) * 1000))
            span_ctx.__exit__(None, None, None)
            return result
        if protocol != "marionette/v1":
            span.set_attribute("task.success", False)
            span.set_attribute("task.error", f"unsupported_protocol:{protocol}")
            span_ctx.__exit__(None, None, None)
            return {"success": False, "error": f"unsupported_protocol:{protocol}", "steps": []}
        self.snapshot_collector.tenant_id = tenant_id
        self.snapshot_collector.account_id = str(packet.get("account_id") or packet.get("accountId") or lobster_id).strip() or lobster_id
        self.snapshot_collector.platform = str(packet.get("platform") or "generic").strip() or "generic"
        flag_ctx = EdgeFlagContext(tenant_id=tenant_id, lobster_id=lobster_id, edge_node_id=self.edge_node_id, edge_node_tags=list(self.edge_node_tags))
        if not edge_ff_is_enabled(f"lobster.{lobster_id}.enabled", flag_ctx):
            span.set_attribute("task.success", False)
            span.set_attribute("task.error", "feature_flag_edge_disabled")
            span_ctx.__exit__(None, None, None)
            return {"success": False, "taskId": task_id, "protocol": protocol, "error": "feature_flag_edge_disabled", "steps": []}
        steps = packet.get("steps", [])
        human_like = packet.get("humanLike", {})
        typing_cpm = int(human_like.get("typingCharsPerMinute", self.default_typing_cpm) or self.default_typing_cpm)
        delay_range = human_like.get("delayBetweenActionsMs", [500, 2000])
        if not isinstance(delay_range, (list, tuple)) or len(delay_range) < 2:
            delay_range = [500, 2000]
        min_delay_ms = int(delay_range[0])
        max_delay_ms = int(delay_range[1])
        results: list[dict[str, Any]] = []
        overall_success = True
        local_context = await self.memory.recall(tenant_id=tenant_id, lobster_id=lobster_id, query=description, category="context", top_k=3)
        async with self.snapshot_collector.session(
            description or "packet",
            task_id or None,
            metadata={"mode": "marionette_packet", "lobster_id": lobster_id, "step_count": len(steps)},
        ) as snap:
            await snap.capture_before(page)
            for step in steps:
                if not isinstance(step, dict):
                    continue
                step_id = str(step.get("step_id") or "").strip()
                action = str(step.get("action") or "").strip()
                params = step.get("params", {})
                optional = bool(step.get("optional", False))
                step_start = time.perf_counter()
                try:
                    result = await self._execute_step(action, params, page, typing_cpm)
                    step_result = StepResult(step_id, action, True, int((time.perf_counter() - step_start) * 1000), data=result)
                    await snap.step(
                        action or step_id or "packet_step",
                        page,
                        status="ok",
                        metadata={"step_id": step_id, "params": params, "duration_ms": step_result.duration_ms},
                    )
                except Exception as exc:
                    step_result = StepResult(step_id, action, False, int((time.perf_counter() - step_start) * 1000), error=str(exc)[:500])
                    await snap.step(
                        action or step_id or "packet_step",
                        page,
                        status="error",
                        error_msg=str(exc)[:500],
                        metadata={"step_id": step_id, "params": params, "duration_ms": step_result.duration_ms},
                    )
                    if not optional:
                        overall_success = False
                        results.append(step_result.as_dict())
                        break
                results.append(step_result.as_dict())
                if self.telemetry is not None:
                    await self.telemetry.push(TelemetryEvent(event_id=f"evt_{task_id}_{step_id or action}", event_type="metric", timestamp=time.time(), lobster_id=lobster_id, edge_node_id=self.edge_node_id, tenant_id=tenant_id, trace_id=str(packet.get("trace_id") or ""), payload={"name": "step_duration_ms", "value": step_result.duration_ms, "task_id": task_id, "step_id": step_id, "action": action, "success": step_result.success}))
                await asyncio.sleep(random.randint(min_delay_ms, max_delay_ms) / 1000.0)
            await snap.capture_after(page)
            snap.mark_result("success" if overall_success else "failed")
            if not overall_success:
                snap.snapshot.status = "failed"
                snap.snapshot.error_detail = "packet_failed"
        total_duration_ms = int((time.perf_counter() - total_start) * 1000)
        if self.telemetry is not None:
            await self.telemetry.push(TelemetryEvent(event_id=f"run_{task_id or int(time.time())}", event_type="run_result", timestamp=time.time(), lobster_id=lobster_id, edge_node_id=self.edge_node_id, tenant_id=tenant_id, trace_id=str(packet.get("trace_id") or ""), payload={"task_id": task_id, "skill_name": description, "status": "success" if overall_success else "error", "duration_ms": total_duration_ms, "quality_score": None, "token_count": 0, "error": "" if overall_success else "packet_failed"}))
        if overall_success:
            await self.memory.remember(tenant_id=tenant_id, lobster_id=lobster_id, category="context", key=f"packet_{task_id or int(time.time())}", value=json.dumps({"task_id": task_id, "description": description, "steps_executed": len(results), "success": overall_success}, ensure_ascii=False), metadata={"source": "marionette_executor", "duration_ms": total_duration_ms})
        span.set_attribute("task.success", overall_success)
        span.set_attribute("task.duration_ms", total_duration_ms)
        span_ctx.__exit__(None, None, None)
        return {"success": overall_success, "taskId": task_id, "protocol": protocol, "steps_total": len(steps), "steps_executed": len(results), "total_duration_ms": total_duration_ms, "local_context": local_context, "steps": results}

    async def _execute_step(self, action: str, params: dict[str, Any], page: Any, typing_cpm: int) -> dict[str, Any]:
        if action == "WAIT":
            wait_ms = int(params.get("wait_ms", 1000) or 1000)
            await asyncio.sleep(wait_ms / 1000.0)
            return {"waited_ms": wait_ms}
        if action == "NAVIGATE":
            url = str(params.get("url") or "").strip()
            if not url:
                raise ValueError("NAVIGATE requires url param")
            if page is not None:
                await page.goto(url, wait_until="domcontentloaded")
            return {"url": url, "navigated": page is not None}
        if action == "CLICK_SELECTOR":
            selector = str(params.get("selector") or "").strip()
            if not selector:
                raise ValueError("CLICK_SELECTOR requires selector param")
            if page is not None:
                resolution = await self.navigator.resolve(selector, page=page)
                if resolution is not None:
                    trajectory = self.mimic.generate_trajectory(self._current_mouse_x, self._current_mouse_y, resolution.center_x, resolution.center_y, duration_ms=random.randint(300, 800))
                    for i, (x, y, ts) in enumerate(trajectory):
                        await page.mouse.move(x, y)
                        if i < len(trajectory) - 1:
                            sleep_s = max(0, (trajectory[i + 1][2] - ts) / 1000.0)
                            if sleep_s > 0:
                                await asyncio.sleep(sleep_s)
                    await page.mouse.click(resolution.center_x, resolution.center_y)
                    self._current_mouse_x = resolution.center_x
                    self._current_mouse_y = resolution.center_y
                    return {"clicked": True, "selector": selector, "trajectory_variance": round(self.mimic.trajectory_variance(trajectory), 4)}
                await page.click(selector)
                return {"clicked": True, "selector": selector, "method": "direct_click"}
            return {"clicked": False, "selector": selector, "reason": "no_page"}
        if action == "INPUT_TEXT":
            selector = str(params.get("selector") or "").strip()
            text = str(params.get("text") or "").strip()
            if not text:
                raise ValueError("INPUT_TEXT requires text param")
            step_cpm = int(params.get("typing_chars_per_minute", typing_cpm) or typing_cpm)
            delay_per_char = 60.0 / max(1, step_cpm)
            if page is not None:
                if selector:
                    await page.click(selector)
                for char in text:
                    await page.keyboard.type(char, delay=int(delay_per_char * 1000))
                    jitter = random.uniform(-0.05, 0.15) * delay_per_char
                    if jitter > 0:
                        await asyncio.sleep(jitter)
            return {"typed": True, "chars": len(text), "cpm": step_cpm}
        if action == "SCROLL":
            delta_y = int(params.get("delta_y", 300) or 300)
            count = int(params.get("count", 1) or 1)
            if page is not None:
                for _ in range(count):
                    await page.mouse.wheel(0, delta_y)
                    await asyncio.sleep(random.uniform(0.1, 0.4))
            return {"scrolled": True, "delta_y": delta_y, "count": count}
        if action == "SCREENSHOT":
            name = str(params.get("name") or "screenshot").strip()
            screenshot_data = await page.screenshot(type="png") if page is not None else None
            return {"name": name, "captured": screenshot_data is not None, "size": len(screenshot_data) if screenshot_data else 0}
        if action in ("UPLOAD_VIDEO", "UPLOAD_IMAGE"):
            file_path = str(params.get("file_path") or "").strip()
            selector = str(params.get("selector") or "input[type=file]").strip()
            if not file_path:
                raise ValueError(f"{action} requires file_path param")
            if page is not None:
                await page.locator(selector).set_input_files(file_path)
            return {"uploaded": page is not None, "file_path": file_path}
        if action == "DOWNLOAD_ASSET":
            asset_url = str(params.get("asset_url") or "").strip()
            save_as = str(params.get("save_as") or "").strip()
            if not asset_url:
                raise ValueError("DOWNLOAD_ASSET requires asset_url param")
            return {"asset_url": asset_url, "save_as": save_as, "downloaded": False, "reason": "stub"}
        if action == "GRAB_SOURCE":
            extract = str(params.get("extract") or "links").strip()
            if page is not None:
                return {"extract": extract, "content_length": len(await page.content())}
            return {"extract": extract, "content_length": 0}
        if action == "REPORT_BACK":
            return {"reported": True, "message": str(params.get("message") or "").strip()}
        if action == "PUBLISH_CONTENT":
            publisher = ContentPublisher()
            task = publisher.from_payload(params)
            result = await publisher.execute_publish_task(task)
            return {"published": result.get("status") == "published", "result": result}
        raise ValueError(f"unsupported_action:{action}")

    async def _get_session(self, account_id: str, platform: str) -> StagehandSession:
        session = self._sessions.get(account_id)
        if session is None:
            session = await StagehandSession.create(account_id, platform)
            self._sessions[account_id] = session
        return session

    @staticmethod
    def _interpolate(value: Any, variables: dict[str, Any]) -> Any:
        if isinstance(value, str):
            rendered = value
            for key, replacement in variables.items():
                rendered = rendered.replace(f"{{{key}}}", str(replacement))
            return rendered
        if isinstance(value, list):
            return [MarionetteExecutor._interpolate(item, variables) for item in value]
        if isinstance(value, dict):
            return {key: MarionetteExecutor._interpolate(item, variables) for key, item in value.items()}
        return value

    @staticmethod
    def _resolve_attachments(step: dict[str, Any], variables: dict[str, Any], default_attachments: list[Any]) -> list[Any]:
        attachments = step.get("attachments")
        if isinstance(attachments, str):
            try:
                import ast

                parsed = ast.literal_eval(attachments)
                if isinstance(parsed, list):
                    return parsed
            except Exception:
                pass
            key = attachments.strip("{} ")
            candidate = variables.get(key)
            if isinstance(candidate, list):
                return candidate
            if candidate is not None:
                return [candidate]
            return default_attachments
        if isinstance(attachments, list):
            return attachments
        return default_attachments

    async def _upload_files(self, session: StagehandSession, attachments: list[Any]) -> int:
        temp_dir = Path(os.getenv("TMPDIR") or os.getenv("TEMP") or "/tmp").resolve()
        temp_dir.mkdir(parents=True, exist_ok=True)
        temp_paths: list[str] = []
        for index, item in enumerate(attachments):
            raw = str(item or "").strip()
            if not raw:
                continue
            if Path(raw).exists():
                temp_paths.append(str(Path(raw).resolve()))
                continue
            temp_path = temp_dir / f"sop_upload_{index}.bin"
            temp_path.write_bytes(base64.b64decode(raw))
            temp_paths.append(str(temp_path))
        if session.page is None:
            raise RuntimeError("page_unavailable")
        await session.page.locator("input[type=file]").first.set_input_files(temp_paths)
        return len(temp_paths)

    @staticmethod
    def _finish_log(step_log: dict[str, Any], step_started: float) -> dict[str, Any]:
        step_log["finished_at"] = datetime.now(timezone.utc).isoformat()
        step_log["duration_ms"] = int((time.perf_counter() - step_started) * 1000)
        return step_log
