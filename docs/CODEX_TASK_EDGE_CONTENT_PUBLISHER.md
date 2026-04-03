# CODEX TASK: 边缘内容自动发布系统落地指南
**任务ID**: CODEX-EDGE-PUB-001  
**优先级**: 🔴 P0（决定 ¥4,800/月价值锚定）  
**依赖文件**: `edge-runtime/marionette_executor.py`, `edge-runtime/context_navigator.py`  
**参考项目**: Stagehand（AI浏览器自动化）、Camoufox（反检测浏览器）、APScheduler v4  
**预计工期**: 5天

---

## 一、任务背景

V7 定价锚定"AI全自动代运营"：每席每月 20条视频+30张图+500次客服互动+30次销售外呼。

**当前痛点**：龙虾只能"生成内容"，不能"发布内容"。  
- `marionette_executor.py` 是空壳（Playwright 控制逻辑未实现）
- 小红书/抖音/视频号的发布 SOP 全部空白
- 没有定时发布调度器（EdgeScheduler 缺失）
- 没有反检测能力（Playwright 原生会被平台封号）

**商业影响**：如果只生成不发布，客户感知价值减半，¥4,800/月定价无法支撑。

---

## 二、架构设计

```
┌──────────────────────────────────────────────────────────────┐
│                    边缘内容发布系统                            │
├──────────────────────────────────────────────────────────────┤
│  云端（dragon-senate-saas-v2）                                │
│    dispatcher 龙虾 → 生成 ExecutionPlan（JSON）               │
│    ↓ via bridge_protocol WSS                                 │
│  边缘（edge-runtime）                                        │
│    wss_receiver.py → 收到 ExecutionPlan                      │
│    ↓                                                         │
│    content_publisher.py（NEW）                                │
│    ├── PublishScheduler（APScheduler v4 定时发布）             │
│    ├── PlatformAdapter（平台适配：小红书/抖音/视频号/公众号）   │
│    ├── BrowserEngine（Camoufox 反检测浏览器）                  │
│    └── PublishResultReporter（发布结果回传云端）                │
└──────────────────────────────────────────────────────────────┘
```

---

## 三、核心模块实现

### Step 1：`browser_engine.py` — 反检测浏览器引擎

```python
# edge-runtime/browser_engine.py
"""
反检测浏览器引擎
基于 Camoufox（Firefox反检测）+ Playwright
解决平台风控封号问题

依赖安装：
  pip install camoufox playwright
  python -m playwright install firefox
"""

import asyncio
from typing import Optional
from contextlib import asynccontextmanager

class BrowserEngine:
    """
    浏览器引擎：优先使用 Camoufox（反检测），降级到 Playwright Firefox
    
    Camoufox 特性：
    - Canvas/WebGL 指纹随机化
    - User-Agent 真实化
    - 字体列表随机化
    - WebRTC 泄露防护
    """
    
    def __init__(self, headless: bool = True, proxy: Optional[str] = None):
        self.headless = headless
        self.proxy = proxy
        self._browser = None
    
    @asynccontextmanager
    async def new_context(self, profile_dir: Optional[str] = None):
        """
        创建浏览器上下文（每个社交账号独立 profile）
        
        profile_dir: 持久化目录，保存 Cookies/LocalStorage
        （每席对应一个 profile，实现免登录复用）
        """
        try:
            # 优先 Camoufox
            from camoufox.async_api import AsyncCamoufox
            async with AsyncCamoufox(
                headless=self.headless,
                proxy={"server": self.proxy} if self.proxy else None,
                persistent_context=profile_dir,
                # 指纹配置
                os_name="windows",
                screen_width=1920,
                screen_height=1080,
            ) as browser:
                page = await browser.new_page()
                yield page
                
        except ImportError:
            # 降级到 Playwright Firefox
            from playwright.async_api import async_playwright
            async with async_playwright() as p:
                browser_type = p.firefox
                if profile_dir:
                    context = await browser_type.launch_persistent_context(
                        profile_dir,
                        headless=self.headless,
                        proxy={"server": self.proxy} if self.proxy else None,
                        viewport={"width": 1920, "height": 1080},
                    )
                    page = context.pages[0] if context.pages else await context.new_page()
                else:
                    browser = await browser_type.launch(headless=self.headless)
                    page = await browser.new_page()
                
                yield page
    
    async def human_type(self, page, selector: str, text: str, delay_ms: int = 80):
        """模拟人类打字（随机延迟）"""
        import random
        element = page.locator(selector)
        await element.click()
        for char in text:
            await element.type(char, delay=delay_ms + random.randint(-30, 50))
            if random.random() < 0.05:  # 5%概率停顿
                await asyncio.sleep(random.uniform(0.3, 1.0))
    
    async def human_click(self, page, selector: str):
        """模拟人类点击（随机偏移）"""
        import random
        element = page.locator(selector)
        box = await element.bounding_box()
        if box:
            x = box["x"] + box["width"] * random.uniform(0.3, 0.7)
            y = box["y"] + box["height"] * random.uniform(0.3, 0.7)
            await page.mouse.click(x, y)
        else:
            await element.click()
```

