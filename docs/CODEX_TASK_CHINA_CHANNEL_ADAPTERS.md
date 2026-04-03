# Codex 任务：创建中国大陆 7 平台渠道适配器

## 任务背景

我们的项目 `dragon-senate-saas-v2/` 已有 3 个渠道适配器（飞书/钉钉/Telegram），现在需要扩展 7 个中国大陆平台的渠道适配器。

**你的任务**：
1. 创建 `BaseChannelAdapter` 基类
2. 创建 7 个平台适配器（抖音/小红书/快手/淘宝/京东/拼多多/微信）
3. 更新 `app.py` 中的渠道路由

---

## 已有参考代码

现有适配器在 `dragon-senate-saas-v2/feishu_channel.py`，核心模式如下：

```python
from __future__ import annotations
import json, os, time
from dataclasses import dataclass
from typing import Any
import httpx

def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    return raw in {"1", "true", "yes", "on"} if raw else default

@dataclass(slots=True)
class ChatEnvelope:
    channel: str
    chat_id: str
    user_text: str
    user_id: str
    raw: dict[str, Any]

class FeishuChannelAdapter:
    def __init__(self) -> None:
        self.enabled = False
        self.reply_mode = "webhook"
        self.bot_webhook = ""
        self.app_id = ""
        self.app_secret = ""
        self._tenant_token: str | None = None
        self._tenant_token_exp: int = 0
        self.reload_from_env()

    def reload_from_env(self) -> None:
        self.enabled = _env_bool("FEISHU_ENABLED", False)
        self.reply_mode = os.getenv("FEISHU_REPLY_MODE", "webhook").strip().lower()
        self.bot_webhook = os.getenv("FEISHU_BOT_WEBHOOK", "").strip()
        self.app_id = os.getenv("FEISHU_APP_ID", "").strip()
        self.app_secret = os.getenv("FEISHU_APP_SECRET", "").strip()

    def parse_event(self, payload: dict[str, Any]) -> ChatEnvelope | None:
        # ... 解析 webhook payload 为统一 ChatEnvelope ...

    async def reply(self, *, chat_id: str, text: str, client: httpx.AsyncClient | None = None) -> dict[str, Any]:
        # ... 发送回复 ...

    def describe(self) -> dict[str, Any]:
        return { "enabled": self.enabled, ... }

feishu_channel = FeishuChannelAdapter()  # 模块级单例
```

另一个参考 `dragon-senate-saas-v2/dingtalk_channel.py` 结构完全相同。

---

## 任务 0：创建 BaseChannelAdapter 基类

**文件路径**: `dragon-senate-saas-v2/base_channel.py`

