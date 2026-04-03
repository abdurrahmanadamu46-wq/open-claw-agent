# CODEX TASK: Stagehand 升级 marionette_executor（AI驱动浏览器SOP执行）
**任务ID**: CODEX-STAGEHAND-P0-001  
**优先级**: 🔴 P0（核心业务场景：边缘节点浏览器 SOP 必须真实执行）  
**依赖文件**: `edge-runtime/marionette_executor.py`, `edge-runtime/context_navigator.py`  
**参考项目**: Stagehand（https://github.com/browserbase/stagehand）  
**预计工期**: 3天

---

## 一、当前痛点

**`marionette_executor.py` 现状**（空壳）：
```python
# 现状：只有结构，没有真实执行能力
class MarionetteExecutor:
    async def execute(self, sop: dict) -> dict:
        # TODO: 实现浏览器操作
        return {"success": True, "message": "Not implemented"}
```

**核心业务场景（全部依赖真实执行）**：
- 小红书内容发布（登录→写文案→上传图片→发布）
- 抖音评论回复（找到评论→输入回复→发送）
- 微博互动（点赞/关注/转发）
- 企业微信客户跟进消息发送

**Stagehand vs 纯 Playwright 的区别**：
```
纯 Playwright：
  page.click("#submit-btn")   # 需要精确 CSS 选择器，平台改版即失效

Stagehand AI 驱动：
  await page.act("点击发布按钮")   # AI 理解意图，自动找元素，平台改版自适应
```

**Stagehand 核心能力**：
- `act(instruction)` — 执行自然语言操作（不依赖脆弱的 CSS 选择器）
- `extract(instruction, schema)` — 从页面提取结构化数据
- `observe(instruction)` — 观察页面状态
- 基于视觉 + DOM 双模态理解，平台改版鲁棒性强

---

## 二、架构设计

```
SOP 任务包
    │
    ▼
MarionetteExecutor（升级版）
    │
    ├── StagehandSession（AI浏览器会话）
    │       ├── Stagehand.act()     ← 执行操作
    │       ├── Stagehand.extract() ← 提取数据
    │       └── Stagehand.observe() ← 状态观察
    │
    ├── AccountManager（账号会话管理）
    │       └── 多账号 Cookie 隔离
    │
    └── ExecutionLogger（执行日志）
            └── 截图 + 步骤记录 → 云端上报
```

---

## 三、核心实现

