# CODEX-OCM-04: Web Provider + Channel 管理面板

> **优先级**: P1 | **算力**: 中 | **来源**: OpenClaw Manager 借鉴分析
> **分析文档**: `docs/OPENCLAW_MANAGER_BORROWING_ANALYSIS.md`

---

## 背景

OpenClaw Manager 有两个极其成熟的配置界面：
1. **AIConfig** — 14+ AI 提供商的可视化配置（自定义 API 端点、一键主模型切换、模型列表管理）
2. **Channels** — 10 个消息渠道的可视化配置（配置表单、官方文档链接、连通性测试、开关控制）

我们当前：
- `provider_registry.py` 支持多 provider 但只有代码配置，无 Web UI
- `.env.example` + `channels.china.example.json` 有渠道配置占位但无管理界面
- 前端工程师无法在 Web 控制台直接管理 AI 模型和消息渠道

## 目标

在 `dragon-senate-saas-v2/app.py` 中新增 Provider 管理和 Channel 管理的 API 端点，供前端 Web 控制台调用。

## 交付物

### 1. Provider 管理 API

#### 1.1 `dragon-senate-saas-v2/provider_manager.py`

```python
"""
Provider Manager — AI 提供商管理

借鉴 openclaw-manager 的 AIConfig 设计，提供 provider 的 CRUD + 连通性测试。
"""
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
import os, json, httpx, asyncio


# 官方 Provider 模板列表（预置，用户不需要手动填写全部字段）
OFFICIAL_PROVIDERS = [
    {
        "id": "anthropic",
        "name": "Anthropic",
        "icon": "🤖",
        "base_url": "https://api.anthropic.com",
        "models": ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-3-5-haiku-20241022"],
        "env_key": "ANTHROPIC_API_KEY",
        "docs_url": "https://docs.anthropic.com/",
    },
    {
        "id": "openai",
        "name": "OpenAI",
        "icon": "🧠",
        "base_url": "https://api.openai.com/v1",
        "models": ["gpt-4o", "gpt-4o-mini", "o1-preview"],
        "env_key": "OPENAI_API_KEY",
        "docs_url": "https://platform.openai.com/docs/",
    },
    {
        "id": "deepseek",
        "name": "DeepSeek",
        "icon": "🔮",
        "base_url": "https://api.deepseek.com",
        "models": ["deepseek-chat", "deepseek-reasoner"],
        "env_key": "DEEPSEEK_API_KEY",
        "docs_url": "https://platform.deepseek.com/docs",
    },
    {
        "id": "moonshot",
        "name": "月之暗面 Moonshot",
        "icon": "🌙",
        "base_url": "https://api.moonshot.cn/v1",
        "models": ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
        "env_key": "MOONSHOT_API_KEY",
        "docs_url": "https://platform.moonshot.cn/docs",
    },
    {
        "id": "gemini",
        "name": "Google Gemini",
        "icon": "💎",
        "base_url": "https://generativelanguage.googleapis.com/v1beta",
        "models": ["gemini-2.5-pro", "gemini-2.5-flash"],
        "env_key": "GOOGLE_API_KEY",
        "docs_url": "https://ai.google.dev/docs",
    },
    {
        "id": "qwen",
        "name": "通义千问 Qwen",
        "icon": "🦜",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "models": ["qwen-max", "qwen-plus", "qwen-turbo"],
        "env_key": "DASHSCOPE_API_KEY",
        "docs_url": "https://help.aliyun.com/zh/model-studio/",
    },
    {
        "id": "zhipu",
        "name": "智谱 GLM",
        "icon": "🔬",
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "models": ["glm-4-plus", "glm-4-flash"],
        "env_key": "ZHIPU_API_KEY",
        "docs_url": "https://open.bigmodel.cn/dev/api",
    },
    {
        "id": "custom",
        "name": "自定义 (OpenAI 兼容)",
        "icon": "🔧",
        "base_url": "",
        "models": [],
        "env_key": "CUSTOM_API_KEY",
        "docs_url": "",
    },
]


@dataclass
class ProviderConfig:
    id: str
    name: str
    icon: str
    base_url: str
    api_key: str = ""
    models: List[str] = field(default_factory=list)
    primary_model: Optional[str] = None
    enabled: bool = True
    docs_url: str = ""

    def to_api_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "icon": self.icon,
            "base_url": self.base_url,
            "api_key_set": bool(self.api_key),  # 不暴露真实 key
            "models": self.models,
            "primary_model": self.primary_model,
            "enabled": self.enabled,
            "docs_url": self.docs_url,
        }


class ProviderManager:
    """AI Provider 管理器"""

    def __init__(self, config_path: str = None):
        self._config_path = config_path or os.path.expanduser("~/.openclaw-agent/providers.json")
        self._providers: Dict[str, ProviderConfig] = {}
        self._load()

    def _load(self):
        if os.path.exists(self._config_path):
            with open(self._config_path) as f:
                data = json.load(f)
            for item in data:
                self._providers[item["id"]] = ProviderConfig(**item)

    def _save(self):
        os.makedirs(os.path.dirname(self._config_path), exist_ok=True)
        data = []
        for p in self._providers.values():
            d = vars(p).copy()
            data.append(d)
        with open(self._config_path, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def get_official_templates(self) -> List[Dict]:
        return OFFICIAL_PROVIDERS

    def get_all(self) -> List[Dict]:
        return [p.to_api_dict() for p in self._providers.values()]

    def get(self, provider_id: str) -> Optional[Dict]:
        p = self._providers.get(provider_id)
        return p.to_api_dict() if p else None

    def save(self, config: Dict) -> bool:
        pid = config.get("id")
        if not pid:
            return False
        self._providers[pid] = ProviderConfig(**config)
        self._save()
        return True

    def delete(self, provider_id: str) -> bool:
        if provider_id in self._providers:
            del self._providers[provider_id]
            self._save()
            return True
        return False

    def set_primary_model(self, provider_id: str, model: str) -> bool:
        p = self._providers.get(provider_id)
        if not p:
            return False
        p.primary_model = model
        self._save()
        return True

    async def test_connection(self, provider_id: str) -> Dict:
        """测试 provider 连通性"""
        p = self._providers.get(provider_id)
        if not p:
            return {"success": False, "error": "Provider 不存在"}
        if not p.api_key:
            return {"success": False, "error": "API Key 未设置"}
        
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                # 尝试列出模型（OpenAI 兼容格式）
                resp = await client.get(
                    f"{p.base_url}/models",
                    headers={"Authorization": f"Bearer {p.api_key}"},
                )
                if resp.status_code == 200:
                    return {"success": True, "message": "连接成功", "status_code": 200}
                else:
                    return {"success": False, "error": f"HTTP {resp.status_code}", "status_code": resp.status_code}
        except Exception as e:
            return {"success": False, "error": str(e)}
```