```python
"""
BaseChannelAdapter — 所有渠道适配器的统一基类

现有的 FeishuChannelAdapter / DingTalkChannelAdapter 暂不修改，
新建的 7 个适配器继承此基类。未来可逐步统一。
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

import httpx


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    return raw in {"1", "true", "yes", "on"} if raw else default


def _env_str(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


@dataclass(slots=True)
class ChannelMessage:
    """统一消息信封 — 所有平台入站消息的标准格式"""
    channel: str              # "douyin" | "xiaohongshu" | "kuaishou" | "taobao" | "jd" | "pdd" | "wechat"
    chat_id: str              # 会话/用户标识
    user_text: str            # 用户消息文本
    user_id: str              # 平台用户ID
    message_type: str = "text"  # "text" | "image" | "video" | "comment" | "dm" | "review"
    platform_meta: dict[str, Any] = field(default_factory=dict)  # 平台特有元数据
    raw: dict[str, Any] = field(default_factory=dict)            # 原始 payload


class BaseChannelAdapter:
    """
    所有渠道适配器的基类。
    
    子类必须:
    1. 设置 channel_id
    2. 实现 reload_from_env()
    3. 实现 parse_event()
    4. 实现 reply()
    5. 按需实现 publish() / fetch_comments() / fetch_dms() / send_dm()
    """

    channel_id: str = "unknown"

    def __init__(self) -> None:
        self.enabled: bool = False
        self._http_client: httpx.AsyncClient | None = None
        self.reload_from_env()

    def reload_from_env(self) -> None:
        """从环境变量重新加载配置。子类必须 override 并调用 super()。"""
        pass

    async def _get_client(self, external: httpx.AsyncClient | None = None) -> tuple[httpx.AsyncClient, bool]:
        """获取 HTTP 客户端。返回 (client, is_owned)。"""
        if external is not None:
            return external, False
        return httpx.AsyncClient(timeout=15.0), True

    async def _close_if_owned(self, client: httpx.AsyncClient, owned: bool) -> None:
        if owned:
            await client.aclose()

    # ── 入站消息 ──

    def parse_event(self, payload: dict[str, Any]) -> ChannelMessage | None:
        """解析 webhook/回调 payload 为统一 ChannelMessage。子类必须 override。"""
        return None

    # ── 出站回复 ──

    async def reply(self, *, chat_id: str, text: str, client: httpx.AsyncClient | None = None, **kw: Any) -> dict[str, Any]:
        """发送回复消息。子类必须 override。"""
        return {"ok": False, "reason": "not_implemented"}

    # ── 内容发布（种草/电商平台特有） ──

    async def publish(self, *, content: dict[str, Any], client: httpx.AsyncClient | None = None, **kw: Any) -> dict[str, Any]:
        """发布内容（视频/图文/商品）。种草和电商平台实现。"""
        return {"ok": False, "reason": "not_implemented"}

    # ── 评论拉取与回复 ──

    async def fetch_comments(self, *, post_id: str, cursor: str = "", count: int = 20, client: httpx.AsyncClient | None = None) -> list[dict[str, Any]]:
        """拉取帖子/视频/商品的评论。"""
        return []

    async def reply_comment(self, *, post_id: str, comment_id: str, text: str, client: httpx.AsyncClient | None = None) -> dict[str, Any]:
        """回复评论。"""
        return {"ok": False, "reason": "not_implemented"}

    # ── 私信/客服消息 ──

    async def fetch_dms(self, *, since: str = "", count: int = 20, client: httpx.AsyncClient | None = None) -> list[dict[str, Any]]:
        """拉取私信/客服消息。"""
        return []

    async def send_dm(self, *, to_user_id: str, text: str, client: httpx.AsyncClient | None = None) -> dict[str, Any]:
        """发送私信。"""
        return {"ok": False, "reason": "not_implemented"}

    # ── 平台信号采集（radar 使用） ──

    async def fetch_trending(self, *, keyword: str = "", count: int = 10, client: httpx.AsyncClient | None = None) -> list[dict[str, Any]]:
        """获取热搜/趋势/搜索词。"""
        return []

    # ── 状态描述 ──

    def describe(self) -> dict[str, Any]:
        return {
            "channel": self.channel_id,
            "enabled": self.enabled,
        }
```

---

## 任务 1：抖音适配器 `douyin_channel.py` — P0

**文件路径**: `dragon-senate-saas-v2/douyin_channel.py`

**环境变量**:
- `DOUYIN_ENABLED` — 是否启用
- `DOUYIN_APP_KEY` — 抖音开放平台 App Key
- `DOUYIN_APP_SECRET` — 抖音开放平台 App Secret
- `DOUYIN_ACCESS_TOKEN` — 当前有效的 Access Token（或通过 OAuth 刷新）

**需要实现的方法**:

| 方法 | 用途 | 对应龙虾 |
|------|------|---------|
| `parse_event(payload)` | 解析抖音 webhook（评论通知/私信通知） | echoer, catcher |
| `reply(chat_id, text)` | 回复私信 | echoer, followup |
| `publish(content)` | 发布视频（title, video_url, cover_url） | dispatcher |
| `fetch_comments(post_id)` | 拉取视频评论 | echoer, catcher |
| `reply_comment(post_id, comment_id, text)` | 回复评论 | echoer |
| `fetch_dms(since)` | 拉取私信列表 | catcher |
| `send_dm(to_user_id, text)` | 发送私信 | followup |
| `fetch_trending(keyword)` | 抖音热搜榜/搜索建议词 | radar |

**抖音开放平台 API 参考**:
- 视频发布: `POST https://open.douyin.com/api/douyin/v1/video/upload/`
- 评论列表: `GET https://open.douyin.com/api/item/comment/list/`
- 评论回复: `POST https://open.douyin.com/api/item/comment/reply/`
- 私信发送: `POST https://open.douyin.com/api/douyin/v1/im/message/send/`
- 热搜: `GET https://open.douyin.com/api/douyin/v1/search/hot_list/`

**实现要求**:
- 继承 `BaseChannelAdapter`
- `channel_id = "douyin"`
- 所有 API 调用先检查 `self.enabled`，未启用返回 `{"ok": False, "reason": "douyin_disabled"}`
- 异常处理：`try/except` 包裹所有外部调用，返回 `{"ok": False, "error": str(exc)}`
- 模块级单例: `douyin_channel = DouyinChannelAdapter()`

---

## 任务 2：小红书适配器 `xiaohongshu_channel.py` — P0