```python
# edge-runtime/marionette_executor.py（全面升级）
"""
MarionetteExecutor - 基于 Stagehand 的 AI 驱动浏览器 SOP 执行器

核心升级：
- 旧版：空壳，无任何实际执行能力
- 新版：Stagehand AI 驱动，自然语言指令执行浏览器操作

依赖：
    pip install stagehand playwright
    playwright install chromium
"""

import asyncio
import base64
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


class MarionetteExecutor:
    """
    AI 驱动的浏览器 SOP 执行器
    
    支持的 SOP 类型：
    - publish_xiaohongshu：小红书发帖
    - reply_comment：评论回复（小红书/抖音/微博）
    - send_dm：私信发送
    - follow_user：关注用户
    - like_post：点赞
    - scrape_data：数据抓取
    """
    
    def __init__(self):
        self._sessions: dict = {}  # account_id → StagehandSession
    
    async def execute(self, sop_payload: dict) -> dict:
        """
        执行 SOP 任务
        
        Args:
            sop_payload: {
                "sop_type": "publish_xiaohongshu",
                "account_id": "xhs_001",
                "platform": "xiaohongshu",
                "steps": [
                    {"action": "navigate", "url": "https://creator.xiaohongshu.com"},
                    {"action": "act", "instruction": "点击发布笔记按钮"},
                    {"action": "act", "instruction": "在标题框输入: {title}"},
                    {"action": "act", "instruction": "在内容框输入: {content}"},
                    {"action": "act", "instruction": "上传图片"},
                    {"action": "act", "instruction": "点击发布"},
                    {"action": "extract", "instruction": "提取发布成功后的笔记URL", "schema": {"note_url": "string"}},
                ],
                "variables": {
                    "title": "今日好物推荐",
                    "content": "...",
                },
                "attachments": ["base64_image_1", "base64_image_2"],
            }
        
        Returns:
            {
                "success": bool,
                "sop_type": str,
                "account_id": str,
                "result": dict,  # extract 步骤的结果
                "screenshots": list,  # 关键节点截图（base64）
                "execution_log": list,  # 步骤执行日志
                "error": str,  # 失败原因
            }
        """
        sop_type = sop_payload.get("sop_type", "unknown")
        account_id = sop_payload.get("account_id", "default")
        steps = sop_payload.get("steps", [])
        variables = sop_payload.get("variables", {})
        
        logger.info(f"开始执行 SOP | type={sop_type} | account={account_id}")
        
        execution_log = []
        screenshots = []
        result = {}
        
        try:
            # 获取或创建浏览器会话
            session = await self._get_session(account_id, sop_payload)
            
            for i, step in enumerate(steps):
                step_result = await self._execute_step(
                    session=session,
                    step=step,
                    variables=variables,
                    step_index=i,
                )
                
                execution_log.append(step_result)
                
                if step_result.get("screenshot"):
                    screenshots.append(step_result["screenshot"])
                
                if step_result.get("extracted"):
                    result.update(step_result["extracted"])
                
                if not step_result.get("success", True):
                    raise Exception(f"步骤 {i+1} 失败: {step_result.get('error')}")
            
            logger.info(f"SOP 执行成功 | type={sop_type} | steps={len(steps)}")
            
            return {
                "success": True,
                "sop_type": sop_type,
                "account_id": account_id,
                "result": result,
                "screenshots": screenshots[-3:],  # 只保留最后3张截图
                "execution_log": execution_log,
                "error": None,
            }
            
        except Exception as e:
            logger.error(f"SOP 执行失败 | type={sop_type} | error={e}")
            
            # 失败时截图（用于排查）
            try:
                session = self._sessions.get(account_id)
                if session:
                    screenshot = await session.screenshot()
                    screenshots.append({"step": "failure_screenshot", "data": screenshot})
            except Exception:
                pass
            
            return {
                "success": False,
                "sop_type": sop_type,
                "account_id": account_id,
                "result": result,
                "screenshots": screenshots,
                "execution_log": execution_log,
                "error": str(e),
            }
    
    async def _execute_step(
        self,
        session,
        step: dict,
        variables: dict,
        step_index: int,
    ) -> dict:
        """执行单个 SOP 步骤"""
        action = step.get("action")
        instruction = step.get("instruction", "")
        
        # 替换变量（{title} → 实际值）
        for key, value in variables.items():
            instruction = instruction.replace(f"{{{key}}}", str(value))
        
        step_log = {
            "step": step_index + 1,
            "action": action,
            "instruction": instruction,
            "started_at": datetime.now(timezone.utc).isoformat(),
        }
        
        try:
            if action == "navigate":
                url = step.get("url", "")
                await session.page.goto(url, wait_until="domcontentloaded")
                step_log["result"] = f"已导航到 {url}"
                
            elif action == "act":
                # Stagehand AI 执行操作
                await session.act(instruction)
                step_log["result"] = f"操作完成: {instruction}"
                
            elif action == "extract":
                # Stagehand AI 提取数据
                schema = step.get("schema", {})
                extracted = await session.extract(instruction, schema)
                step_log["result"] = f"数据提取完成"
                step_log["extracted"] = extracted
                
            elif action == "observe":
                # Stagehand AI 观察页面状态
                observation = await session.observe(instruction)
                step_log["result"] = observation
                
            elif action == "wait":
                seconds = step.get("seconds", 2)
                await asyncio.sleep(seconds)
                step_log["result"] = f"等待 {seconds} 秒"
                
            elif action == "screenshot":
                screenshot = await session.screenshot()
                step_log["screenshot"] = screenshot
                step_log["result"] = "截图完成"
                
            elif action == "upload":
                # 上传文件（图片/视频）
                attachments = step.get("attachments", [])
                await self._upload_files(session, attachments)
                step_log["result"] = f"上传 {len(attachments)} 个文件"
            
            step_log["success"] = True
            
        except Exception as e:
            step_log["success"] = False
            step_log["error"] = str(e)
            logger.warning(f"步骤 {step_index+1} 失败 | action={action} | error={e}")
        
        step_log["finished_at"] = datetime.now(timezone.utc).isoformat()
        return step_log
    
    async def _get_session(self, account_id: str, sop_payload: dict):
        """获取账号对应的浏览器会话（含 Cookie 隔离）"""
        if account_id not in self._sessions:
            session = await StagehandSession.create(
                account_id=account_id,
                platform=sop_payload.get("platform", ""),
            )
            self._sessions[account_id] = session
        return self._sessions[account_id]
    
    async def _upload_files(self, session, attachments: list):
        """上传文件到浏览器"""
        # 将 base64 文件写到临时目录
        temp_paths = []
        for i, b64_data in enumerate(attachments):
            data = base64.b64decode(b64_data)
            temp_path = Path(f"/tmp/sop_upload_{i}.jpg")
            temp_path.write_bytes(data)
            temp_paths.append(str(temp_path))
        
        # 通过 Playwright 上传
        file_input = session.page.locator("input[type=file]")
        await file_input.set_input_files(temp_paths)
    
    async def cleanup_session(self, account_id: str):
        """清理账号会话（退出登录/释放资源）"""
        if account_id in self._sessions:
            await self._sessions[account_id].close()
            del self._sessions[account_id]


class StagehandSession:
    """
    Stagehand 浏览器会话封装
    每个账号一个独立的浏览器 Profile（Cookie 隔离）
    """
    
    @classmethod
    async def create(cls, account_id: str, platform: str) -> "StagehandSession":
        """创建新的 Stagehand 会话"""
        from stagehand import Stagehand, StagehandConfig
        
        # 账号专属的浏览器 Profile 目录
        profile_dir = Path.home() / ".openclaw" / "browser_profiles" / account_id
        profile_dir.mkdir(parents=True, exist_ok=True)
        
        config = StagehandConfig(
            env="LOCAL",
            model_name="claude-sonnet-4-5",      # 使用 Claude 理解页面
            model_api_key=None,                    # 从环境变量读取
            headless=True,                         # 生产环境无头模式
            verbose=1,
            user_data_dir=str(profile_dir),       # 持久化 Cookie
        )
        
        stagehand = Stagehand(config=config)
        await stagehand.init()
        
        session = cls()
        session.stagehand = stagehand
        session.page = stagehand.page
        session.account_id = account_id
        
        # 恢复已保存的 Cookie（如果有）
        await session._restore_cookies(platform)
        
        return session
    
    async def act(self, instruction: str):
        """AI 驱动执行操作"""
        await self.stagehand.act(instruction)
    
    async def extract(self, instruction: str, schema: dict) -> dict:
        """AI 驱动提取数据"""
        from pydantic import create_model
        # 动态创建 Pydantic 模型
        fields = {k: (str, ...) for k in schema.keys()}
        DynamicModel = create_model("ExtractedData", **fields)
        result = await self.stagehand.extract(instruction, schema=DynamicModel)
        return result.model_dump()
    
    async def observe(self, instruction: str) -> str:
        """AI 驱动观察页面状态"""
        observations = await self.stagehand.observe(instruction)
        return str(observations)
    
    async def screenshot(self) -> str:
        """截图并返回 base64"""
        screenshot_bytes = await self.page.screenshot()
        return base64.b64encode(screenshot_bytes).decode()
    
    async def _restore_cookies(self, platform: str):
        """从本地文件恢复 Cookie"""
        cookie_file = (
            Path.home() / ".openclaw" / "cookies" / f"{self.account_id}_{platform}.json"
        )
        if cookie_file.exists():
            cookies = json.loads(cookie_file.read_text())
            await self.page.context.add_cookies(cookies)
    
    async def save_cookies(self, platform: str):
        """保存 Cookie 到本地文件（登录成功后调用）"""
        cookies = await self.page.context.cookies()
        cookie_file = (
            Path.home() / ".openclaw" / "cookies" / f"{self.account_id}_{platform}.json"
        )
        cookie_file.parent.mkdir(parents=True, exist_ok=True)
        cookie_file.write_text(json.dumps(cookies))
    
    async def close(self):
        """关闭会话"""
        await self.stagehand.close()
```