### Step 2：`platform_adapters/` — 平台发布适配器

```python
# edge-runtime/platform_adapters/base.py
"""平台发布适配器基类"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional, List
from enum import Enum

class ContentType(Enum):
    VIDEO = "video"
    IMAGE_POST = "image_post"  # 图文笔记
    TEXT_POST = "text_post"

class PublishStatus(Enum):
    PENDING = "pending"
    UPLOADING = "uploading"
    PUBLISHED = "published"
    FAILED = "failed"
    REJECTED = "rejected"       # 平台审核不通过

@dataclass
class PublishTask:
    """发布任务"""
    task_id: str
    seat_id: str                    # 席位ID（对应一个社交账号）
    platform: str                   # xiaohongshu / douyin / weixin_video / weixin_gzh
    content_type: ContentType
    title: str
    caption: str                    # 文案/描述
    tags: List[str]                 # 话题标签
    media_urls: List[str]           # 视频/图片 URL（从 artifact_store 获取）
    cover_url: Optional[str] = None # 封面图
    scheduled_at: Optional[str] = None  # 定时发布时间（ISO格式）
    
@dataclass
class PublishResult:
    """发布结果"""
    task_id: str
    status: PublishStatus
    platform_post_id: Optional[str] = None   # 平台侧帖子ID
    platform_url: Optional[str] = None       # 帖子链接
    error_message: Optional[str] = None
    screenshot_path: Optional[str] = None    # 发布成功截图（审计用）


class PlatformAdapter(ABC):
    """平台发布适配器基类"""
    
    @abstractmethod
    async def login_check(self, page) -> bool:
        """检查是否已登录（利用持久化 profile 的 cookies）"""
        pass
    
    @abstractmethod
    async def publish_video(self, page, task: PublishTask) -> PublishResult:
        """发布视频"""
        pass
    
    @abstractmethod
    async def publish_image_post(self, page, task: PublishTask) -> PublishResult:
        """发布图文笔记"""
        pass
    
    @abstractmethod
    async def reply_comment(self, page, post_id: str, comment_id: str, reply_text: str) -> bool:
        """回复评论（echoer 客服互动）"""
        pass
    
    @abstractmethod
    async def send_private_message(self, page, user_id: str, message: str) -> bool:
        """发私信（catcher 商机/followup 跟进）"""
        pass
```