**文件路径**: `dragon-senate-saas-v2/xiaohongshu_channel.py`

**环境变量**:
- `XIAOHONGSHU_ENABLED`
- `XIAOHONGSHU_APP_KEY`
- `XIAOHONGSHU_APP_SECRET`
- `XIAOHONGSHU_ACCESS_TOKEN`

**需要实现的方法**:

| 方法 | 用途 | 对应龙虾 |
|------|------|---------|
| `parse_event(payload)` | 解析小红书 webhook | echoer, catcher |
| `reply(chat_id, text)` | 回复私信 | echoer, followup |
| `publish(content)` | 发布笔记（图文或视频） | dispatcher |
| `fetch_comments(post_id)` | 拉取笔记评论 | echoer, catcher |
| `reply_comment(post_id, comment_id, text)` | 回复评论 | echoer |
| `fetch_dms(since)` | 拉取私信 | catcher |
| `send_dm(to_user_id, text)` | 发送私信 | followup |
| `fetch_trending(keyword)` | 搜索笔记/热门话题 | radar |

**特殊处理**:
- `publish()` 的 content 字典需要支持两种格式:
  - 图文笔记: `{"type": "note", "title": "...", "content": "...", "images": [url1, url2]}`
  - 视频笔记: `{"type": "video", "title": "...", "video_url": "..."}`

**实现要求**: 同抖音。`channel_id = "xiaohongshu"`，单例 `xiaohongshu_channel`。

---

## 任务 3：快手适配器 `kuaishou_channel.py` — P1

**文件路径**: `dragon-senate-saas-v2/kuaishou_channel.py`

**环境变量**: `KUAISHOU_ENABLED`, `KUAISHOU_APP_ID`, `KUAISHOU_APP_SECRET`, `KUAISHOU_ACCESS_TOKEN`

**与抖音相同的接口列表**（API endpoint 不同）。
`channel_id = "kuaishou"`，单例 `kuaishou_channel`。

---

## 任务 4：淘宝适配器 `taobao_channel.py` — P1

**文件路径**: `dragon-senate-saas-v2/taobao_channel.py`

**环境变量**:
- `TAOBAO_ENABLED`
- `TAOBAO_APP_KEY`
- `TAOBAO_APP_SECRET`
- `TAOBAO_SESSION_KEY` — 卖家授权 Session

**需要实现的方法（与种草平台不同）**:

| 方法 | 用途 | 对应龙虾 |
|------|------|---------|
| `parse_event(payload)` | 解析淘宝消息推送（旺旺消息/订单通知） | echoer, catcher |
| `reply(chat_id, text)` | 回复旺旺消息 | echoer |
| `publish(content)` | 更新商品标题/描述/主图 | dispatcher (上架调度) |
| `fetch_comments(post_id)` | 拉取商品评价 | radar, catcher |
| `fetch_dms(since)` | 拉取旺旺客服消息 | catcher |
| `send_dm(to_user_id, text)` | 发送旺旺消息 | followup |
| `fetch_trending(keyword)` | 搜索词分析/飙升榜 | radar |

**特殊方法（电商特有）**:
```python
async def update_product(self, *, item_id: str, title: str = "", desc: str = "", images: list[str] | None = None, client=None) -> dict[str, Any]:
    """更新商品信息 — inkwriter+visualizer 的输出落地"""

async def fetch_orders(self, *, since: str = "", status: str = "WAIT_BUYER_PAY", count: int = 20, client=None) -> list[dict[str, Any]]:
    """拉取订单 — abacus 归因使用"""
```

**淘宝 TOP API 参考**:
- 商品更新: `taobao.item.update`
- 旺旺消息: `taobao.openim.push`
- 搜索词: `taobao.itemcats.get`

`channel_id = "taobao"`，单例 `taobao_channel`。

---

## 任务 5：京东适配器 `jd_channel.py` — P2

**文件路径**: `dragon-senate-saas-v2/jd_channel.py`

**环境变量**: `JD_ENABLED`, `JD_APP_KEY`, `JD_APP_SECRET`, `JD_ACCESS_TOKEN`

**与淘宝相同的接口列表**（API 使用京东宙斯 JOS）。
客服系统: 咚咚（替代旺旺）。
`channel_id = "jd"`，单例 `jd_channel`。

---

## 任务 6：拼多多适配器 `pdd_channel.py` — P2

**文件路径**: `dragon-senate-saas-v2/pdd_channel.py`

**环境变量**: `PDD_ENABLED`, `PDD_CLIENT_ID`, `PDD_CLIENT_SECRET`, `PDD_ACCESS_TOKEN`

