from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any


@dataclass
class BuildResult:
    model: Any
    backend: str
    route: str
    reason: str | None = None


class LLMFactory:
    """
    Real-runtime factory only.
    Priority:
    1) OpenAI-compatible provider (requires base_url + api_key)
    2) Local Ollama fallback (requires reachable Ollama runtime)
    If both fail, raise RuntimeError (fail-closed, no test fallback).
    """

    def __init__(self) -> None:
        self.fallback_ollama_base_url = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").strip()
        self.fallback_ollama_model = os.getenv("OLLAMA_MODEL", "qwen3:59b").strip()

    @staticmethod
    def _require_non_empty(value: str, field: str) -> str:
        text = (value or "").strip()
        if not text:
            raise RuntimeError(f"{field} is empty")
        return text

    def _build_openai_compatible(
        self,
        *,
        model: str,
        base_url: str,
        api_key: str,
        temperature: float,
        timeout: float,
        max_retries: int,
    ) -> Any:
        from langchain_openai import ChatOpenAI

        safe_model = self._require_non_empty(model, "model")
        safe_base_url = self._require_non_empty(base_url, "base_url")
        safe_api_key = self._require_non_empty(api_key, "api_key")
        return ChatOpenAI(
            model=safe_model,
            base_url=safe_base_url,
            api_key=safe_api_key,
            temperature=temperature,
            timeout=timeout,
            max_retries=max_retries,
        )

    def _build_ollama(
        self,
        *,
        model: str,
        base_url: str,
        temperature: float,
        timeout: float,
    ) -> Any:
        from langchain_ollama import ChatOllama

        safe_model = self._require_non_empty(model, "ollama_model")
        safe_base_url = self._require_non_empty(base_url, "ollama_base_url")
        return ChatOllama(
            model=safe_model,
            base_url=safe_base_url,
            temperature=temperature,
            client_kwargs={"timeout": timeout},
        )

    def build(
        self,
        *,
        target_name: str,
        model: str,
        base_url: str,
        api_key: str,
        temperature: float,
        timeout: float,
        max_retries: int,
        route_if_success: str,
        model_override: str | None = None,
    ) -> BuildResult:
        picked_model = (model_override or model).strip() or model

        openai_error: Exception | None = None
        try:
            llm = self._build_openai_compatible(
                model=picked_model,
                base_url=base_url,
                api_key=api_key,
                temperature=temperature,
                timeout=timeout,
                max_retries=max_retries,
            )
            return BuildResult(model=llm, backend=f"chatopenai:{target_name}", route=route_if_success)
        except Exception as exc:  # noqa: BLE001
            openai_error = exc

        try:
            ollama_model = os.getenv("OLLAMA_MODEL", picked_model or self.fallback_ollama_model).strip()
            ollama_base = os.getenv("OLLAMA_BASE_URL", self.fallback_ollama_base_url).strip()
            llm = self._build_ollama(
                model=ollama_model or self.fallback_ollama_model,
                base_url=ollama_base or self.fallback_ollama_base_url,
                temperature=temperature,
                timeout=timeout,
            )
            return BuildResult(
                model=llm,
                backend="chatollama:fallback",
                route="local",
                reason=f"openai_compatible_failed: {str(openai_error)[:160] if openai_error else 'unknown'}",
            )
        except Exception as ollama_error:  # noqa: BLE001
            raise RuntimeError(
                "llm factory failed without fallback: "
                f"chatopenai={openai_error}; chatollama={ollama_error}"
            ) from ollama_error


llm_factory = LLMFactory()