```python
# edge-runtime/platform_adapters/xiaohongshu.py
"""小红书发布适配器"""

from .base import PlatformAdapter, PublishTask, PublishResult, PublishStatus
import asyncio

class XiaohongshuAdapter(PlatformAdapter):
    """
    小红书（creator.xiaohongshu.com）发布适配器
    
    发布流程：
    1. 打开创作者中心
    2. 检查登录状态（利用持久化 cookies）
    3. 点击"发布笔记"
    4. 上传视频/图片
    5. 填写标题、描述、话题标签
    6. 选择定时发布时间（可选）
    7. 点击发布
    8. 截图保存+获取帖子 URL
    """
    
    CREATOR_URL = "https://creator.xiaohongshu.com"
    
    async def login_check(self, page) -> bool:
        await page.goto(f"{self.CREATOR_URL}/publish/publish")
        await page.wait_for_load_state("networkidle")
        # 如果跳转到登录页，说明 cookies 过期
        current_url = page.url
        return "login" not in current_url and "passport" not in current_url
    
    async def publish_video(self, page, task: PublishTask) -> PublishResult:
        from browser_engine import BrowserEngine
        engine = BrowserEngine()
        
        try:
            # 1. 进入发布页
            await page.goto(f"{self.CREATOR_URL}/publish/publish")
            await page.wait_for_load_state("networkidle")
            await asyncio.sleep(2)
            
            # 2. 切换到视频发布Tab
            video_tab = page.locator('text=上传视频')
            if await video_tab.is_visible():
                await video_tab.click()
                await asyncio.sleep(1)
            
            # 3. 上传视频文件
            # 先从 media_urls 下载到本地临时路径
            local_path = await self._download_media(task.media_urls[0])
            file_input = page.locator('input[type="file"]')
            await file_input.set_input_files(local_path)
            
            # 4. 等待上传完成
            await self._wait_for_upload(page, timeout=120)
            
            # 5. 填写标题
            title_input = page.locator('[placeholder*="标题"]')
            await engine.human_type(page, '[placeholder*="标题"]', task.title)
            
            # 6. 填写描述/正文
            desc_input = page.locator('[placeholder*="正文"]')
            await engine.human_type(page, '[placeholder*="正文"]', task.caption)
            
            # 7. 添加话题标签
            for tag in task.tags[:5]:  # 小红书最多5个话题
                tag_input = page.locator('[placeholder*="话题"]')
                if await tag_input.is_visible():
                    await engine.human_type(page, '[placeholder*="话题"]', f"#{tag}")
                    await asyncio.sleep(0.5)
                    # 选择第一个推荐话题
                    suggestion = page.locator('.topic-suggestion-item').first
                    if await suggestion.is_visible():
                        await suggestion.click()
                        await asyncio.sleep(0.3)
            
            # 8. 设置封面（如果有）
            if task.cover_url:
                await self._set_cover(page, task.cover_url)
            
            # 9. 定时发布（如果设置了时间）
            if task.scheduled_at:
                await self._set_schedule(page, task.scheduled_at)
            
            # 10. 发布
            publish_btn = page.locator('button:has-text("发布")')
            await publish_btn.click()
            await asyncio.sleep(3)
            
            # 11. 截图保存
            screenshot_path = f"/tmp/publish_{task.task_id}.png"
            await page.screenshot(path=screenshot_path)
            
            # 12. 获取帖子 URL（从发布成功页面提取）
            post_url = await self._extract_post_url(page)
            
            return PublishResult(
                task_id=task.task_id,
                status=PublishStatus.PUBLISHED,
                platform_url=post_url,
                screenshot_path=screenshot_path,
            )
            
        except Exception as e:
            screenshot_path = f"/tmp/publish_error_{task.task_id}.png"
            await page.screenshot(path=screenshot_path)
            return PublishResult(
                task_id=task.task_id,
                status=PublishStatus.FAILED,
                error_message=str(e),
                screenshot_path=screenshot_path,
            )
    
    async def publish_image_post(self, page, task: PublishTask) -> PublishResult:
        """发布图文笔记（类似 publish_video，切换到图文 Tab）"""
        # 流程类似 publish_video，区别是多图上传
        # 略：具体实现参考 publish_video
        pass
    
    async def reply_comment(self, page, post_id: str, comment_id: str, reply_text: str) -> bool:
        """回复评论（echoer 客服场景，每席500次/月）"""
        await page.goto(f"{self.CREATOR_URL}/comment")
        await page.wait_for_load_state("networkidle")
        # 找到对应评论 → 点击回复 → 输入 → 发送
        # 略：具体实现
        return True
    
    async def send_private_message(self, page, user_id: str, message: str) -> bool:
        """发私信（catcher/followup 场景，每席30次/月）"""
        await page.goto(f"{self.CREATOR_URL}/messaging")
        await page.wait_for_load_state("networkidle")
        # 搜索用户 → 打开对话 → 输入 → 发送
        # 略：具体实现
        return True
    
    async def _download_media(self, url: str) -> str:
        """从 artifact_store 下载媒体到本地"""
        import httpx, tempfile, os
        async with httpx.AsyncClient() as client:
            resp = await client.get(url)
            suffix = ".mp4" if "video" in resp.headers.get("content-type", "") else ".jpg"
            path = os.path.join(tempfile.gettempdir(), f"media_{hash(url)}{suffix}")
            with open(path, "wb") as f:
                f.write(resp.content)
            return path
    
    async def _wait_for_upload(self, page, timeout: int = 120):
        """等待上传完成（进度条消失或出现"上传完成"提示）"""
        for _ in range(timeout):
            progress = page.locator('.upload-progress, .uploading')
            if not await progress.is_visible():
                return
            await asyncio.sleep(1)
        raise TimeoutError("视频上传超时")
    
    async def _set_schedule(self, page, scheduled_at: str):
        """设置定时发布"""
        schedule_btn = page.locator('text=定时发布')
        if await schedule_btn.is_visible():
            await schedule_btn.click()
            # 填写日期时间
            # 略：具体实现取决于小红书创作者中心UI
    
    async def _extract_post_url(self, page) -> str:
        """发布成功后提取帖子 URL"""
        await asyncio.sleep(2)
        # 尝试从成功页面提取链接
        link = page.locator('a[href*="xiaohongshu.com/explore"]')
        if await link.is_visible():
            return await link.get_attribute("href")
        return page.url
```

