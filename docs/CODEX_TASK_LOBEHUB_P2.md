# CODEX TASK: LobeHub P2 — 可视化配置器 + 微信适配器 + 技能市场 + 代码沙箱 + OpenAPI

**来源**：LOBEHUB_BORROWING_ANALYSIS.md  
**优先级**：P2（计划落地）  
**借鉴自**：LobeHub AgentBuilder / chat-adapter-wechat / SkillStore / builtin-tool-cloud-sandbox / openapi package  
**日期**：2026-04-02

---

## Task 1: 龙虾可视化配置器（前端 AgentBuilder 页面）

**借鉴**：LobeHub `src/features/AgentBuilder/`（图形化配置 Agent 角色卡/技能/参数）

**核心价值**：目前配置龙虾需要编辑 YAML/JSON 文件，运营人员难以操作。引入图形化配置界面。

**设计思路（前端页面规划）**：
```
龙虾配置器页面（/lobsters/[id]/configure）
├── 基本信息区
│   ├── 龙虾名称（输入框）
│   ├── 角色代号（选择：radar/strategist/inkwriter/...）
│   ├── 角色描述（文本区域）
│   └── 头像选择（预设头像库 or 上传）
├── 系统提示词区
│   ├── 核心人设（富文本编辑器）
│   ├── 执行规则（列表编辑器）
│   ├── 红线禁区（列表编辑器，来自 LOBSTER_CONSTITUTION）
│   └── 版本历史（diff 对比）
├── 技能配置区
│   ├── 已启用技能（拖拽排序）
│   ├── 从技能市场添加（弹窗选择）
│   └── 自定义技能（编辑器）
├── 模型参数区
│   ├── 默认模型（下拉选择，provider_registry 列表）
│   ├── Temperature 滑块（0.0 - 1.0）
│   ├── Max Tokens 输入
│   └── 阶段温度配置（探索/执行/评估 三段温度）
└── 测试区
    ├── 输入测试任务
    ├── 实时执行结果预览
    └── Token 消耗统计
```

**后端 API 接口**：
```python
# 新增到 dragon-senate-saas-v2/app.py

# GET /api/lobsters/{lobster_id}/config
# 获取龙虾配置（供配置器页面加载）

# PUT /api/lobsters/{lobster_id}/config
# 保存龙虾配置（含系统提示词/技能/模型参数）

# POST /api/lobsters/{lobster_id}/test
# 测试运行（单次，返回执行结果 + token 统计）

# GET /api/lobsters/{lobster_id}/config/history
# 获取配置历史（支持回滚）
```

**验收标准**：
- [ ] 前端新增龙虾配置器页面（`/lobsters/[id]/configure`）
- [ ] 系统提示词可视化编辑（富文本 + 版本历史）
- [ ] 技能列表可拖拽排序
- [ ] Temperature 滑块可视化调节
- [ ] 测试区可实时预览龙虾执行结果
- [ ] 配置修改后自动保存（debounce 2s）
- [ ] 后端 API 支持配置持久化和历史回滚

---

## Task 2: 微信 IM 适配器升级（升级 lobster_im_channel.py）

**借鉴**：LobeHub `packages/chat-adapter-wechat`（企微/个微/公众号消息适配器，统一接口）

**核心业务**：龙虾需要通过微信与线索沟通，涉及三种微信场景。