---

## 四、标准 SOP 模板库

```yaml
# edge-runtime/sop_templates/publish_xiaohongshu.yaml
name: 小红书发帖 SOP
platform: xiaohongshu
steps:
  - action: navigate
    url: "https://creator.xiaohongshu.com/publish/publish"
  
  - action: act
    instruction: "等待页面加载完成后，点击上传图文按钮"
  
  - action: upload
    attachments: "{images}"
  
  - action: act
    instruction: "在标题输入框中输入: {title}"
  
  - action: act
    instruction: "在正文内容区域输入: {content}"
  
  - action: act
    instruction: "添加话题标签，输入: {hashtags}"
  
  - action: screenshot
    description: "发布前截图确认"
  
  - action: act
    instruction: "点击发布按钮"
  
  - action: extract
    instruction: "提取发布成功后显示的笔记链接"
    schema:
      note_url: "发布成功的笔记URL"
      note_id: "笔记ID"
```

---

## 五、requirements 更新

```txt
# edge-runtime/requirements.txt 新增

stagehand>=0.3.0
playwright>=1.40.0
```

---

## 六、验收标准

- [ ] `StagehandSession.create()` 正确初始化（含 headless 模式）
- [ ] `MarionetteExecutor.execute()` 支持 act/extract/observe/navigate/upload 全部 action
- [ ] 账号 Cookie 持久化（重启后不需要重新登录）
- [ ] 多账号 Profile 隔离（account_001 和 account_002 完全独立）
- [ ] `publish_xiaohongshu` SOP：能完整执行"导航→上传→填写→发布"全流程
- [ ] 变量替换正确：`{title}` 被替换为实际标题内容
- [ ] 失败时自动截图（便于排查）
- [ ] 执行日志记录每步操作和耗时
- [ ] 与 EdgeScheduler 集成：定时 SOP 触发时调用 MarionetteExecutor
- [ ] 与 wss_receiver 集成：云端下发 SOP 任务包时能正确执行
