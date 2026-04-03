"""
Context Navigator — DOM/Selector Target Resolution for Edge Runtime
Resolves cloud-issued target selectors (CSS / XPath / text hints)
into concrete (x, y) screen coordinates for the BBP Kernel.

Architecture boundary: this module is executor-only.
It does NOT make content or strategy decisions.
"""
import re
import hashlib
from typing import Any, Optional, Tuple


class TargetResolution:
    """Result of resolving a target selector to screen coordinates."""

    __slots__ = (
        "x",
        "y",
        "width",
        "height",
        "selector",
        "method",
        "confidence",
        "viewport",
    )

    def __init__(
        self,
        x: float,
        y: float,
        width: float = 0,
        height: float = 0,
        selector: str = "",
        method: str = "css",
        confidence: float = 1.0,
        viewport: Tuple[int, int] = (1920, 1080),
    ):
        self.x = x
        self.y = y
        self.width = width
        self.height = height
        self.selector = selector
        self.method = method
        self.confidence = confidence
        self.viewport = viewport

    @property
    def center_x(self) -> float:
        return self.x + self.width / 2

    @property
    def center_y(self) -> float:
        return self.y + self.height / 2

    def as_dict(self) -> dict[str, Any]:
        return {
            "x": self.x,
            "y": self.y,
            "center_x": self.center_x,
            "center_y": self.center_y,
            "width": self.width,
            "height": self.height,
            "selector": self.selector,
            "method": self.method,
            "confidence": self.confidence,
            "viewport": list(self.viewport),
        }


class SelectorHint:
    """Parsed selector hint from cloud SOP step."""

    __slots__ = ("raw", "selector_type", "value", "fallbacks")

    def __init__(
        self,
        raw: str,
        selector_type: str = "css",
        value: str = "",
        fallbacks: Optional[list[str]] = None,
    ):
        self.raw = raw
        self.selector_type = selector_type
        self.value = value or raw
        self.fallbacks = fallbacks or []


def parse_selector_hint(raw: str) -> SelectorHint:
    """
    Parse a cloud-issued selector hint into structured form.
    Supports:
      - CSS selectors: .class, #id, [attr=val], tag
      - XPath: //div[@class='x']
      - Text match: text:Submit, text:\u53d1\u5e03
      - Coordinate hint: xy:100,200
    """
    text = str(raw or "").strip()
    if not text:
        return SelectorHint(raw="", selector_type="empty", value="")

    # XPath
    if text.startswith("//") or text.startswith("(//"):
        return SelectorHint(raw=text, selector_type="xpath", value=text)

    # Text match
    if text.lower().startswith("text:"):
        value = text[5:].strip()
        return SelectorHint(raw=text, selector_type="text", value=value)

    # Coordinate hint
    xy_match = re.match(r"^xy:\s*(\d+)\s*,\s*(\d+)$", text, re.IGNORECASE)
    if xy_match:
        return SelectorHint(
            raw=text,
            selector_type="coordinate",
            value=f"{xy_match.group(1)},{xy_match.group(2)}",
        )

    # Default: CSS selector
    return SelectorHint(raw=text, selector_type="css", value=text)