```python
# 升级 dragon-senate-saas-v2/lobster_im_channel.py

from dataclasses import dataclass
from enum import Enum

class WechatScenario(Enum):
    """微信使用场景"""
    WECHAT_WORK = "wechat_work"        # 企业微信（主要场景）
    WECHAT_OA = "wechat_oa"            # 微信公众号（内容触达）
    PERSONAL_WECHAT = "personal_wechat"  # 个人微信（高价值线索）

@dataclass
class WechatMessageWindow:
    """
    微信 48 小时客服消息窗口管理
    参考 LobeHub chat-adapter-wechat 的窗口管理
    
    微信规则：用户发消息后 48 小时内可以用客服消息回复
    超过 48 小时只能发模板消息（需要模板审批）
    """
    lead_id: str
    last_user_message_at: float  # timestamp
    window_hours: int = 48
    
    @property
    def is_window_open(self) -> bool:
        import time
        elapsed = time.time() - self.last_user_message_at
        return elapsed < self.window_hours * 3600
    
    @property
    def hours_remaining(self) -> float:
        import time
        elapsed = time.time() - self.last_user_message_at
        remaining = self.window_hours * 3600 - elapsed
        return max(remaining / 3600, 0)

class WechatWorkChannel:
    """
    企业微信渠道（升级版）
    参考 LobeHub chat-adapter 的消息归一化设计
    
    新增：
    - 消息去重（IM 可能重复推送同一消息）
    - 速率保护（避免回复过快触发企微限速）
    - 消息类型归一化（文字/图片/文件/卡片 → 统一 ChatMessage）
    """
    
    def __init__(self, corp_id: str, agent_id: str, secret: str):
        self.corp_id = corp_id
        self.agent_id = agent_id
        self.secret = secret
        self._dedup_cache = set()  # 消息去重缓存
        self._rate_limiter = {}    # 每个线索的发送时间记录
    
    async def send_text(
        self, 
        to_user: str, 
        content: str,
        rate_limit_seconds: float = 1.5,  # 发送间隔限制
    ) -> dict:
        """
        发送文字消息
        参考 LobeHub chat-adapter 的速率保护设计
        """
        # 速率保护
        await self._rate_guard(to_user, rate_limit_seconds)
        
        token = await self._get_access_token()
        import httpx
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://qyapi.weixin.qq.com/cgi-bin/message/send",
                params={"access_token": token},
                json={
                    "touser": to_user,
                    "msgtype": "text",
                    "agentid": self.agent_id,
                    "text": {"content": content},
                    "safe": 0,
                }
            )
        result = resp.json()
        return {"success": result.get("errcode") == 0, "raw": result}
    
    async def send_markdown(self, to_user: str, content: str) -> dict:
        """发送 Markdown 格式消息（企微支持）"""
        token = await self._get_access_token()
        import httpx
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://qyapi.weixin.qq.com/cgi-bin/message/send",
                params={"access_token": token},
                json={
                    "touser": to_user,
                    "msgtype": "markdown",
                    "agentid": self.agent_id,
                    "markdown": {"content": content},
                }
            )
        return {"success": resp.json().get("errcode") == 0}
    
    async def receive_event(self, xml_body: str, signature: str, timestamp: str, nonce: str) -> dict:
        """
        接收企微推送事件（含签名验证）
        参考 LobeHub chat-adapter 的签名验证设计
        """
        # 签名验证（防伪造）
        if not self._verify_signature(signature, timestamp, nonce):
            raise ValueError("企微消息签名验证失败")
        
        # XML 解析
        import xml.etree.ElementTree as ET
        root = ET.fromstring(xml_body)
        
        msg_id = root.findtext("MsgId", "")
        
        # 消息去重（企微可能重复推送）
        if msg_id in self._dedup_cache:
            return {"duplicate": True, "msg_id": msg_id}
        self._dedup_cache.add(msg_id)
        if len(self._dedup_cache) > 10000:  # 防止缓存无限增长
            self._dedup_cache.clear()
        
        return {
            "duplicate": False,
            "msg_id": msg_id,
            "from_user": root.findtext("FromUserName", ""),
            "msg_type": root.findtext("MsgType", ""),
            "content": root.findtext("Content", ""),
            "timestamp": root.findtext("CreateTime", ""),
        }
    
    async def _rate_guard(self, user_id: str, min_interval: float):
        """发送速率保护（避免触发企微限速或封号）"""
        import time, asyncio
        last_send = self._rate_limiter.get(user_id, 0)
        elapsed = time.time() - last_send
        if elapsed < min_interval:
            await asyncio.sleep(min_interval - elapsed)
        self._rate_limiter[user_id] = time.time()
    
    def _verify_signature(self, signature: str, timestamp: str, nonce: str) -> bool:
        """企微消息签名验证"""
        import hashlib
        token = "your_wechat_token"  # 从配置读取
        strs = sorted([token, timestamp, nonce])
        check = hashlib.sha1("".join(strs).encode()).hexdigest()
        return check == signature
    
    async def _get_access_token(self) -> str:
        """获取企微 access_token（带缓存）"""
        # 实际实现需要缓存（2小时有效期）
        import httpx
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                "https://qyapi.weixin.qq.com/cgi-bin/gettoken",
                params={"corpid": self.corp_id, "corpsecret": self.secret}
            )
        return resp.json().get("access_token", "")

class WechatOAChannel:
    """
    微信公众号渠道
    主要用于内容触达 + 模板消息
    """
    
    def __init__(self, app_id: str, app_secret: str):
        self.app_id = app_id
        self.app_secret = app_secret
    
    async def send_template_message(
        self,
        open_id: str,
        template_id: str,
        data: dict,
        url: str = None,
    ) -> dict:
        """发送模板消息（不受 48 小时窗口限制）"""
        token = await self._get_access_token()
        import httpx
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://api.weixin.qq.com/cgi-bin/message/template/send",
                params={"access_token": token},
                json={
                    "touser": open_id,
                    "template_id": template_id,
                    "url": url,
                    "data": data,
                }
            )
        return resp.json()
    
    async def _get_access_token(self) -> str:
        import httpx
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                "https://api.weixin.qq.com/cgi-bin/token",
                params={"grant_type": "client_credential", "appid": self.app_id, "secret": self.app_secret}
            )
        return resp.json().get("access_token", "")
```