### Step 3：`publish_scheduler.py` — 定时发布调度器

```python
# edge-runtime/publish_scheduler.py
"""
定时发布调度器
基于 APScheduler v4，支持：
- 定时发布（每天最佳时间窗）
- 持久化调度（SQLite，重启不丢任务）
- 错过补发（missed job recovery）
"""

import asyncio
import json
from datetime import datetime
from apscheduler import AsyncScheduler
from apscheduler.datastores.sqlalchemy import SQLAlchemyDataStore
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.cron import CronTrigger

from platform_adapters.base import PublishTask, ContentType
from browser_engine import BrowserEngine

# 各平台最佳发布时间（基于行业数据）
OPTIMAL_PUBLISH_WINDOWS = {
    "xiaohongshu": ["07:30", "12:00", "18:30", "21:00"],
    "douyin": ["07:00", "12:30", "18:00", "21:30"],
    "weixin_video": ["08:00", "12:00", "20:00"],
    "weixin_gzh": ["07:30", "12:00", "17:30"],
}

class PublishScheduler:
    """
    定时发布调度器
    
    每席每月20条视频，分散到工作日发布：
    - 20条 ÷ 22工作日 ≈ 每工作日1条
    - 选择当天最佳时间窗口
    """
    
    def __init__(self, db_path: str = "sqlite:///edge_scheduler.db"):
        self.data_store = SQLAlchemyDataStore(engine_url=db_path)
        self.scheduler = None
    
    async def start(self):
        """启动调度器（重启后自动恢复未执行的任务）"""
        self.scheduler = AsyncScheduler(data_store=self.data_store)
        await self.scheduler.__aenter__()
        await self.scheduler.start_in_background()
    
    async def schedule_publish(self, task: PublishTask) -> str:
        """
        调度一个发布任务
        
        如果 task.scheduled_at 有值，按指定时间发布
        否则，自动选择下一个最佳时间窗
        """
        if task.scheduled_at:
            trigger = DateTrigger(run_time=datetime.fromisoformat(task.scheduled_at))
        else:
            # 自动选择最佳发布时间
            next_slot = self._find_next_optimal_slot(task.platform)
            trigger = DateTrigger(run_time=next_slot)
        
        job_id = await self.scheduler.add_job(
            self._execute_publish,
            trigger=trigger,
            kwargs={"task_json": json.dumps(task.__dict__, default=str)},
            id=f"publish_{task.task_id}",
        )
        
        return job_id
    
    async def schedule_batch(self, tasks: list[PublishTask]) -> list[str]:
        """
        批量调度（每席20条视频分散到一个月的工作日）
        
        自动分配到不同日期和时间窗
        """
        job_ids = []
        for i, task in enumerate(tasks):
            # 每条视频间隔至少1天
            optimal_slots = self._distribute_across_month(
                task.platform, len(tasks), i
            )
            task.scheduled_at = optimal_slots.isoformat()
            job_id = await self.schedule_publish(task)
            job_ids.append(job_id)
        return job_ids
    
    async def _execute_publish(self, task_json: str):
        """实际执行发布（由调度器调用）"""
        import json
        task_dict = json.loads(task_json)
        task = PublishTask(**task_dict)
        
        # 获取平台适配器
        adapter = self._get_adapter(task.platform)
        
        # 创建浏览器（使用席位对应的 profile 目录）
        profile_dir = f"/data/browser_profiles/{task.seat_id}/{task.platform}"
        engine = BrowserEngine(headless=True)
        
        async with engine.new_context(profile_dir=profile_dir) as page:
            # 检查登录
            if not await adapter.login_check(page):
                # 登录失效，通知云端（需要人工扫码重新登录）
                await self._report_login_expired(task)
                return
            
            # 执行发布
            if task.content_type == ContentType.VIDEO.value:
                result = await adapter.publish_video(page, task)
            elif task.content_type == ContentType.IMAGE_POST.value:
                result = await adapter.publish_image_post(page, task)
            else:
                result = await adapter.publish_image_post(page, task)
        
        # 回传结果到云端
        await self._report_result_to_cloud(result)
        
        # 消耗配额（通知云端扣减）
        await self._consume_quota(task.seat_id, task.content_type)
    
    def _get_adapter(self, platform: str):
        from platform_adapters.xiaohongshu import XiaohongshuAdapter
        # from platform_adapters.douyin import DouyinAdapter
        # from platform_adapters.weixin_video import WeixinVideoAdapter
        
        adapters = {
            "xiaohongshu": XiaohongshuAdapter(),
            # "douyin": DouyinAdapter(),
            # "weixin_video": WeixinVideoAdapter(),
        }
        return adapters.get(platform, XiaohongshuAdapter())
    
    def _find_next_optimal_slot(self, platform: str) -> datetime:
        """找到下一个最佳发布时间"""
        from datetime import timedelta
        now = datetime.now()
        windows = OPTIMAL_PUBLISH_WINDOWS.get(platform, ["12:00"])
        
        for window in windows:
            h, m = map(int, window.split(":"))
            slot = now.replace(hour=h, minute=m, second=0, microsecond=0)
            if slot > now:
                return slot
        
        # 今天所有窗口已过，用明天第一个
        h, m = map(int, windows[0].split(":"))
        return (now + timedelta(days=1)).replace(hour=h, minute=m, second=0, microsecond=0)
    
    def _distribute_across_month(self, platform: str, total: int, index: int) -> datetime:
        """将 N 条内容均匀分散到一个月的工作日"""
        from datetime import timedelta
        import calendar
        
        now = datetime.now()
        year, month = now.year, now.month
        cal = calendar.monthcalendar(year, month)
        
        # 获取工作日列表（周一到周五）
        workdays = []
        for week in cal:
            for day_idx in range(5):  # Mon-Fri
                day = week[day_idx]
                if day > 0 and day >= now.day:
                    workdays.append(day)
        
        if not workdays:
            workdays = list(range(1, 29))
        
        # 均匀分配
        day_index = index % len(workdays)
        publish_day = workdays[day_index]
        
        # 选择时间窗
        windows = OPTIMAL_PUBLISH_WINDOWS.get(platform, ["12:00"])
        window = windows[index % len(windows)]
        h, m = map(int, window.split(":"))
        
        return datetime(year, month, publish_day, h, m, 0)
    
    async def _report_result_to_cloud(self, result):
        """通过 WSS 回传发布结果到云端"""
        import httpx
        await httpx.AsyncClient().post(
            "wss://cloud.dragonsaas.cn/edge/publish-result",
            json={
                "task_id": result.task_id,
                "status": result.status.value,
                "platform_url": result.platform_url,
                "error": result.error_message,
            }
        )
    
    async def _consume_quota(self, seat_id: str, content_type: str):
        """通知云端扣减配额"""
        resource_map = {
            "video": "video",
            "image_post": "image",
        }
        resource = resource_map.get(content_type, "llm_tasks")
        # 通过 WSS 通知云端 seat_quota_tracker.consume()
```