#### 1.2 API 端点（添加到 `app.py`）

```python
# GET  /api/providers/templates      — 获取官方 provider 模板列表
# GET  /api/providers                — 获取已配置的 provider 列表
# GET  /api/providers/{id}           — 获取单个 provider
# PUT  /api/providers/{id}           — 保存/更新 provider 配置
# DELETE /api/providers/{id}         — 删除 provider
# PUT  /api/providers/{id}/primary   — 设置主模型
# POST /api/providers/{id}/test      — 测试连通性
```

### 2. Channel 管理 API

#### 2.1 `dragon-senate-saas-v2/channel_manager.py`

```python
"""
Channel Manager — 消息渠道管理

借鉴 openclaw-manager 的 Channels 组件设计。
"""
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
import os, json


# 渠道模板定义
CHANNEL_TEMPLATES = [
    {
        "id": "telegram",
        "name": "Telegram",
        "icon": "✈️",
        "config_fields": [
            {"key": "bot_token", "label": "Bot Token", "type": "password", "required": True,
             "placeholder": "123456:ABC-DEF...", "help": "从 @BotFather 获取"},
            {"key": "allowed_users", "label": "允许的用户 ID", "type": "text",
             "placeholder": "逗号分隔的用户 ID"},
            {"key": "group_mode", "label": "群组模式", "type": "select",
             "options": [{"value": "off", "label": "关闭"}, {"value": "mention", "label": "@提及触发"},
                        {"value": "all", "label": "所有消息"}]},
        ],
        "docs_url": "https://core.telegram.org/bots/tutorial",
    },
    {
        "id": "feishu",
        "name": "飞书",
        "icon": "🐦",
        "config_fields": [
            {"key": "app_id", "label": "App ID", "type": "text", "required": True},
            {"key": "app_secret", "label": "App Secret", "type": "password", "required": True},
            {"key": "encrypt_key", "label": "Encrypt Key", "type": "password"},
            {"key": "verification_token", "label": "Verification Token", "type": "password"},
        ],
        "docs_url": "https://open.feishu.cn/document/home/index",
    },
    {
        "id": "dingtalk",
        "name": "钉钉",
        "icon": "🔵",
        "config_fields": [
            {"key": "client_id", "label": "Client ID", "type": "text", "required": True},
            {"key": "client_secret", "label": "Client Secret", "type": "password", "required": True},
        ],
        "docs_url": "https://open.dingtalk.com/document/",
    },
    {
        "id": "wechat_mp",
        "name": "微信公众号",
        "icon": "🟢",
        "config_fields": [
            {"key": "app_id", "label": "AppID", "type": "text", "required": True},
            {"key": "app_secret", "label": "AppSecret", "type": "password", "required": True},
            {"key": "token", "label": "Token", "type": "password", "required": True},
            {"key": "encoding_aes_key", "label": "EncodingAESKey", "type": "password"},
        ],
        "docs_url": "https://developers.weixin.qq.com/doc/offiaccount/Getting_Started/Overview.html",
    },
    {
        "id": "wecom",
        "name": "企业微信",
        "icon": "💼",
        "config_fields": [
            {"key": "corp_id", "label": "Corp ID", "type": "text", "required": True},
            {"key": "agent_id", "label": "Agent ID", "type": "text", "required": True},
            {"key": "secret", "label": "Secret", "type": "password", "required": True},
            {"key": "token", "label": "Token", "type": "password"},
            {"key": "encoding_aes_key", "label": "EncodingAESKey", "type": "password"},
        ],
        "docs_url": "https://developer.work.weixin.qq.com/document/",
    },
    {
        "id": "discord",
        "name": "Discord",
        "icon": "🎮",
        "config_fields": [
            {"key": "bot_token", "label": "Bot Token", "type": "password", "required": True},
            {"key": "application_id", "label": "Application ID", "type": "text"},
        ],
        "docs_url": "https://discord.com/developers/docs",
    },
    {
        "id": "slack",
        "name": "Slack",
        "icon": "💬",
        "config_fields": [
            {"key": "bot_token", "label": "Bot Token (xoxb-...)", "type": "password", "required": True},
            {"key": "app_token", "label": "App Token (xapp-...)", "type": "password"},
            {"key": "signing_secret", "label": "Signing Secret", "type": "password"},
        ],
        "docs_url": "https://api.slack.com/docs",
    },
    {
        "id": "qqbot",
        "name": "QQ 机器人",
        "icon": "🐧",
        "config_fields": [
            {"key": "app_id", "label": "AppID", "type": "text", "required": True},
            {"key": "client_secret", "label": "Client Secret", "type": "password", "required": True},
        ],
        "docs_url": "https://bot.q.qq.com/wiki/",
    },
]


class ChannelManager:
    """消息渠道管理器"""

    def __init__(self, config_path: str = None):
        self._config_path = config_path or os.path.expanduser("~/.openclaw-agent/channels.json")
        self._channels: Dict[str, Dict] = {}
        self._load()

    def _load(self):
        if os.path.exists(self._config_path):
            with open(self._config_path) as f:
                data = json.load(f)
            for item in data:
                self._channels[item["id"]] = item

    def _save(self):
        os.makedirs(os.path.dirname(self._config_path), exist_ok=True)
        with open(self._config_path, "w") as f:
            json.dump(list(self._channels.values()), f, indent=2, ensure_ascii=False)

    def get_templates(self) -> List[Dict]:
        return CHANNEL_TEMPLATES

    def get_all(self) -> List[Dict]:
        result = []
        for tmpl in CHANNEL_TEMPLATES:
            ch = self._channels.get(tmpl["id"], {})
            result.append({
                **tmpl,
                "configured": bool(ch.get("config_values")),
                "enabled": ch.get("enabled", False),
                "config_values": {k: ("***" if "secret" in k or "token" in k or "key" in k.lower() else v)
                                  for k, v in ch.get("config_values", {}).items()},
            })
        return result

    def get(self, channel_id: str) -> Optional[Dict]:
        return self._channels.get(channel_id)

    def save(self, channel_id: str, config_values: Dict, enabled: bool = True) -> bool:
        self._channels[channel_id] = {
            "id": channel_id,
            "config_values": config_values,
            "enabled": enabled,
        }
        self._save()
        return True

    def clear(self, channel_id: str) -> bool:
        if channel_id in self._channels:
            del self._channels[channel_id]
            self._save()
            return True
        return False

    def enable(self, channel_id: str) -> bool:
        ch = self._channels.get(channel_id)
        if ch:
            ch["enabled"] = True
            self._save()
            return True
        return False

    def disable(self, channel_id: str) -> bool:
        ch = self._channels.get(channel_id)
        if ch:
            ch["enabled"] = False
            self._save()
            return True
        return False
```