**验收标准**：
- [ ] 企微渠道增加消息去重（同一 MsgId 不重复处理）
- [ ] 企微渠道增加速率保护（每条消息发送间隔 ≥ 1.5s）
- [ ] 企微渠道增加签名验证（防伪造消息注入）
- [ ] 新增 `WechatOAChannel` 公众号渠道（模板消息）
- [ ] 48 小时窗口管理：窗口关闭时自动切换为模板消息
- [ ] `IMChannelRouter` 统一路由企微/公众号/飞书/钉钉

---

## Task 3: 龙虾技能市场（前端 SkillStore 页面）

**借鉴**：LobeHub `src/features/SkillStore/`（可浏览/安装 Agent 技能的市场页面）

**设计思路**：
```
技能市场页面（/skills/store）
├── 搜索/筛选栏
│   ├── 关键词搜索
│   ├── 按龙虾类型筛选（雷达/苏思/墨小雅/...）
│   ├── 按技能类型筛选（搜索/分析/写作/跟进）
│   └── 按热度排序
├── 技能卡片列表
│   ├── 技能名称 + 描述
│   ├── 适用龙虾标签
│   ├── 使用次数 + 评分
│   └── 一键安装按钮
├── 技能详情页
│   ├── 完整描述
│   ├── 使用示例（示例输入→输出）
│   ├── 版本历史
│   └── 用户评价
└── 我的技能
    ├── 已安装技能列表
    ├── 技能使用统计
    └── 自定义技能上传
```

**后端数据结构**：
```python
# 技能市场数据模型（新增到 dragon-senate-saas-v2/skill_frontmatter.py）

SKILL_STORE_SCHEMA = {
    "skill_id": str,          # 唯一ID
    "name": str,              # 技能名称
    "description": str,       # 技能描述
    "compatible_lobsters": list[str],  # 适用龙虾列表
    "skill_type": str,        # search/analyze/write/followup/dispatch
    "version": str,           # 版本号
    "author": str,            # 作者
    "install_count": int,     # 安装次数
    "avg_rating": float,      # 平均评分
    "tags": list[str],        # 标签
    "frontmatter": str,       # 技能 YAML 内容
    "examples": list[dict],   # 使用示例
    "is_official": bool,      # 是否官方技能
    "price": float,           # 价格（0=免费）
}
```

**验收标准**：
- [ ] 前端新增技能市场页面（`/skills/store`）
- [ ] 技能卡片展示（名称/描述/适用龙虾/安装量）
- [ ] 支持按龙虾类型和技能类型筛选
- [ ] 一键安装：安装后自动添加到对应龙虾的技能列表
- [ ] 技能详情页含使用示例
- [ ] 官方技能标记（LobeHub 的 "Built by LobeHub" 概念）
- [ ] 租户可上传自定义技能（需审核）

---

## Task 4: 龙虾代码执行沙箱（code_sandbox.py）

**借鉴**：LobeHub `packages/builtin-tool-cloud-sandbox`（Agent 可执行 Python 代码进行数据分析）