class ContextNavigator:
    """
    Resolves target selectors to screen coordinates.
    In production, this interfaces with Playwright's page.locator() / evaluate().
    This base class provides the resolution pipeline; subclass for real browser integration.
    """

    def __init__(self, viewport: Tuple[int, int] = (1920, 1080)):
        self.viewport = viewport
        self._resolution_cache: dict[str, TargetResolution] = {}
        self._stats = {
            "resolved": 0,
            "cache_hits": 0,
            "failures": 0,
        }

    @property
    def stats(self) -> dict[str, Any]:
        return dict(self._stats)

    def _cache_key(self, selector: str, url_hint: str = "") -> str:
        raw = f"{selector}||{url_hint}"
        return hashlib.md5(raw.encode()).hexdigest()[:16]

    async def resolve(
        self,
        selector: str,
        *,
        url_hint: str = "",
        page: Any = None,
        timeout_ms: int = 5000,
    ) -> Optional[TargetResolution]:
        """
        Resolve a selector hint to screen coordinates.
        If page (Playwright Page object) is provided, uses real DOM query.
        Otherwise falls back to heuristic/cached resolution.
        """
        hint = parse_selector_hint(selector)

        # Coordinate hint: direct
        if hint.selector_type == "coordinate":
            parts = hint.value.split(",")
            if len(parts) == 2:
                try:
                    x, y = float(parts[0]), float(parts[1])
                    self._stats["resolved"] += 1
                    return TargetResolution(
                        x=x,
                        y=y,
                        selector=selector,
                        method="coordinate_hint",
                        viewport=self.viewport,
                    )
                except ValueError:
                    pass

        # Cache check
        cache_key = self._cache_key(selector, url_hint)
        if cache_key in self._resolution_cache:
            self._stats["cache_hits"] += 1
            return self._resolution_cache[cache_key]

        # Real Playwright resolution
        if page is not None:
            resolution = await self._resolve_with_playwright(page, hint, timeout_ms)
            if resolution is not None:
                self._resolution_cache[cache_key] = resolution
                self._stats["resolved"] += 1
                return resolution

        self._stats["failures"] += 1
        return None

    async def _resolve_with_playwright(
        self,
        page: Any,
        hint: SelectorHint,
        timeout_ms: int,
    ) -> Optional[TargetResolution]:
        """Resolve using Playwright page object. Override in production subclass."""
        try:
            if hint.selector_type == "css":
                locator = page.locator(hint.value)
            elif hint.selector_type == "xpath":
                locator = page.locator(f"xpath={hint.value}")
            elif hint.selector_type == "text":
                locator = page.get_by_text(hint.value)
            else:
                return None

            await locator.wait_for(timeout=timeout_ms)
            box = await locator.bounding_box()
            if box is None:
                return None

            return TargetResolution(
                x=box["x"],
                y=box["y"],
                width=box["width"],
                height=box["height"],
                selector=hint.raw,
                method=hint.selector_type,
                viewport=self.viewport,
            )
        except Exception:
            return None

    def clear_cache(self) -> int:
        """Clear resolution cache. Returns number of evicted entries."""
        count = len(self._resolution_cache)
        self._resolution_cache.clear()
        return count

    def describe(self) -> dict[str, Any]:
        return {
            "viewport": list(self.viewport),
            "cache_size": len(self._resolution_cache),
            "stats": dict(self._stats),
        }

    def build_selector_candidates(self, instruction: str) -> list[str]:
        """
        Build best-effort text-oriented selector candidates from natural language.

        Example:
        - "点击发布按钮" -> ["text:发布", "text:发布按钮"]
        - "在标题框输入: xxx" -> ["input[placeholder*='标题']", "textarea[placeholder*='标题']"]
        """
        text = str(instruction or "").strip()
        if not text:
            return []

        candidates: list[str] = []
        cleaned = text.replace("点击", "").replace("按钮", "").replace("输入框", "").replace("框", "").strip(" ：:")
        if cleaned:
            candidates.append(f"text:{cleaned}")
        if "标题" in text:
            candidates.extend([
                "input[placeholder*='标题']",
                "textarea[placeholder*='标题']",
                "[contenteditable='true']",
            ])
        if any(token in text for token in ("内容", "正文", "文案", "回复", "评论")):
            candidates.extend([
                "textarea",
                "[contenteditable='true']",
            ])
        if "发布" in text:
            candidates.extend(["text:发布", "text:发表"])
        # keep order but dedupe
        seen: set[str] = set()
        output: list[str] = []
        for item in candidates:
            if item in seen:
                continue
            seen.add(item)
            output.append(item)
        return output