#### 2.2 API 端点（添加到 `app.py`）

```python
# GET  /api/channels/templates       — 获取渠道模板列表（含 config_fields 定义）
# GET  /api/channels                 — 获取所有渠道配置状态
# GET  /api/channels/{id}            — 获取单个渠道配置
# PUT  /api/channels/{id}            — 保存渠道配置
# DELETE /api/channels/{id}          — 清除渠道配置
# PUT  /api/channels/{id}/enable     — 启用渠道
# PUT  /api/channels/{id}/disable    — 禁用渠道
# POST /api/channels/{id}/test       — 测试渠道连通性
```

### 3. 测试文件

- `dragon-senate-saas-v2/tests/test_provider_manager.py`
- `dragon-senate-saas-v2/tests/test_channel_manager.py`

### 4. 前端对齐文档

更新 `docs/FRONTEND_CODEX_HANDOFF.md`，新增以下内容供前端工程师参考：

```markdown
## Provider 管理页面

API 基础路径: `/api/providers`

### 页面结构
- 左侧: Provider 列表（卡片式，显示名称+图标+状态）
- 右侧: 配置面板（API Key、Base URL、模型列表、主模型选择）
- 顶部: "添加 Provider" 按钮（从模板选择）
- 每个 Provider 卡片: 连通性测试按钮

### 关键交互
1. 用户点击模板 → 填入 API Key → 保存 → 测试连通性
2. 一键设为主模型
3. 启用/禁用开关

## Channel 管理页面

API 基础路径: `/api/channels`

### 页面结构
- 网格布局: 每个渠道一个卡片（图标+名称+状态徽章）
- 点击卡片 → 展开配置表单（由 config_fields 驱动动态生成）
- 每个渠道: 官方文档链接 + 连通性测试按钮

### 关键交互
1. config_fields 驱动动态表单（text/password/select 类型）
2. password 类型字段: 眼睛图标切换显示/隐藏
3. 保存后自动测试连通性
4. 启用/禁用开关
```

