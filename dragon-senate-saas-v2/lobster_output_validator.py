"""
lobster_output_validator.py — 龙虾输出领域规则验证器
=================================================

把行业知识包从“提示注入”进一步推进到“输出验证”。
优先用 commander 做结构化校验，失败时使用保守规则兜底。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, Field

from knowledge_pack_loader import load_industry_pack_payloads


@dataclass(slots=True)
class ValidationResult:
    passed: bool
    violations: list[str] = field(default_factory=list)
    confidence: float = 0.0
    validator: str = "rule"

    def to_dict(self) -> dict[str, Any]:
        return {
            "passed": bool(self.passed),
            "violations": list(self.violations),
            "confidence": float(self.confidence),
            "validator": self.validator,
        }


class _ValidationResultModel(BaseModel):
    passed: bool = True
    violations: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class LobsterOutputValidator:
    VALIDATOR_LOBSTERS = {
        "inkwriter": ["industry-rules.json", "hooks-library.json", "scoring-features.json", "expanded-golden-cases.json"],
        "catcher": ["scoring-features.json"],
        "abacus": ["scoring-features.json"],
        "radar": ["industry-rules.json", "hooks-library.json", "scoring-features.json"],
    }

    async def validate(
        self,
        lobster_id: str,
        output: str,
        industry_tag: str,
    ) -> ValidationResult:
        normalized_lobster = str(lobster_id or "").strip()
        if normalized_lobster not in self.VALIDATOR_LOBSTERS:
            return ValidationResult(passed=True, violations=[], confidence=1.0, validator="skip")
        rules = self._load_rules(normalized_lobster, industry_tag, self.VALIDATOR_LOBSTERS[normalized_lobster])
        if not rules:
            return ValidationResult(passed=True, violations=[], confidence=0.3, validator="empty_rules")

        heuristic = self._heuristic_validate(normalized_lobster, str(output or ""), industry_tag, rules)
        if not heuristic.passed:
            return heuristic

        llm_result = await self._call_commander(normalized_lobster, str(output or ""), rules)
        return llm_result or heuristic

    def _load_rules(self, lobster_id: str, industry_tag: str, pack_files: list[str]) -> list[dict[str, Any]]:
        payloads = load_industry_pack_payloads(lobster_id, industry_tag, pack_files)
        if not payloads and lobster_id != "radar":
            payloads = load_industry_pack_payloads("radar", industry_tag, pack_files)
        rules: list[dict[str, Any]] = []
        for _, payload in payloads.items():
            items = payload.get("items")
            if isinstance(items, list):
                for item in items:
                    if isinstance(item, dict):
                        rules.append(item)
            cases = payload.get("cases")
            if isinstance(cases, list):
                for item in cases:
                    if isinstance(item, dict):
                        rules.append(item)
        return rules

    def _build_validation_prompt(self, output: str, rules: list[dict[str, Any]]) -> str:
        lines: list[str] = []
        for rule in rules[:6]:
            title = str(rule.get("title") or rule.get("id") or "").strip()
            description = str(rule.get("description") or "").strip()
            if title or description:
                lines.append(f"- {title}: {description[:120]}")
        rules_text = "\n".join(lines)
        return (
            f"以下是龙虾的输出内容：\n{output[:1200]}\n\n"
            f"以下是该行业的规则约束：\n{rules_text}\n\n"
            '请检查输出是否违反上述规则。输出严格 JSON: {"passed": true/false, "violations": ["..."], "confidence": 0.0-1.0}'
        )

    async def _call_commander(
        self,
        lobster_id: str,
        output: str,
        rules: list[dict[str, Any]],
    ) -> ValidationResult | None:
        try:
            from llm_router import llm_router
            from lobster_runner import LobsterRunSpec
            from lobster_runner import LobsterRunner
            from lobsters.base_lobster import BaseLobster

            class _CommanderLobster(BaseLobster):
                role_id = "commander"

            commander = _CommanderLobster()
            spec = LobsterRunSpec(
                role_id="commander",
                lobster=commander,
                system_prompt=commander.system_prompt_full,
                user_prompt=(
                    "你是技能输出领域规则验证器。"
                    "只检查输出是否违反给定行业规则，不要改写原文。"
                    f"\n待验证龙虾: {lobster_id}\n\n"
                    + self._build_validation_prompt(output, rules)
                ),
                fresh_context=True,
                meta={
                    "tenant_id": "tenant_main",
                    "user_id": "lobster_output_validator",
                    "task_type": "lobster_output_validate",
                    "approved": True,
                    "channel": "validator",
                },
            )
            parsed = await LobsterRunner(llm_router).run_structured_output(
                spec,
                output_model=_ValidationResultModel,
                max_retries=2,
            )
            if isinstance(parsed, _ValidationResultModel):
                return ValidationResult(
                    passed=bool(parsed.passed),
                    violations=list(parsed.violations),
                    confidence=float(parsed.confidence),
                    validator="commander",
                )
            if hasattr(parsed, "model_dump"):
                data = parsed.model_dump()
                return ValidationResult(
                    passed=bool(data.get("passed", True)),
                    violations=list(data.get("violations", [])),
                    confidence=float(data.get("confidence", 0.0)),
                    validator="commander",
                )
        except Exception:
            return None
        return None

    def _heuristic_validate(
        self,
        lobster_id: str,
        output: str,
        industry_tag: str,
        rules: list[dict[str, Any]],
    ) -> ValidationResult:
        text = str(output or "").strip()
        lowered = text.lower()
        rule_text = " ".join(
            [
                str(item.get("title") or "")
                + " "
                + str(item.get("description") or "")
                + " "
                + " ".join(str(ex) for ex in (item.get("examples") or []))
                + " "
                + " ".join(str(ex) for ex in (item.get("mustAvoid") or []))
                for item in rules
                if isinstance(item, dict)
            ]
        ).lower()

        violations: list[str] = []

        if normalized_contains_any(lowered, ["全网最低价", "最低价", "全城最低", "一口价"]) and normalized_contains_any(
            rule_text,
            ["价格承诺", "全网最低价", "最低价", "绝对承诺"],
        ):
            violations.append("违反行业规则：价格承诺需可核验依据")
        if normalized_contains_any(lowered, ["100%有效", "稳赚不赔", "保证收益"]) and "banned" in rule_text:
            violations.append("违反行业规则：存在绝对化承诺")
        if lobster_id in {"catcher", "abacus"} and not text:
            violations.append("输出为空，无法进行行业规则验证")
        if not violations and industry_tag.startswith("餐饮服务") and normalized_contains_any(lowered, ["零预制", "现炒现做", "官方推荐"]):
            violations.append("违反行业规则：高敏感表述缺少可核验依据")

        if violations:
            return ValidationResult(passed=False, violations=violations, confidence=0.9, validator="rule")
        return ValidationResult(passed=True, violations=[], confidence=0.55, validator="rule")


def normalized_contains_any(text: str, phrases: list[str]) -> bool:
    lowered = str(text or "").lower()
    return any(str(item or "").lower() in lowered for item in phrases if str(item or "").strip())


_validator: LobsterOutputValidator | None = None


def get_lobster_output_validator() -> LobsterOutputValidator:
    global _validator
    if _validator is None:
        _validator = LobsterOutputValidator()
    return _validator