---

## 四、集成到现有边缘运行时

```python
# edge-runtime/wss_receiver.py 新增消息处理

async def handle_message(msg: dict):
    msg_type = msg.get("type")
    
    if msg_type == "publish_task":
        # 收到发布任务
        task = PublishTask(**msg["payload"])
        scheduler = PublishScheduler()
        await scheduler.schedule_publish(task)
    
    elif msg_type == "publish_batch":
        # 批量发布（一个月的20条视频）
        tasks = [PublishTask(**t) for t in msg["payload"]["tasks"]]
        scheduler = PublishScheduler()
        await scheduler.schedule_batch(tasks)
    
    elif msg_type == "interaction_task":
        # 客服互动/私信（echoer/catcher/followup）
        await handle_interaction(msg["payload"])
```

---

## 五、文件结构

```
edge-runtime/
├── browser_engine.py          # 反检测浏览器引擎（NEW）
├── publish_scheduler.py       # 定时发布调度器（NEW）
├── platform_adapters/         # 平台发布适配器目录（NEW）
│   ├── __init__.py
│   ├── base.py               # 基类
│   ├── xiaohongshu.py        # 小红书（P0，第一个实现）
│   ├── douyin.py             # 抖音（P1）
│   ├── weixin_video.py       # 视频号（P1）
│   └── weixin_gzh.py         # 公众号（P2）
├── browser_profiles/          # 持久化浏览器 profile（每席独立）
│   └── {seat_id}/{platform}/
├── wss_receiver.py            # 已有，新增 publish_task 消息处理
├── marionette_executor.py     # 已有，升级为调用 platform_adapters
└── context_navigator.py       # 已有
```

