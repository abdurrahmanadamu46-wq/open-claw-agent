"""
Marionette SOP Executor — Edge Runtime Step-by-Step Command Runner
Executes MarionetteSopPacket steps sequentially, using:
  - ContextNavigator for target resolution
  - BBP Kernel for human-like mouse trajectories
  - Playwright for actual browser automation

Architecture boundary: executor-only, zero strategy logic.
"""
import asyncio
import random
import time
from typing import Any, Optional

from bbp_kernel import HumanMouseMimic
from context_navigator import ContextNavigator, parse_selector_hint


class StepResult:
    """Result of executing a single SOP step."""

    __slots__ = ("step_id", "action", "success", "duration_ms", "error", "data")

    def __init__(
        self,
        step_id: str,
        action: str,
        success: bool = True,
        duration_ms: int = 0,
        error: str = "",
        data: Optional[dict[str, Any]] = None,
    ):
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


class MarionetteExecutor:
    """
    Executes a Marionette SOP packet step by step.
    Uses BBP Kernel for human-like mouse movement and
    ContextNavigator for selector-to-coordinate resolution.
    """

    def __init__(
        self,
        navigator: Optional[ContextNavigator] = None,
        mimic: Optional[HumanMouseMimic] = None,
        default_typing_cpm: int = 80,
    ):
        self.navigator = navigator or ContextNavigator()
        self.mimic = mimic or HumanMouseMimic()
        self.default_typing_cpm = default_typing_cpm
        self._current_mouse_x: float = 960.0
        self._current_mouse_y: float = 540.0

    async def execute_packet(
        self,
        packet: dict[str, Any],
        page: Any = None,
    ) -> dict[str, Any]:
        """
        Execute a full MarionetteSopPacket.
        Returns execution report with step results and overall status.
        """
        protocol = str(packet.get("protocol") or "").strip()
        if protocol != "marionette/v1":
            return {
                "success": False,
                "error": f"unsupported_protocol:{protocol}",
                "steps": [],
            }

        task_id = str(packet.get("taskId") or "").strip()
        steps = packet.get("steps", [])
        human_like = packet.get("humanLike", {})
        typing_cpm = int(
            human_like.get("typingCharsPerMinute", self.default_typing_cpm)
            or self.default_typing_cpm
        )
        delay_range = human_like.get("delayBetweenActionsMs", [500, 2000])
        if not isinstance(delay_range, (list, tuple)) or len(delay_range) < 2:
            delay_range = [500, 2000]
        min_delay_ms = int(delay_range[0])
        max_delay_ms = int(delay_range[1])

        results: list[dict[str, Any]] = []
        overall_success = True
        total_start = time.perf_counter()

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
                duration_ms = int((time.perf_counter() - step_start) * 1000)
                step_result = StepResult(
                    step_id=step_id,
                    action=action,
                    success=True,
                    duration_ms=duration_ms,
                    data=result,
                )
            except Exception as exc:
                duration_ms = int((time.perf_counter() - step_start) * 1000)
                step_result = StepResult(
                    step_id=step_id,
                    action=action,
                    success=False,
                    duration_ms=duration_ms,
                    error=str(exc)[:500],
                )
                if not optional:
                    overall_success = False
                    results.append(step_result.as_dict())
                    break

            results.append(step_result.as_dict())

            # Human-like delay between steps
            delay_ms = random.randint(min_delay_ms, max_delay_ms)
            await asyncio.sleep(delay_ms / 1000.0)

        total_duration_ms = int((time.perf_counter() - total_start) * 1000)

        return {
            "success": overall_success,
            "taskId": task_id,
            "protocol": protocol,
            "steps_total": len(steps),
            "steps_executed": len(results),
            "total_duration_ms": total_duration_ms,
            "steps": results,
        }

    async def _execute_step(
        self,
        action: str,
        params: dict[str, Any],
        page: Any,
        typing_cpm: int,
    ) -> dict[str, Any]:
        """Execute a single step. Raises on failure."""

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
                    trajectory = self.mimic.generate_trajectory(
                        self._current_mouse_x,
                        self._current_mouse_y,
                        resolution.center_x,
                        resolution.center_y,
                        duration_ms=random.randint(300, 800),
                    )
                    for i, (x, y, ts) in enumerate(trajectory):
                        await page.mouse.move(x, y)
                        if i < len(trajectory) - 1:
                            next_ts = trajectory[i + 1][2]
                            sleep_s = max(0, (next_ts - ts) / 1000.0)
                            if sleep_s > 0:
                                await asyncio.sleep(sleep_s)
                    await page.mouse.click(resolution.center_x, resolution.center_y)
                    self._current_mouse_x = resolution.center_x
                    self._current_mouse_y = resolution.center_y
                    variance = self.mimic.trajectory_variance(trajectory)
                    return {
                        "clicked": True,
                        "selector": selector,
                        "trajectory_variance": round(variance, 4),
                    }
                else:
                    await page.click(selector)
                    return {"clicked": True, "selector": selector, "method": "direct_click"}
            return {"clicked": False, "selector": selector, "reason": "no_page"}

        if action == "INPUT_TEXT":
            selector = str(params.get("selector") or "").strip()
            text = str(params.get("text") or "").strip()
            if not text:
                raise ValueError("INPUT_TEXT requires text param")
            step_cpm = int(
                params.get("typing_chars_per_minute", typing_cpm) or typing_cpm
            )
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
            screenshot_data = None
            if page is not None:
                screenshot_data = await page.screenshot(type="png")
            return {
                "name": name,
                "captured": screenshot_data is not None,
                "size": len(screenshot_data) if screenshot_data else 0,
            }

        if action in ("UPLOAD_VIDEO", "UPLOAD_IMAGE"):
            file_path = str(params.get("file_path") or "").strip()
            selector = str(params.get("selector") or "input[type=file]").strip()
            if not file_path:
                raise ValueError(f"{action} requires file_path param")
            if page is not None:
                file_input = page.locator(selector)
                await file_input.set_input_files(file_path)
            return {"uploaded": page is not None, "file_path": file_path}

        if action == "DOWNLOAD_ASSET":
            asset_url = str(params.get("asset_url") or "").strip()
            save_as = str(params.get("save_as") or "").strip()
            if not asset_url:
                raise ValueError("DOWNLOAD_ASSET requires asset_url param")
            return {
                "asset_url": asset_url,
                "save_as": save_as,
                "downloaded": False,
                "reason": "stub",
            }

        if action == "GRAB_SOURCE":
            extract = str(params.get("extract") or "links").strip()
            if page is not None:
                content = await page.content()
                return {"extract": extract, "content_length": len(content)}
            return {"extract": extract, "content_length": 0}

        if action == "REPORT_BACK":
            message = str(params.get("message") or "").strip()
            return {"reported": True, "message": message}

        raise ValueError(f"unsupported_action:{action}")