**主要使用场景**：算无遗策（abacus-suanwuyice）执行数据分析和 ROI 计算

```python
# dragon-senate-saas-v2/code_sandbox.py（新建）

import asyncio
import json
from dataclasses import dataclass

@dataclass
class SandboxResult:
    """代码执行结果"""
    success: bool
    stdout: str           # 标准输出
    stderr: str           # 错误输出
    return_value: any     # 返回值（JSON 序列化）
    execution_time_ms: int
    error: str = None

class LobsterCodeSandbox:
    """
    龙虾代码执行沙箱
    参考 LobeHub builtin-tool-cloud-sandbox 设计
    
    主要使用场景（算无遗策/abacus-suanwuyice）：
    - ROI 计算（输入成本/收益参数 → 计算 ROI 表格）
    - 数据分析（对线索数据做统计分析）
    - 图表生成（生成 matplotlib 图表）
    - 报价计算（根据参数计算报价方案）
    
    安全限制：
    - 只允许白名单模块（pandas/numpy/matplotlib/json/math/datetime）
    - 超时限制（默认 30s）
    - 内存限制（默认 256MB）
    - 禁止网络访问（沙箱内禁止 urllib/requests/httpx）
    - 禁止文件系统写入（只允许读 /tmp/sandbox/）
    """
    
    ALLOWED_MODULES = {
        "pandas", "numpy", "matplotlib", "json", "math",
        "datetime", "statistics", "decimal", "re", "collections",
        "itertools", "functools", "operator",
    }
    
    BLOCKED_MODULES = {
        "os", "sys", "subprocess", "socket", "urllib",
        "requests", "httpx", "aiohttp", "ftplib", "smtplib",
        "importlib", "builtins.__import__",
    }
    
    def __init__(self, timeout_seconds: int = 30):
        self.timeout_seconds = timeout_seconds
    
    async def execute(self, code: str, context: dict = None) -> SandboxResult:
        """
        执行 Python 代码
        code: 要执行的 Python 代码
        context: 预置变量（如线索数据、配置参数）
        """
        start = asyncio.get_event_loop().time()
        
        # 安全检查（静态分析）
        safety_check = self._safety_check(code)
        if not safety_check["safe"]:
            return SandboxResult(
                success=False,
                stdout="",
                stderr=safety_check["reason"],
                return_value=None,
                execution_time_ms=0,
                error="SECURITY_VIOLATION",
            )
        
        # 构建执行环境
        exec_globals = self._build_safe_globals()
        if context:
            exec_globals.update(context)
        
        # 捕获输出
        import io
        stdout_capture = io.StringIO()
        
        try:
            # 执行（带超时）
            result = await asyncio.wait_for(
                self._run_code(code, exec_globals, stdout_capture),
                timeout=self.timeout_seconds,
            )
            elapsed_ms = int((asyncio.get_event_loop().time() - start) * 1000)
            return SandboxResult(
                success=True,
                stdout=stdout_capture.getvalue(),
                stderr="",
                return_value=result,
                execution_time_ms=elapsed_ms,
            )
        except asyncio.TimeoutError:
            return SandboxResult(
                success=False, stdout="", stderr="",
                return_value=None,
                execution_time_ms=self.timeout_seconds * 1000,
                error=f"执行超时（{self.timeout_seconds}s）",
            )
        except Exception as e:
            elapsed_ms = int((asyncio.get_event_loop().time() - start) * 1000)
            return SandboxResult(
                success=False, stdout=stdout_capture.getvalue(),
                stderr=str(e), return_value=None,
                execution_time_ms=elapsed_ms, error=str(e),
            )
    
    async def execute_roi_analysis(self, params: dict) -> SandboxResult:
        """
        ROI 分析专用方法（算无遗策常用）
        params: {cost_per_month, leads_per_month, conversion_rate, deal_size}
        """
        code = f"""
params = {json.dumps(params)}
cost = params.get('cost_per_month', 0)
leads = params.get('leads_per_month', 0)
rate = params.get('conversion_rate', 0.05)
deal = params.get('deal_size', 0)

monthly_revenue = leads * rate * deal
annual_revenue = monthly_revenue * 12
annual_cost = cost * 12
roi = (annual_revenue - annual_cost) / annual_cost * 100 if annual_cost > 0 else 0
payback_months = cost / (monthly_revenue) if monthly_revenue > 0 else float('inf')

result = {{
    "monthly_revenue": round(monthly_revenue, 2),
    "annual_revenue": round(annual_revenue, 2),
    "annual_cost": round(annual_cost, 2),
    "roi_percent": round(roi, 1),
    "payback_months": round(payback_months, 1) if payback_months != float('inf') else 999,
    "is_profitable": roi > 0,
}}
print(f"月收入: ¥{{monthly_revenue:,.0f}}")
print(f"年ROI: {{roi:.1f}}%")
print(f"回本周期: {{payback_months:.1f}}个月")
result
"""
        return await self.execute(code)
    
    def _safety_check(self, code: str) -> dict:
        """静态安全检查"""
        for blocked in self.BLOCKED_MODULES:
            if blocked in code:
                return {"safe": False, "reason": f"禁止使用模块: {blocked}"}
        dangerous_patterns = ["__import__", "eval(", "exec(", "compile(", "open("]
        for pattern in dangerous_patterns:
            if pattern in code:
                return {"safe": False, "reason": f"禁止使用: {pattern}"}
        return {"safe": True}
    
    def _build_safe_globals(self) -> dict:
        """构建安全的执行环境"""
        import math
        safe_globals = {
            "__builtins__": {
                "print": print, "len": len, "range": range, "int": int,
                "float": float, "str": str, "list": list, "dict": dict,
                "tuple": tuple, "set": set, "bool": bool, "round": round,
                "abs": abs, "sum": sum, "min": min, "max": max,
                "sorted": sorted, "enumerate": enumerate, "zip": zip,
                "map": map, "filter": filter, "isinstance": isinstance,
            },
            "math": math,
            "json": json,
        }
        # 动态加载白名单模块
        for mod_name in ["pandas", "numpy"]:
            try:
                import importlib
                safe_globals[mod_name] = importlib.import_module(mod_name)
            except ImportError:
                pass
        return safe_globals
    
    async def _run_code(self, code: str, globals_: dict, stdout) -> any:
        """实际执行代码"""
        import sys
        old_stdout = sys.stdout
        sys.stdout = stdout
        try:
            local_vars = {}
            exec(code, globals_, local_vars)
            # 如果有 result 变量，返回它
            return local_vars.get("result")
        finally:
            sys.stdout = old_stdout
```

