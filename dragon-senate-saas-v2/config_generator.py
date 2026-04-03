"""
ConfigGenerator — 从 .env 生成所有配置文件
"""

from __future__ import annotations

import json
import os
import sys
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


class ConfigGenerator:
    """从环境变量生成项目配置文件"""

    def __init__(self, base_dir: str | Path | None = None) -> None:
        self.base_dir = Path(base_dir) if base_dir else Path(__file__).parent
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.generated: list[str] = []
        self.env = self._load_env()

    def _load_env(self) -> dict[str, str]:
        """Load current env and merge .env file values."""
        merged = dict(os.environ)
        env_path = self.base_dir / ".env"
        if env_path.exists():
            for raw_line in env_path.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in merged:
                    merged[key] = value
        return merged

    def _env(self, name: str, default: str = "") -> str:
        return str(self.env.get(name, default)).strip()

    @contextmanager
    def _patched_env(self) -> Iterator[None]:
        """Temporarily overlay os.environ for modules that rely on os.getenv."""
        backup = dict(os.environ)
        os.environ.update(self.env)
        try:
            yield
        finally:
            os.environ.clear()
            os.environ.update(backup)

    def generate_all(self) -> bool:
        """生成所有配置文件，返回是否全部成功"""
        self._generate_channel_config()
        self._generate_model_config()
        self._generate_service_ports()
        self._generate_docker_compose_override()

        if self.errors:
            print(f"\n配置生成失败，{len(self.errors)} 个错误:")
            for err in self.errors:
                print(f"  - {err}")
            return False

        if self.warnings:
            print(f"\n{len(self.warnings)} 个警告:")
            for warning in self.warnings:
                print(f"  - {warning}")

        print(f"\n配置生成完成，共 {len(self.generated)} 个文件:")
        for file_path in self.generated:
            print(f"  - {file_path}")
        return True

    def check_only(self) -> bool:
        """只检查环境变量是否齐全，不生成文件"""
        required = {"基础": ["API_KEY", "BASE_URL", "MODEL_ID"]}
        optional_groups = {
            "飞书": ["FEISHU_ENABLED", "FEISHU_APP_ID", "FEISHU_APP_SECRET"],
            "钉钉": ["DINGTALK_ENABLED", "DINGTALK_CLIENT_ID", "DINGTALK_CLIENT_SECRET"],
            "企微": ["WECOM_ENABLED", "WECOM_BOT_ID", "WECOM_SECRET"],
            "抖音": ["DOUYIN_ENABLED", "DOUYIN_APP_KEY", "DOUYIN_APP_SECRET"],
            "小红书": ["XIAOHONGSHU_ENABLED", "XIAOHONGSHU_APP_KEY"],
            "Agent Reach": ["AGENT_REACH_ENABLED", "AGENT_REACH_API_URL"],
        }

        all_ok = True
        for group, vars_list in required.items():
            for var in vars_list:
                if not self._env(var):
                    print(f"缺少必需环境变量: {var} ({group})")
                    all_ok = False

        for group, vars_list in optional_groups.items():
            enabled_var = vars_list[0]
            if self._env(enabled_var).lower() in {"1", "true", "yes", "on"}:
                for var in vars_list[1:]:
                    if not self._env(var):
                        print(f"{group} 已启用但缺少: {var}")
                        self.warnings.append(f"{group} 缺少 {var}")
            else:
                print(f"{group}: 未启用")
        return all_ok

    def _generate_channel_config(self) -> None:
        """生成渠道配置 JSON"""
        with self._patched_env():
            from channel_account_manager import channel_account_manager

            channel_account_manager.reload_from_env()
            config = channel_account_manager.describe()

        output_path = self.base_dir / "config" / "channels.generated.json"
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        self.generated.append(str(output_path))

    def _generate_model_config(self) -> None:
        """生成 LLM Provider 配置"""
        providers = []
        api_key = self._env("API_KEY")
        base_url = self._env("BASE_URL")
        model_id = self._env("MODEL_ID")
        if api_key and base_url:
            providers.append(
                {
                    "name": model_id or "default",
                    "base_url": base_url,
                    "model_id": model_id,
                    "protocol": self._env("API_PROTOCOL", "openai"),
                    "context_window": int(self._env("CONTEXT_WINDOW", "128000") or "128000"),
                    "max_tokens": int(self._env("MAX_TOKENS", "8192") or "8192"),
                }
            )
        elif self._env("LOCAL_LLM_BASE_URL") and self._env("LOCAL_LLM_MODEL"):
            providers.append(
                {
                    "name": "local_llm",
                    "base_url": self._env("LOCAL_LLM_BASE_URL"),
                    "model_id": self._env("LOCAL_LLM_MODEL"),
                    "protocol": "openai",
                    "context_window": int(self._env("CONTEXT_WINDOW", "128000") or "128000"),
                    "max_tokens": int(self._env("MAX_TOKENS", "8192") or "8192"),
                }
            )

        if self._env("CLOUD_LLM_BASE_URL") and self._env("CLOUD_LLM_MODEL"):
            providers.append(
                {
                    "name": self._env("CLOUD_LLM_VENDOR", "cloud_llm") or "cloud_llm",
                    "base_url": self._env("CLOUD_LLM_BASE_URL"),
                    "model_id": self._env("CLOUD_LLM_MODEL"),
                    "protocol": "openai",
                    "context_window": int(self._env("CONTEXT_WINDOW", "128000") or "128000"),
                    "max_tokens": int(self._env("MAX_TOKENS", "8192") or "8192"),
                }
            )

        for i in range(2, 7):
            name = self._env(f"MODEL{i}_NAME")
            url = self._env(f"MODEL{i}_BASE_URL")
            if name and url:
                providers.append(
                    {
                        "name": name,
                        "base_url": url,
                        "model_id": self._env(f"MODEL{i}_MODEL_ID"),
                        "protocol": self._env(f"MODEL{i}_PROTOCOL", "openai"),
                        "context_window": int(self._env(f"MODEL{i}_CONTEXT_WINDOW", "128000") or "128000"),
                        "max_tokens": int(self._env(f"MODEL{i}_MAX_TOKENS", "8192") or "8192"),
                    }
                )

        output_path = self.base_dir / "config" / "providers.generated.json"
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump({"providers": providers}, f, ensure_ascii=False, indent=2)
        self.generated.append(str(output_path))

    def _generate_service_ports(self) -> None:
        """生成微服务端口配置"""
        services = {
            "dragon_senate": int(self._env("DRAGON_SENATE_PORT", "18000") or "18000"),
            "policy_router": int(self._env("POLICY_ROUTER_PORT", "8010") or "8010"),
            "trust_verification": int(self._env("TRUST_VERIFY_PORT", "8020") or "8020"),
            "cti_engine": int(self._env("CTI_ENGINE_PORT", "8030") or "8030"),
            "xai_scorer": int(self._env("XAI_SCORER_PORT", "8040") or "8040"),
            "lobster_memory": int(self._env("LOBSTER_MEMORY_PORT", "8000") or "8000"),
            "backend": int(self._env("BACKEND_PORT", "48789") or "48789"),
            "web": int(self._env("WEB_PORT", "3301") or "3301"),
        }

        output_path = self.base_dir / "config" / "services.generated.json"
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump({"services": services}, f, ensure_ascii=False, indent=2)
        self.generated.append(str(output_path))

    def _generate_docker_compose_override(self) -> None:
        """生成 docker-compose.override.yml（端口和环境变量覆盖）"""
        if not self._env("DOCKER_MODE"):
            return

        override = {"version": "3.8", "services": {}}
        with self._patched_env():
            from channel_account_manager import channel_account_manager

            channel_account_manager.reload_from_env()
            enabled = channel_account_manager.get_all_enabled_channels()

        if enabled:
            override["services"]["dragon-senate"] = {"environment": {"ENABLED_CHANNELS": ",".join(enabled)}}

        output_path = self.base_dir / "docker-compose.override.yml"
        try:
            import yaml  # type: ignore

            with open(output_path, "w", encoding="utf-8") as f:
                yaml.dump(override, f, default_flow_style=False, allow_unicode=True)
            self.generated.append(str(output_path))
        except ImportError:
            json_path = output_path.with_suffix(".json")
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(override, f, ensure_ascii=False, indent=2)
            self.generated.append(str(json_path))


if __name__ == "__main__":
    generator = ConfigGenerator()
    if "--check" in sys.argv:
        ok = generator.check_only()
        sys.exit(0 if ok else 1)
    ok = generator.generate_all()
    sys.exit(0 if ok else 1)