## 与已有代码的关系

- `provider_manager.py` 与已有 `provider_registry.py` 的关系：
  - `provider_registry.py` 是**运行时 LLM 路由**层（选择哪个 provider 执行 LLM 调用）
  - `provider_manager.py` 是**管理层**（CRUD + 连通性测试）
  - 两者通过共享配置文件对齐
  - 长期目标：`provider_manager.py` 保存配置 → `provider_registry.py` 读取配置

- `channel_manager.py` 与已有 `.env.example` / `channels.china.example.json` 的关系：
  - 从文件配置升级为 API 配置
  - 配置存储在 `~/.openclaw-agent/channels.json`

## 约束

- 所有 API 返回中，api_key/secret/token 等字段必须脱敏（显示为 `***`）
- 配置文件使用 JSON 格式，便于前端直接消费
- 不依赖外部数据库，纯文件存储
- 连通性测试必须有超时保护（10 秒）

## 验收标准

1. `GET /api/providers/templates` 返回 8+ 官方 provider 模板
2. `PUT /api/providers/deepseek` 可保存配置，`GET` 可读回（api_key 脱敏）
3. `POST /api/providers/deepseek/test` 返回连通性结果
4. `GET /api/channels/templates` 返回 8+ 渠道模板（含 config_fields）
5. `PUT /api/channels/telegram` 可保存 Bot Token 配置
6. `docs/FRONTEND_CODEX_HANDOFF.md` 已更新 Provider + Channel 页面说明
7. 所有测试通过