**验收标准**：
- [ ] 新建 `code_sandbox.py`，`LobsterCodeSandbox.execute()` 可正常调用
- [ ] 禁止使用网络/文件系统/系统命令（安全检查）
- [ ] 超时保护（默认 30s，可配置）
- [ ] `execute_roi_analysis()` 快捷方法，算无遗策可直接调用
- [ ] 算无遗策技能中增加代码执行能力
- [ ] 执行结果（输出 + 耗时 + 错误）存入 `artifact_store`

---

## Task 5: OpenAPI 规范文档（升级 api_governance_routes.py）

**借鉴**：LobeHub `packages/openapi`（对外 API 规范化，生成 OpenAPI spec，支持第三方集成）

**设计思路**：
```python
# 升级 dragon-senate-saas-v2/api_governance_routes.py

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

def custom_openapi(app: FastAPI) -> dict:
    """
    生成 OpenAPI 规范文档
    参考 LobeHub openapi package 的规范化设计
    """
    if app.openapi_schema:
        return app.openapi_schema
    
    openapi_schema = get_openapi(
        title="OpenClaw API",
        version="v1.0.0",
        description="""
## OpenClaw — AI 销售龙虾战队 API

通过 OpenClaw API，您可以：
- 调用 9 只专业销售龙虾执行任务
- 管理线索跟进序列
- 查询执行报告和转化统计
- 配置龙虾角色和技能

### 认证
所有 API 需要在 Header 中携带 API Key：
```
Authorization: Bearer oclaw_xxxxx
```

### 频率限制
- 免费版：100 次/天
- 专业版：10,000 次/天  
- 企业版：无限制
        """,
        routes=app.routes,
        tags=[
            {"name": "lobsters", "description": "龙虾管理和任务执行"},
            {"name": "leads", "description": "线索管理和转化追踪"},
            {"name": "sequences", "description": "跟进序列管理"},
            {"name": "reports", "description": "执行报告和统计"},
            {"name": "webhooks", "description": "Webhook 事件订阅"},
        ],
    )
    
    # 添加安全方案
    openapi_schema["components"]["securitySchemes"] = {
        "BearerAuth": {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
            "description": "API Key（格式：oclaw_xxxxx）",
        }
    }
    openapi_schema["security"] = [{"BearerAuth": []}]
    
    # 添加联系信息
    openapi_schema["info"]["contact"] = {
        "name": "OpenClaw 技术支持",
        "email": "support@openclaw.ai",
        "url": "https://docs.openclaw.ai",
    }
    
    app.openapi_schema = openapi_schema
    return app.openapi_schema

# 核心对外 API 路由示例

@app.post("/v1/lobsters/{lobster_id}/run", tags=["lobsters"])
async def run_lobster(
    lobster_id: str,
    body: LobsterRunRequest,
) -> LobsterRunResponse:
    """
    执行龙虾任务
    
    调用指定龙虾执行特定任务，支持传入线索 ID 和自定义任务描述。
    
    **可用龙虾**：
    - `dispatcher-laojian` — 老健（任务分配）
    - `strategist-susi` — 苏思（策略分析）
    - `inkwriter-moxiaoya` — 墨小雅（内容创作）
    - `radar-lintao` — 林桃（线索调研）
    - `echoer-asheng` — 阿声（破冰触达）
    - `catcher-tiegou` — 铁狗（需求确认）
    - `abacus-suanwuyice` — 算无遗策（数据分析）
    - `followup-xiaochui` — 小锤（跟进提醒）
    - `visualizer-shadow` — 影子（可视化报告）
    """
    ...

@app.post("/v1/sequences/start", tags=["sequences"])
async def start_sequence(body: SequenceStartRequest) -> SequenceResponse:
    """
    启动跟进序列
    
    为指定线索启动预定义的跟进序列（如冷启动7天序列）。
    """
    ...

@app.get("/v1/leads/{lead_id}/conversion", tags=["leads"])
async def get_conversion_status(lead_id: str) -> ConversionStatusResponse:
    """
    查询线索转化状态
    
    返回线索的7级漏斗状态：unknown → aware → interested → considering → decided → converted → lost
    """
    ...
```

