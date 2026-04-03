# CODEX TASK: Browser-Use + Camoufox 反检测浏览器执行层
**任务ID**: CODEX-BROWSERUSE-P1-001  
**优先级**: 🟠 P1（AI驱动浏览器控制 + 反检测防封号，边缘执行层升级）  
**依赖文件**: `edge-runtime/marionette_executor.py`（Stagehand P0已升级）  
**参考项目**: Browser-Use（https://github.com/browser-use/browser-use）、Camoufox（https://github.com/daijro/camoufox）  
**预计工期**: 2天

---

## 一、为什么 Stagehand + Camoufox 双剑合璧

**Stagehand（P0已落地）**：AI 理解"发布按钮"在哪里 → **理解层**  
**Browser-Use**：AI Agent 自主规划多步骤浏览器任务 → **规划层**（本 Task 部分引入）  
**Camoufox**：伪装真实用户浏览器指纹，防平台检测封号 → **隐身层**（本 Task 核心）

**核心问题**：小红书/抖音/微博都有机器人检测：
- `navigator.webdriver` 属性检测
- TLS 指纹检测（Playwright 的 TLS 特征被标记）
- Canvas/WebGL 指纹检测
- 鼠标移动轨迹异常检测

**Camoufox 解决**：基于 Firefox 的 CDP，天然绕过 Chromium 特征检测，是目前最强的反检测方案。

---

## 二、Camoufox 集成到 StagehandSession

```python
# edge-runtime/marionette_executor.py — StagehandSession 升级

class StagehandSession:
    """
    升级版：支持 Camoufox 反检测浏览器
    """
    
    # 平台检测风险等级
    PLATFORM_RISK = {
        "xiaohongshu": "HIGH",    # 严格反爬
        "douyin": "HIGH",         # 严格反爬
        "weibo": "MEDIUM",        # 中等
        "wechat": "HIGH",         # 严格
        "default": "LOW",
    }
    
    @classmethod
    async def create(cls, account_id: str, platform: str) -> "StagehandSession":
        """
        根据平台风险等级选择浏览器：
        - HIGH：Camoufox（反检测 Firefox）
        - LOW：Stagehand + Chromium（普通，更快）
        """
        risk = cls.PLATFORM_RISK.get(platform, "LOW")
        
        if risk == "HIGH":
            return await cls._create_camoufox_session(account_id, platform)
        else:
            return await cls._create_stagehand_session(account_id, platform)
    
    @classmethod
    async def _create_camoufox_session(cls, account_id: str, platform: str):
        """
        创建 Camoufox 反检测会话
        
        Camoufox 特性：
        - 基于 Firefox，绕过 Chromium 特征检测
        - 随机化 User-Agent / Canvas / WebGL 指纹
        - 鼠标轨迹人性化
        - geoip 参数设置真实地理位置
        """
        from camoufox.async_api import AsyncCamoufox
        
        profile_dir = _get_profile_dir(account_id)
        
        # Camoufox 配置（模拟真实用户）
        camoufox_kwargs = {
            "headless": "virtual",     # 虚拟显示（比 True 更难检测）
            "geoip": True,            # 根据 IP 自动设置地理位置
            "humanize": True,         # 人性化鼠标轨迹
            "persistent_context": str(profile_dir),  # 持久化 Profile
            "i_know_what_im_doing": True,  # 声明用于合规测试
        }
        
        browser = AsyncCamoufox(**camoufox_kwargs)
        await browser.__aenter__()
        
        page = await browser.new_page()
        
        session = cls()
        session.browser = browser
        session.page = page
        session.account_id = account_id
        session.platform = platform
        session.use_camoufox = True
        
        # 恢复 Cookie
        await session._restore_cookies(platform)
        
        return session
    
    @classmethod
    async def _create_stagehand_session(cls, account_id: str, platform: str):
        """创建普通 Stagehand 会话（低风险平台）"""
        from stagehand import Stagehand, StagehandConfig
        
        profile_dir = _get_profile_dir(account_id)
        config = StagehandConfig(
            env="LOCAL",
            model_name="claude-sonnet-4-5",
            headless=True,
            user_data_dir=str(profile_dir),
        )
        stagehand = Stagehand(config=config)
        await stagehand.init()
        
        session = cls()
        session.stagehand = stagehand
        session.page = stagehand.page
        session.account_id = account_id
        session.platform = platform
        session.use_camoufox = False
        
        await session._restore_cookies(platform)
        return session
    
    async def act(self, instruction: str):
        """
        AI 执行操作
        - Camoufox 会话：用 Playwright API + 人性化延时
        - Stagehand 会话：用 Stagehand.act()
        """
        if self.use_camoufox:
            await self._camoufox_act(instruction)
        else:
            await self.stagehand.act(instruction)
    
    async def _camoufox_act(self, instruction: str):
        """
        Camoufox 模式下的 AI 操作执行
        结合 LLM 理解指令 + Playwright 执行 + 人性化行为
        """
        import asyncio
        import random
        
        # 用 LLM 将自然语言指令转换为 Playwright 动作
        action = await self._llm_parse_action(instruction)
        
        # 人性化延时（模拟真实用户思考）
        await asyncio.sleep(random.uniform(0.5, 2.0))
        
        if action["type"] == "click":
            element = self.page.locator(action["selector"])
            # 人性化点击（随机偏移）
            box = await element.bounding_box()
            if box:
                x = box["x"] + box["width"] * random.uniform(0.3, 0.7)
                y = box["y"] + box["height"] * random.uniform(0.3, 0.7)
                await self.page.mouse.move(x, y)
                await asyncio.sleep(random.uniform(0.1, 0.3))
                await self.page.mouse.click(x, y)
        
        elif action["type"] == "type":
            element = self.page.locator(action["selector"])
            await element.click()
            # 逐字输入（模拟真实打字）
            for char in action["text"]:
                await element.type(char)
                await asyncio.sleep(random.uniform(0.05, 0.15))
        
        elif action["type"] == "scroll":
            await self.page.mouse.wheel(0, action.get("delta_y", 300))
    
    async def _llm_parse_action(self, instruction: str) -> dict:
        """
        用 LLM 将自然语言指令解析为 Playwright 动作
        
        输入："点击发布按钮"
        输出：{"type": "click", "selector": "button[data-action='publish']"}
        """
        from anthropic import Anthropic
        
        client = Anthropic()
        
        # 获取页面 DOM 快照（用于理解页面结构）
        dom_content = await self.page.evaluate("""
            () => {
                const elements = document.querySelectorAll(
                    'button, a, input, textarea, [role="button"]'
                );
                return Array.from(elements).slice(0, 50).map(el => ({
                    tag: el.tagName,
                    text: el.innerText?.slice(0, 50),
                    id: el.id,
                    class: el.className?.slice(0, 100),
                    type: el.type,
                }));
            }
        """)
        
        response = client.messages.create(
            model="claude-haiku-4-5",  # 用轻量模型解析即可
            max_tokens=200,
            messages=[{
                "role": "user",
                "content": f"""页面可交互元素：{dom_content}
                
指令：{instruction}

返回 JSON：{{"type": "click|type|scroll", "selector": "CSS选择器", "text": "输入文本（仅type时）"}}
只返回 JSON，不要其他内容。"""
            }]
        )
        
        import json
        return json.loads(response.content[0].text)
    
    async def close(self):
        """关闭会话"""
        if self.use_camoufox:
            await self.browser.__aexit__(None, None, None)
        else:
            await self.stagehand.close()


def _get_profile_dir(account_id: str):
    from pathlib import Path
    profile_dir = Path.home() / ".openclaw" / "browser_profiles" / account_id
    profile_dir.mkdir(parents=True, exist_ok=True)
    return profile_dir
```

