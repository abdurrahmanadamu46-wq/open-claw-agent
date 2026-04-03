from __future__ import annotations

from pathlib import Path

from .base import PlatformAdapter, PublishResult, PublishStatus, PublishTask


class XiaohongshuAdapter(PlatformAdapter):
    creator_home = "https://creator.xiaohongshu.com/publish/publish"

    async def login_check(self, page) -> bool:
        await page.goto(self.creator_home, wait_until="domcontentloaded")
        try:
            current = str(page.url)
        except Exception:
            current = self.creator_home
        return "login" not in current.lower()

    async def publish_video(self, page, task: PublishTask) -> PublishResult:
        try:
            await page.goto(self.creator_home, wait_until="domcontentloaded")
            file_input = page.locator('input[type="file"]')
            await file_input.set_input_files([str(Path(task.media_urls[0]).resolve())])
            await page.locator('input[placeholder*="标题"], textarea[placeholder*="标题"]').first.fill(task.title[:20])
            await page.locator('textarea').last.fill(task.caption[:1000])
            if task.tags:
                await page.locator('textarea').last.type(" " + " ".join(f"#{tag}" for tag in task.tags[:10]))
            await page.locator('button:has-text("发布"), button:has-text("发表")').first.click()
            screenshot_path = str(Path(task.profile_dir or ".").resolve() / f"{task.task_id}_publish.png")
            await page.screenshot(path=screenshot_path, full_page=True)
            return PublishResult(
                task_id=task.task_id,
                status=PublishStatus.PUBLISHED,
                platform_url=str(page.url),
                screenshot_path=screenshot_path,
            )
        except Exception as exc:
            return PublishResult(
                task_id=task.task_id,
                status=PublishStatus.FAILED,
                error_message=str(exc),
            )

    async def publish_image_post(self, page, task: PublishTask) -> PublishResult:
        try:
            await page.goto(self.creator_home, wait_until="domcontentloaded")
            file_input = page.locator('input[type="file"]')
            await file_input.set_input_files([str(Path(item).resolve()) for item in task.media_urls])
            await page.locator('input[placeholder*="标题"], textarea[placeholder*="标题"]').first.fill(task.title[:20])
            await page.locator('textarea').last.fill(task.caption[:1000])
            if task.tags:
                await page.locator('textarea').last.type(" " + " ".join(f"#{tag}" for tag in task.tags[:10]))
            await page.locator('button:has-text("发布"), button:has-text("发表")').first.click()
            screenshot_path = str(Path(task.profile_dir or ".").resolve() / f"{task.task_id}_publish.png")
            await page.screenshot(path=screenshot_path, full_page=True)
            return PublishResult(
                task_id=task.task_id,
                status=PublishStatus.PUBLISHED,
                platform_url=str(page.url),
                screenshot_path=screenshot_path,
            )
        except Exception as exc:
            return PublishResult(
                task_id=task.task_id,
                status=PublishStatus.FAILED,
                error_message=str(exc),
            )