**Webhook 事件文档**：
```yaml
# 可订阅的 Webhook 事件
events:
  lobster.task.completed:
    description: 龙虾任务执行完成
    payload:
      task_id: string
      lobster_id: string
      lead_id: string
      result_summary: string
      execution_time_ms: integer
  
  lead.status.changed:
    description: 线索转化状态变更
    payload:
      lead_id: string
      old_status: string
      new_status: string
      changed_by: string  # lobster_id
  
  sequence.completed:
    description: 跟进序列全部执行完毕
    payload:
      sequence_id: string
      lead_id: string
      steps_completed: integer
      final_status: string
```

**验收标准**：
- [ ] FastAPI 自动生成 OpenAPI JSON（`/openapi.json`）
- [ ] Swagger UI 可访问（`/docs`）
- [ ] ReDoc 文档可访问（`/redoc`）
- [ ] 所有对外 API 有完整的 description 和 example
- [ ] Webhook 事件有文档说明
- [ ] API Key 认证在文档中明确说明
- [ ] 生成的 OpenAPI spec 可导入 Postman/Apifox

---

## 联动关系

```
Task 1 (龙虾配置器) → 配置后影响
  Task 4 的执行参数（温度/模型/技能）

Task 2 (微信适配器) → 升级 lobster_im_channel
  → 支持 Task 1 中配置的渠道路由策略

Task 3 (技能市场) → 技能安装后
  → 可以在 Task 1 配置器中启用
  → 部分技能依赖 Task 4 (代码沙箱) 能力

Task 5 (OpenAPI) → 对外暴露
  → Task 2 (微信消息接收 webhook)
  → Task 4 (代码执行 API)
```

---

*借鉴来源：LobeHub AgentBuilder + chat-adapter-wechat + SkillStore + builtin-tool-cloud-sandbox + openapi | 2026-04-02*
