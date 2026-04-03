from __future__ import annotations

import asyncio
import random
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional


class BrowserEngine:
    """
    Browser engine with best-effort anti-detection preference.

    Priority:
    1. Camoufox when installed
    2. Playwright persistent Firefox/Chromium
    """

    def __init__(self, headless: bool = True, proxy: Optional[str] = None) -> None:
        self.headless = bool(headless)
        self.proxy = str(proxy or "").strip() or None

    @asynccontextmanager
    async def new_context(
        self,
        profile_dir: Optional[str] = None,
        *,
        prefer_camoufox: bool = True,
        prefer_chromium: bool = False,
        humanize: bool = False,
        geoip: bool = False,
        headless_mode: str | bool | None = None,
    ):
        profile_path = Path(profile_dir).resolve() if profile_dir else None
        if profile_path is not None:
            profile_path.mkdir(parents=True, exist_ok=True)
        if prefer_camoufox:
            try:
                from camoufox.async_api import AsyncCamoufox

                async with AsyncCamoufox(
                    headless=headless_mode if headless_mode is not None else self.headless,
                    proxy={"server": self.proxy} if self.proxy else None,
                    persistent_context=str(profile_path) if profile_path else None,
                    os_name="windows",
                    screen_width=1920,
                    screen_height=1080,
                    humanize=humanize,
                    geoip=geoip,
                    i_know_what_im_doing=True,
                ) as browser:
                    page = await browser.new_page()
                    try:
                        setattr(page, "_browser_backend", "camoufox")
                        setattr(page, "_humanize_enabled", bool(humanize))
                    except Exception:
                        pass
                    yield page
                    return
            except Exception:
                pass

        try:
            from playwright.async_api import async_playwright

            async with async_playwright() as playwright:
                browser_type = playwright.chromium if prefer_chromium else playwright.firefox
                if profile_path is not None:
                    context = await browser_type.launch_persistent_context(
                        str(profile_path),
                        headless=self.headless,
                        proxy={"server": self.proxy} if self.proxy else None,
                        viewport={"width": 1920, "height": 1080},
                    )
                    page = context.pages[0] if context.pages else await context.new_page()
                    try:
                        setattr(page, "_browser_backend", "playwright_chromium" if prefer_chromium else "playwright_firefox")
                        yield page
                    finally:
                        await context.close()
                    return
                browser = await browser_type.launch(
                    headless=self.headless,
                    proxy={"server": self.proxy} if self.proxy else None,
                )
                context = await browser.new_context(viewport={"width": 1920, "height": 1080})
                page = await context.new_page()
                try:
                    setattr(page, "_browser_backend", "playwright_chromium" if prefer_chromium else "playwright_firefox")
                    yield page
                finally:
                    await context.close()
                    await browser.close()
                return
        except Exception as exc:
            raise RuntimeError(f"browser_backend_unavailable:{exc}") from exc

    async def human_type(self, page: Any, selector: str, text: str, delay_ms: int = 80) -> None:
        element = page.locator(selector)
        await element.click()
        for char in text:
            await element.type(char, delay=max(20, delay_ms + random.randint(-30, 50)))
            if random.random() < 0.05:
                await asyncio.sleep(random.uniform(0.2, 0.8))

    async def human_click(self, page: Any, selector: str) -> None:
        element = page.locator(selector)
        box = await element.bounding_box()
        if box:
            x = box["x"] + box["width"] * random.uniform(0.3, 0.7)
            y = box["y"] + box["height"] * random.uniform(0.3, 0.7)
            await page.mouse.click(x, y)
            return
        await element.click()