**与淘宝相同的接口列表**（API 使用拼多多开放平台）。
**特殊**: 添加 `fetch_group_deals()` 方法用于拼团数据。
`channel_id = "pdd"`，单例 `pdd_channel`。

---

## 任务 7：微信适配器 `wechat_channel.py` — P0

**文件路径**: `dragon-senate-saas-v2/wechat_channel.py`

**环境变量**:
- `WECHAT_ENABLED`
- `WECHAT_CORP_ID` — 企业微信 Corp ID
- `WECHAT_CORP_SECRET` — 企业微信应用 Secret
- `WECHAT_AGENT_ID` — 企业微信应用 Agent ID
- `WECHAT_MP_APPID` — 公众号 AppID（可选）
- `WECHAT_MP_SECRET` — 公众号 Secret（可选）

**需要实现的方法**:

| 方法 | 用途 | 对应龙虾 |
|------|------|---------|
| `parse_event(payload)` | 解析企微/公众号回调 | echoer, catcher |
| `reply(chat_id, text)` | 企微私聊回复 | echoer, followup |
| `publish(content)` | 发朋友圈/公众号文章 | dispatcher |
| `fetch_dms(since)` | 拉取企微消息 | catcher |
| `send_dm(to_user_id, text)` | 企微主动发消息 | followup |
| `fetch_trending()` | 不适用（微信无热搜） | — |

**特殊方法**:
```python
async def send_group_message(self, *, group_id: str, text: str, client=None) -> dict[str, Any]:
    """发送群消息 — echoer 使用"""

async def publish_moment(self, *, text: str, images: list[str] | None = None, client=None) -> dict[str, Any]:
    """发朋友圈 — dispatcher 使用"""

async def publish_article(self, *, title: str, content: str, cover_url: str = "", client=None) -> dict[str, Any]:
    """发公众号文章 — inkwriter+visualizer 输出"""

async def add_contact(self, *, user_id: str, greeting: str = "", client=None) -> dict[str, Any]:
    """添加好友/外部联系人 — followup 使用"""
```

**企业微信 API 参考**:
- 发送消息: `POST https://qyapi.weixin.qq.com/cgi-bin/message/send`
- 获取 Token: `GET https://qyapi.weixin.qq.com/cgi-bin/gettoken`
- 外部联系人: `POST https://qyapi.weixin.qq.com/cgi-bin/externalcontact/add_contact_way`

`channel_id = "wechat"`，单例 `wechat_channel`。

---

## 任务 8：更新 app.py 中的渠道检测和路由

在 `dragon-senate-saas-v2/app.py` 中:

### 8.1 添加 import

在现有的 `from feishu_channel import feishu_channel` 和 `from dingtalk_channel import dingtalk_channel` 之后，添加:

```python
from douyin_channel import douyin_channel
from xiaohongshu_channel import xiaohongshu_channel
from kuaishou_channel import kuaishou_channel
from taobao_channel import taobao_channel
from jd_channel import jd_channel
from pdd_channel import pdd_channel
from wechat_channel import wechat_channel
```

### 8.2 更新 `_detect_chat_channel()` 函数

在现有的 feishu/dingtalk 检测之后，添加新平台的检测逻辑:

```python
def _detect_chat_channel(payload: dict[str, Any]) -> str:
    if not isinstance(payload, dict):
        return "telegram"
    # 现有检测...
    header = payload.get("header")
    if isinstance(header, dict) and header.get("event_type"):
        return "feishu"
    if "schema" in payload and "conversationId" in payload:
        return "dingtalk"
    if payload.get("sessionWebhook") or payload.get("conversationId"):
        return "dingtalk"
    
    # ── 新增平台检测 ──
    if payload.get("event_type") and payload.get("from_platform") == "douyin":
        return "douyin"
    if payload.get("event_type") and payload.get("from_platform") == "xiaohongshu":
        return "xiaohongshu"
    if payload.get("event_type") and payload.get("from_platform") == "kuaishou":
        return "kuaishou"
    if payload.get("msg_signature") and "xml" in str(payload.get("content", "")):
        return "wechat"
    if payload.get("from_platform") in ("taobao", "jd", "pdd"):
        return payload["from_platform"]
    
    return "telegram"
```

### 8.3 更新 `send_chat_reply()` 函数

在现有 feishu/dingtalk 分支之后，添加:

```python
if channel == "douyin":
    adapter = getattr(app.state, "douyin_channel", douyin_channel)
    await adapter.reply(chat_id=chat_id, text=text, client=http_client)
    return
if channel == "xiaohongshu":
    adapter = getattr(app.state, "xiaohongshu_channel", xiaohongshu_channel)
    await adapter.reply(chat_id=chat_id, text=text, client=http_client)
    return
if channel == "kuaishou":
    adapter = getattr(app.state, "kuaishou_channel", kuaishou_channel)
    await adapter.reply(chat_id=chat_id, text=text, client=http_client)
    return
if channel == "wechat":
    adapter = getattr(app.state, "wechat_channel", wechat_channel)
    await adapter.reply(chat_id=chat_id, text=text, client=http_client)
    return
if channel in ("taobao", "jd", "pdd"):
    adapters = {"taobao": taobao_channel, "jd": jd_channel, "pdd": pdd_channel}
    adapter = getattr(app.state, f"{channel}_channel", adapters[channel])
    await adapter.reply(chat_id=chat_id, text=text, client=http_client)
    return
```

### 8.4 在 startup 中初始化

在 `app.state` 初始化区域添加:

```python
douyin_channel.reload_from_env()
xiaohongshu_channel.reload_from_env()
kuaishou_channel.reload_from_env()
taobao_channel.reload_from_env()
jd_channel.reload_from_env()
pdd_channel.reload_from_env()
wechat_channel.reload_from_env()

app.state.douyin_channel = douyin_channel
app.state.xiaohongshu_channel = xiaohongshu_channel
app.state.kuaishou_channel = kuaishou_channel
app.state.taobao_channel = taobao_channel
app.state.jd_channel = jd_channel
app.state.pdd_channel = pdd_channel
app.state.wechat_channel = wechat_channel
```

---

## 通用规则（所有适配器必须遵守）

1. **文件位置**: 所有适配器放在 `dragon-senate-saas-v2/` 根目录（与 `feishu_channel.py` 同级）
2. **继承 BaseChannelAdapter**: `from base_channel import BaseChannelAdapter, ChannelMessage, _env_bool, _env_str`
3. **模块级单例**: 每个文件底部 `xxx_channel = XxxChannelAdapter()`
4. **环境变量命名**: `{PLATFORM}_ENABLED`, `{PLATFORM}_APP_KEY`, `{PLATFORM}_APP_SECRET`, `{PLATFORM}_ACCESS_TOKEN`
5. **未启用检查**: 所有方法开头 `if not self.enabled: return {"ok": False, "reason": "{platform}_disabled"}`
6. **异常安全**: 所有 HTTP 调用 `try/except`，返回 `{"ok": False, "error": str(exc)}`
7. **Token 刷新**: 参考 `FeishuChannelAdapter._get_tenant_access_token()` 模式，缓存 token 并自动刷新
8. **日志**: 使用 `print(f"[{channel_id}] ...")` 格式（与现有适配器一致）
9. **HTTP 客户端**: 优先使用传入的 `client` 参数，没有则自建并在 finally 中关闭
10. **不要修改现有的 `feishu_channel.py` 和 `dingtalk_channel.py`**

---

## 验证标准

每个适配器应该：
1. ✅ 继承 `BaseChannelAdapter`
2. ✅ 设置正确的 `channel_id`
3. ✅ `reload_from_env()` 从环境变量加载所有配置
4. ✅ `parse_event()` 返回 `ChannelMessage` 或 `None`
5. ✅ `reply()` 发送回复消息
6. ✅ `describe()` 返回状态字典
7. ✅ 模块级单例
8. ✅ 所有 API 调用有异常处理
9. ✅ 种草平台实现 `publish/fetch_comments/reply_comment/fetch_dms/send_dm/fetch_trending`
10. ✅ 电商平台额外实现 `update_product/fetch_orders`
11. ✅ 微信额外实现 `send_group_message/publish_moment/publish_article/add_contact`

---

## 文件清单

完成后应该新增以下文件:

```
dragon-senate-saas-v2/
├── base_channel.py              # 新建 — BaseChannelAdapter 基类
├── douyin_channel.py            # 新建 — 抖音适配器
├── xiaohongshu_channel.py       # 新建 — 小红书适配器
├── kuaishou_channel.py          # 新建 — 快手适配器
├── taobao_channel.py            # 新建 — 淘宝适配器
├── jd_channel.py                # 新建 — 京东适配器
├── pdd_channel.py               # 新建 — 拼多多适配器
├── wechat_channel.py            # 新建 — 微信/企微适配器
├── feishu_channel.py            # 不修改
├── dingtalk_channel.py          # 不修改
└── app.py                       # 修改 — 添加 import + 渠道路由
```