---

## 六、依赖安装

```bash
# requirements.txt 新增
camoufox>=0.3.0
playwright>=1.40.0
apscheduler>=4.0.0a5
sqlalchemy>=2.0.0
aiosqlite>=0.20.0
httpx>=0.27.0

# 安装 Firefox for Playwright
python -m playwright install firefox
```

---

## 七、配置（边缘节点）

```env
# edge-runtime/.env
BROWSER_HEADLESS=true
BROWSER_PROXY=socks5://127.0.0.1:1080  # 可选代理
SCHEDULER_DB=sqlite:///edge_scheduler.db
PROFILE_BASE_DIR=/data/browser_profiles
CLOUD_WSS_URL=wss://cloud.dragonsaas.cn/edge
```

---

## 八、验收标准

- [ ] Camoufox 浏览器正常启动（反检测指纹验证）
- [ ] 小红书创作者中心登录检查正常（持久化 cookies）
- [ ] 视频上传+标题+描述+话题标签+发布全流程通过
- [ ] 图文笔记发布全流程通过
- [ ] 定时发布调度器持久化（重启后任务恢复）
- [ ] 20条视频自动分散到工作日最佳时间窗
- [ ] 发布结果截图保存并回传云端
- [ ] 配额消耗正确通知云端
- [ ] 登录过期时自动通知（不会在未登录状态下操作）
- [ ] 最佳时间窗调度：小红书 07:30/12:00/18:30/21:00
