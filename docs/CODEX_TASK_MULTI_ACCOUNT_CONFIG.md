# Codex 任务：CODEX-DCIM-02 — 多账号管理 + 统一配置驱动

> **来源**：借鉴 [openclaw-docker-cn-im](https://github.com/justlovemaki/openclaw-docker-cn-im) 的多账号 JSON 管理和 .env 配置驱动模式
> **优先级**：🟡 P1 | **算力**：中 | **预计耗时**：3-4小时
> **前置依赖**：`CODEX_TASK_CHINA_CHANNEL_ADAPTERS.md` 中的 BaseChannelAdapter 已创建

---

## 任务背景

openclaw-docker-cn-im 的每个渠道都支持 `*_ACCOUNTS_JSON` 环境变量来管理多账号（如多个飞书机器人、多个钉钉机器人），同时用 180+ 环境变量通过 `.env` 一个文件控制所有配置。

**对我们的 SaaS 多租户场景至关重要**：
- 不同客户用不同的飞书/钉钉/企微 Bot
- 需要按账号隔离消息路由
- 部署运维需要一个 `.env` 搞定，不能散落多个配置文件

---

## 你的任务

1. 创建 `ChannelAccountManager` — 统一的多账号管理器
2. 创建 `ConfigGenerator` — 从 `.env` 自动生成所有配置
3. 增强已有的 `BaseChannelAdapter` 支持多账号
4. 更新 `.env.example` 为完整的统一配置模板

---

## 任务 1：创建多账号管理器

**文件路径**: `dragon-senate-saas-v2/channel_account_manager.py`

```python
"""
ChannelAccountManager — 渠道多账号管理器

借鉴 openclaw-docker-cn-im 的多账号 JSON 管理模式:
- FEISHU_ACCOUNTS_JSON: 飞书多账号
- DINGTALK_ACCOUNTS_JSON: 钉钉多机器人
- QQBOT_BOTS_JSON: QQ 多账号
- WECOM_ACCOUNTS_JSON: 企微多账号

适配我们的 SaaS 多租户场景:
- 每个 tenant_id 可以有多个渠道账号
- 按 tenant_id + channel + account_id 路由消息
- 支持从 .env 或 Redis 加载账号配置
"""
from __future__ import annotations

import os
import json
from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class ChannelAccount:
    """单个渠道账号配置"""
    account_id: str           # 账号唯一标识
    channel: str              # "feishu" | "dingtalk" | "wecom" | "douyin" | ...
    tenant_id: str = ""       # SaaS 租户 ID（空 = 默认租户）
    name: str = ""            # 账号显示名（如 "美妆事业部飞书机器人"）
    enabled: bool = True
    credentials: dict[str, str] = field(default_factory=dict)  # app_key, app_secret, token 等
    options: dict[str, Any] = field(default_factory=dict)      # dm_policy, group_policy 等
    

class ChannelAccountManager:
    """
    管理所有渠道的所有账号。
    
    数据结构:
    {
        "feishu": {
            "account_1": ChannelAccount(...),
            "account_2": ChannelAccount(...),
        },
        "dingtalk": {
            "bot_main": ChannelAccount(...),
        },
        ...
    }
    
    加载来源:
    1. 环境变量 {CHANNEL}_ACCOUNTS_JSON（兼容 openclaw-docker-cn-im 风格）
    2. 单账号快捷环境变量（如 FEISHU_APP_ID — 自动转为默认账号）
    3. Redis（SaaS 运行时动态加载）
    """

    def __init__(self) -> None:
        self._accounts: dict[str, dict[str, ChannelAccount]] = {}
        self.reload_from_env()

    def reload_from_env(self) -> None:
        """从环境变量加载所有渠道账号"""
        self._accounts = {}
        
        # 支持的渠道列表
        channels = [
            "feishu", "dingtalk", "wecom", "douyin", "xiaohongshu",
            "kuaishou", "taobao", "jd", "pdd", "wechat", "telegram", "qqbot"
        ]
        
        for channel in channels:
            self._load_channel_accounts(channel)

    def _load_channel_accounts(self, channel: str) -> None:
        """加载单个渠道的账号配置"""
        prefix = channel.upper()
        accounts: dict[str, ChannelAccount] = {}
        
        # 方式 1：多账号 JSON（优先）
        json_env = os.getenv(f"{prefix}_ACCOUNTS_JSON", "").strip()
        if json_env:
            try:
                accounts_data = json.loads(json_env)
                if isinstance(accounts_data, list):
                    for item in accounts_data:
                        acc_id = item.get("id", item.get("account_id", f"{channel}_auto_{len(accounts)}"))
                        accounts[acc_id] = ChannelAccount(
                            account_id=acc_id,
                            channel=channel,
                            tenant_id=item.get("tenant_id", ""),
                            name=item.get("name", acc_id),
                            enabled=item.get("enabled", True),
                            credentials={k: v for k, v in item.items() 
                                        if k in ("app_key", "app_secret", "app_id", "access_token",
                                                 "client_id", "client_secret", "bot_id", "secret",
                                                 "corp_id", "corp_secret", "agent_id", "session_key")},
                            options={k: v for k, v in item.items()
                                    if k in ("dm_policy", "group_policy", "allow_from",
                                            "streaming", "require_mention", "welcome_message")},
                        )
                elif isinstance(accounts_data, dict):
                    for acc_id, item in accounts_data.items():
                        accounts[acc_id] = ChannelAccount(
                            account_id=acc_id,
                            channel=channel,
                            tenant_id=item.get("tenant_id", ""),
                            name=item.get("name", acc_id),
                            enabled=item.get("enabled", True),
                            credentials={k: v for k, v in item.items()
                                        if k not in ("tenant_id", "name", "enabled")},
                            options={},
                        )
            except (json.JSONDecodeError, TypeError) as exc:
                print(f"[channel_account_manager] Failed to parse {prefix}_ACCOUNTS_JSON: {exc}")

        # 方式 2：单账号快捷配置（如果没有多账号 JSON，则使用单账号环境变量）
        if not accounts:
            # 检测常见的单账号环境变量
            cred_keys = {
                "app_id": f"{prefix}_APP_ID",
                "app_key": f"{prefix}_APP_KEY",
                "app_secret": f"{prefix}_APP_SECRET",
                "access_token": f"{prefix}_ACCESS_TOKEN",
                "client_id": f"{prefix}_CLIENT_ID",
                "client_secret": f"{prefix}_CLIENT_SECRET",
                "bot_id": f"{prefix}_BOT_ID",
                "secret": f"{prefix}_SECRET",
                "corp_id": f"{prefix}_CORP_ID",
                "corp_secret": f"{prefix}_CORP_SECRET",
                "agent_id": f"{prefix}_AGENT_ID",
            }
            
            credentials = {}
            for key, env_name in cred_keys.items():
                val = os.getenv(env_name, "").strip()
                if val:
                    credentials[key] = val
            
            if credentials:
                enabled = os.getenv(f"{prefix}_ENABLED", "").strip().lower() in {"1", "true", "yes", "on"}
                default_acc = ChannelAccount(
                    account_id=f"{channel}_default",
                    channel=channel,
                    name=f"{channel} 默认账号",
                    enabled=enabled,
                    credentials=credentials,
                    options={
                        "dm_policy": os.getenv(f"{prefix}_DM_POLICY", "").strip(),
                        "group_policy": os.getenv(f"{prefix}_GROUP_POLICY", "").strip(),
                        "allow_from": os.getenv(f"{prefix}_ALLOW_FROM", "").strip(),
                    },
                )
                accounts[default_acc.account_id] = default_acc

        if accounts:
            self._accounts[channel] = accounts

    # ── 查询接口 ──

    def get_accounts(self, channel: str) -> dict[str, ChannelAccount]:
        """获取某渠道的所有账号"""
        return self._accounts.get(channel, {})

    def get_account(self, channel: str, account_id: str) -> ChannelAccount | None:
        """获取指定账号"""
        return self._accounts.get(channel, {}).get(account_id)

    def get_default_account(self, channel: str) -> ChannelAccount | None:
        """获取渠道的默认账号（第一个启用的）"""
        accs = self._accounts.get(channel, {})
        for acc in accs.values():
            if acc.enabled:
                return acc
        return None

    def get_accounts_by_tenant(self, tenant_id: str) -> list[ChannelAccount]:
        """获取某租户的所有账号（跨渠道）"""
        result = []
        for channel_accs in self._accounts.values():
            for acc in channel_accs.values():
                if acc.tenant_id == tenant_id and acc.enabled:
                    result.append(acc)
        return result

    def get_all_enabled_channels(self) -> list[str]:
        """获取所有有启用账号的渠道列表"""
        channels = []
        for channel, accs in self._accounts.items():
            if any(acc.enabled for acc in accs.values()):
                channels.append(channel)
        return channels

    def route_message(self, channel: str, *, tenant_id: str = "", account_id: str = "") -> ChannelAccount | None:
        """
        消息路由 — 根据渠道+租户+账号ID 选择正确的账号
        
        优先级:
        1. 精确匹配 account_id
        2. 匹配 tenant_id 的第一个启用账号
        3. 渠道默认账号
        """
        if account_id:
            acc = self.get_account(channel, account_id)
            if acc and acc.enabled:
                return acc

        if tenant_id:
            accs = self._accounts.get(channel, {})
            for acc in accs.values():
                if acc.tenant_id == tenant_id and acc.enabled:
                    return acc

        return self.get_default_account(channel)

    # ── 动态管理（SaaS 运行时） ──

    def register_account(self, account: ChannelAccount) -> None:
        """运行时动态注册账号（从 Redis/DB 加载时使用）"""
        if account.channel not in self._accounts:
            self._accounts[account.channel] = {}
        self._accounts[account.channel][account.account_id] = account

    def unregister_account(self, channel: str, account_id: str) -> bool:
        """运行时注销账号"""
        accs = self._accounts.get(channel, {})
        if account_id in accs:
            del accs[account_id]
            return True
        return False

    # ── 状态描述 ──

    def describe(self) -> dict[str, Any]:
        """返回所有渠道账号状态概览"""
        result: dict[str, Any] = {}
        for channel, accs in self._accounts.items():
            result[channel] = {
                "total": len(accs),
                "enabled": sum(1 for a in accs.values() if a.enabled),
                "accounts": [
                    {"id": a.account_id, "name": a.name, "enabled": a.enabled, "tenant": a.tenant_id}
                    for a in accs.values()
                ],
            }
        return result


# 模块级单例
channel_account_manager = ChannelAccountManager()
```

---

## 任务 2：创建统一配置生成器

**文件路径**: `dragon-senate-saas-v2/config_generator.py`

```python
"""
ConfigGenerator — 从 .env 生成所有配置文件

借鉴 openclaw-docker-cn-im 的 init.sh 思路，但用 Python 实现更模块化。
读取 .env 环境变量 → 生成各组件所需的配置文件。

用法:
  python config_generator.py          # 生成所有配置
  python config_generator.py --check  # 只检查不生成
"""
from __future__ import annotations

import os
import json
import sys
from pathlib import Path
from typing import Any


class ConfigGenerator:
    """从环境变量生成项目配置文件"""

    def __init__(self, base_dir: str | Path | None = None) -> None:
        self.base_dir = Path(base_dir) if base_dir else Path(__file__).parent
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.generated: list[str] = []

    def generate_all(self) -> bool:
        """生成所有配置文件，返回是否全部成功"""
        self._generate_channel_config()
        self._generate_model_config()
        self._generate_service_ports()
        self._generate_docker_compose_override()
        
        if self.errors:
            print(f"\n❌ 配置生成失败，{len(self.errors)} 个错误:")
            for e in self.errors:
                print(f"  - {e}")
            return False
        
        if self.warnings:
            print(f"\n⚠️ {len(self.warnings)} 个警告:")
            for w in self.warnings:
                print(f"  - {w}")
        
        print(f"\n✅ 配置生成完成，共 {len(self.generated)} 个文件:")
        for f in self.generated:
            print(f"  - {f}")
        return True

    def check_only(self) -> bool:
        """只检查环境变量是否齐全，不生成文件"""
        required = {
            "基础": ["API_KEY", "BASE_URL", "MODEL_ID"],
        }
        optional_groups = {
            "飞书": ["FEISHU_ENABLED", "FEISHU_APP_ID", "FEISHU_APP_SECRET"],
            "钉钉": ["DINGTALK_ENABLED", "DINGTALK_CLIENT_ID", "DINGTALK_CLIENT_SECRET"],
            "企微": ["WECOM_ENABLED", "WECOM_BOT_ID", "WECOM_SECRET"],
            "抖音": ["DOUYIN_ENABLED", "DOUYIN_APP_KEY", "DOUYIN_APP_SECRET"],
            "小红书": ["XIAOHONGSHU_ENABLED", "XIAOHONGSHU_APP_KEY"],
            "Agent Reach": ["AGENT_REACH_ENABLED", "AGENT_REACH_API_URL"],
        }
        
        all_ok = True
        
        # 检查必需项
        for group, vars_list in required.items():
            for var in vars_list:
                if not os.getenv(var):
                    print(f"❌ 缺少必需环境变量: {var} ({group})")
                    all_ok = False
        
        # 检查可选组
        for group, vars_list in optional_groups.items():
            enabled_var = vars_list[0]
            if os.getenv(enabled_var, "").strip().lower() in {"1", "true", "yes"}:
                for var in vars_list[1:]:
                    if not os.getenv(var):
                        print(f"⚠️ {group} 已启用但缺少: {var}")
                        self.warnings.append(f"{group} 缺少 {var}")
            else:
                print(f"ℹ️ {group}: 未启用")
        
        return all_ok

    def _generate_channel_config(self) -> None:
        """生成渠道配置 JSON"""
        from channel_account_manager import channel_account_manager
        
        config = channel_account_manager.describe()
        output_path = self.base_dir / "config" / "channels.generated.json"
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        
        self.generated.append(str(output_path))

    def _generate_model_config(self) -> None:
        """生成 LLM Provider 配置"""
        providers = []
        
        # 主 Provider
        if os.getenv("API_KEY") and os.getenv("BASE_URL"):
            providers.append({
                "name": os.getenv("MODEL_ID", "default"),
                "base_url": os.getenv("BASE_URL"),
                "model_id": os.getenv("MODEL_ID", ""),
                "protocol": os.getenv("API_PROTOCOL", "openai"),
                "context_window": int(os.getenv("CONTEXT_WINDOW", "128000")),
                "max_tokens": int(os.getenv("MAX_TOKENS", "8192")),
            })
        
        # Provider 2-6（兼容 openclaw-docker-cn-im 的 MODEL2-6 命名）
        for i in range(2, 7):
            name = os.getenv(f"MODEL{i}_NAME", "").strip()
            url = os.getenv(f"MODEL{i}_BASE_URL", "").strip()
            if name and url:
                providers.append({
                    "name": name,
                    "base_url": url,
                    "model_id": os.getenv(f"MODEL{i}_MODEL_ID", ""),
                    "protocol": os.getenv(f"MODEL{i}_PROTOCOL", "openai"),
                    "context_window": int(os.getenv(f"MODEL{i}_CONTEXT_WINDOW", "128000")),
                    "max_tokens": int(os.getenv(f"MODEL{i}_MAX_TOKENS", "8192")),
                })
        
        output_path = self.base_dir / "config" / "providers.generated.json"
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump({"providers": providers}, f, ensure_ascii=False, indent=2)
        
        self.generated.append(str(output_path))

    def _generate_service_ports(self) -> None:
        """生成微服务端口配置"""
        services = {
            "dragon_senate": int(os.getenv("DRAGON_SENATE_PORT", "18000")),
            "policy_router": int(os.getenv("POLICY_ROUTER_PORT", "8010")),
            "trust_verification": int(os.getenv("TRUST_VERIFY_PORT", "8020")),
            "cti_engine": int(os.getenv("CTI_ENGINE_PORT", "8030")),
            "xai_scorer": int(os.getenv("XAI_SCORER_PORT", "8040")),
            "lobster_memory": int(os.getenv("LOBSTER_MEMORY_PORT", "8000")),
            "backend": int(os.getenv("BACKEND_PORT", "48789")),
            "web": int(os.getenv("WEB_PORT", "3301")),
        }
        
        output_path = self.base_dir / "config" / "services.generated.json"
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump({"services": services}, f, ensure_ascii=False, indent=2)
        
        self.generated.append(str(output_path))

    def _generate_docker_compose_override(self) -> None:
        """生成 docker-compose.override.yml（端口和环境变量覆盖）"""
        # 仅在 Docker 环境下生成
        if not os.getenv("DOCKER_MODE"):
            return
        
        override = {
            "version": "3.8",
            "services": {},
        }
        
        # 根据启用的渠道动态添加服务依赖
        from channel_account_manager import channel_account_manager
        enabled = channel_account_manager.get_all_enabled_channels()
        
        if enabled:
            override["services"]["dragon-senate"] = {
                "environment": {
                    "ENABLED_CHANNELS": ",".join(enabled),
                },
            }
        
        output_path = self.base_dir / "docker-compose.override.yml"
        
        import yaml  # 可选依赖
        try:
            with open(output_path, "w", encoding="utf-8") as f:
                yaml.dump(override, f, default_flow_style=False, allow_unicode=True)
            self.generated.append(str(output_path))
        except ImportError:
            # 没有 PyYAML 则用 JSON 格式写
            with open(output_path.with_suffix(".json"), "w", encoding="utf-8") as f:
                json.dump(override, f, ensure_ascii=False, indent=2)
            self.generated.append(str(output_path.with_suffix(".json")))


if __name__ == "__main__":
    gen = ConfigGenerator()
    if "--check" in sys.argv:
        ok = gen.check_only()
        sys.exit(0 if ok else 1)
    else:
        ok = gen.generate_all()
        sys.exit(0 if ok else 1)
```

---

## 任务 3：更新 app.py 接入多账号管理器

**文件路径**: 修改 `dragon-senate-saas-v2/app.py`

在 startup 阶段添加 `channel_account_manager` 初始化，并在消息路由中使用它。

**在文件顶部添加 import**:
```python
from channel_account_manager import channel_account_manager
```

**在 startup 事件中添加**:
```python
channel_account_manager.reload_from_env()
app.state.channel_account_manager = channel_account_manager
print(f"[startup] 渠道账号管理器已加载: {channel_account_manager.get_all_enabled_channels()}")
```

**添加账号管理 API 端点**:
```python
@app.get("/api/v1/channels/status")
async def channels_status():
    """返回所有渠道账号状态"""
    return channel_account_manager.describe()

@app.get("/api/v1/channels/{channel}/accounts")
async def channel_accounts(channel: str):
    """返回指定渠道的账号列表"""
    accs = channel_account_manager.get_accounts(channel)
    return {
        "channel": channel,
        "accounts": [
            {"id": a.account_id, "name": a.name, "enabled": a.enabled, "tenant": a.tenant_id}
            for a in accs.values()
        ],
    }
```

**注意**: 不要覆盖现有的路由逻辑，只追加新的端点。

---

## 任务 4：更新统一 .env.example

**文件路径**: 修改 `dragon-senate-saas-v2/.env.example`

确保以下内容存在（追加不存在的部分）:

```bash
# ══════════════════════════════════════════════════════════
# 龙虾元老院统一配置文件
# 借鉴 openclaw-docker-cn-im 的配置驱动模式
# 一个 .env 控制所有组件
# ══════════════════════════════════════════════════════════

# ── 基础 LLM 配置 ──
API_KEY=your-api-key-here
BASE_URL=https://api.openai.com/v1
MODEL_ID=gpt-4o
API_PROTOCOL=openai
CONTEXT_WINDOW=128000
MAX_TOKENS=8192

# ── 备用 Provider 2 (可选) ──
# MODEL2_NAME=deepseek
# MODEL2_MODEL_ID=deepseek-chat
# MODEL2_BASE_URL=https://api.deepseek.com/v1
# MODEL2_API_KEY=
# MODEL2_PROTOCOL=openai

# ── 多账号管理 (JSON 格式) ──
# 每个渠道支持多账号，格式为 JSON 数组
# 优先使用 *_ACCOUNTS_JSON，否则用单账号环境变量

# 飞书多账号示例:
# FEISHU_ACCOUNTS_JSON=[{"id":"beauty_bot","name":"美妆部","tenant_id":"tenant_001","app_id":"cli_xxx","app_secret":"xxx"},{"id":"tech_bot","name":"科技部","tenant_id":"tenant_002","app_id":"cli_yyy","app_secret":"yyy"}]

# 钉钉多账号示例:
# DINGTALK_ACCOUNTS_JSON=[{"id":"main_bot","client_id":"xxx","client_secret":"xxx","robot_code":"xxx"}]

# 企微多账号示例:
# WECOM_ACCOUNTS_JSON=[{"id":"cs_bot","name":"客服机器人","bot_id":"xxx","secret":"xxx","corp_id":"xxx"}]

# ── Docker 部署模式 ──
# DOCKER_MODE=true
# DOCKER_BIND=0.0.0.0
```

---

## 验证标准

1. ✅ `channel_account_manager.py` 创建成功，包含 `ChannelAccountManager` 类
2. ✅ 支持从 `*_ACCOUNTS_JSON` 环境变量加载多账号
3. ✅ 支持从单账号环境变量自动降级为默认账号
4. ✅ `route_message()` 支持按 tenant_id / account_id / 默认 三级路由
5. ✅ `register_account()` / `unregister_account()` 支持运行时动态管理
6. ✅ `config_generator.py` 创建成功，可从 .env 生成 `channels.generated.json` / `providers.generated.json`
7. ✅ `app.py` 中接入 `channel_account_manager`，startup 时初始化
8. ✅ 新增 `/api/v1/channels/status` 和 `/api/v1/channels/{channel}/accounts` API
9. ✅ `.env.example` 更新，包含多账号 JSON 示例

---

## 文件清单

```
dragon-senate-saas-v2/
├── channel_account_manager.py    # 新建 — 多账号管理器
├── config_generator.py           # 新建 — 统一配置生成器
├── config/                       # 新建目录 — 生成的配置文件
│   ├── channels.generated.json   # 自动生成
│   ├── providers.generated.json  # 自动生成
│   └── services.generated.json   # 自动生成
├── app.py                        # 修改 — 接入多账号管理器 + 新 API
└── .env.example                  # 修改 — 追加多账号配置示例
```