---

## 三、账号健康度监控

```python
# edge-runtime/account_health_monitor.py（新建）
"""
账号健康度监控
检测账号是否被平台限流/封禁，及时告警
"""

class AccountHealthMonitor:
    """
    检测账号健康状态：
    - 发布后检查是否显示"违规提示"
    - 检查账号是否被限流（视频播放量异常低）
    - 检查是否需要验证码
    """
    
    RISK_SIGNALS = {
        "xiaohongshu": [
            "您的账号存在异常",
            "内容审核中",
            "请完成验证",
            "账号已被限制",
        ],
        "douyin": [
            "账号异常",
            "滑动验证",
            "操作频繁",
        ],
    }
    
    async def check_after_action(self, session, platform: str) -> dict:
        """执行 SOP 后检查账号健康状态"""
        signals = self.RISK_SIGNALS.get(platform, [])
        
        page_text = await session.page.evaluate(
            "() => document.body.innerText"
        )
        
        detected_risks = [s for s in signals if s in page_text]
        
        if detected_risks:
            return {
                "healthy": False,
                "risks": detected_risks,
                "action": "pause_account",  # 暂停该账号的自动化
                "alert": True,
            }
        
        return {"healthy": True, "risks": [], "action": "continue"}
```

---

## 四、requirements 更新

```txt
# edge-runtime/requirements.txt 新增

camoufox[geoip]>=0.4.0   # 含地理位置数据库
browser-use>=0.1.0        # 可选：规划层
```

---

## 五、验收标准

- [ ] `StagehandSession.create()` 根据平台风险自动选择浏览器类型
- [ ] HIGH 风险平台（小红书/抖音）：使用 Camoufox（Firefox 内核）
- [ ] LOW 风险平台：使用 Stagehand + Chromium（速度优先）
- [ ] Camoufox `humanize=True` 鼠标轨迹人性化生效
- [ ] 账号 Cookie 在 Camoufox + Stagehand 两种模式下均可持久化
- [ ] `AccountHealthMonitor.check_after_action()` 能检测常见风险信号
- [ ] 小红书发帖 SOP 在 Camoufox 模式下完整执行，不触发机器人检测
- [ ] 多账号并发时各账号 Profile 完全隔离（不共享 Cookie）
