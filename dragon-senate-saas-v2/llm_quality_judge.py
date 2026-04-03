"""
LLMQualityJudge — LLM-as-Judge 自动质量评估
=============================================
灵感来源：Langfuse Evals（自动评估管道）
借鉴要点：
  - 用另一个 LLM（judge model）对 inkwriter/catcher 等龙虾的输出自动打分
  - 评估维度：quality / relevance / compliance / conversion_potential
  - 评分结果写入 llm_call_logger 的 Score 表，供 Dashboard 趋势分析
  - 支持批量评估（EvalRunner）：对新产生的 Generation 自动触发

使用方式：
    judge = LLMQualityJudge(judge_model="gpt-4o-mini")

    # 单条评估
    result = judge.evaluate(
        gen_id="gn_abc123",
        content="你有多久没和家人...",
        eval_template="copy_quality",
        context={"industry": "餐饮", "platform": "xiaohongshu"},
    )
    # → {"quality": 0.85, "relevance": 0.90, "compliance": 1.0, "conversion_potential": 0.78}

    # 批量评估（对最近 N 条未评估的 Generation）
    runner = EvalRunner(judge)
    runner.run_batch(lobster="inkwriter", limit=20)
"""

from __future__ import annotations

import json
import os
import logging
import asyncio
import time
from typing import Any, Optional

from answer_relevance_metric import AnswerRelevanceMetric
from hallucination_metric import HallucinationMetric


logger = logging.getLogger("llm_quality_judge")

# ─────────────────────────────────────────────────────────────────
# 评估模板定义（对应 Langfuse Eval Templates）
# ─────────────────────────────────────────────────────────────────

EVAL_TEMPLATES: dict[str, dict[str, Any]] = {
    "copy_quality": {
        "name": "文案质量综合评估",
        "lobster": "inkwriter",
        "dimensions": ["quality", "relevance", "compliance", "conversion_potential"],
        "judge_prompt": """你是一位资深的内容营销专家，请对以下社交媒体文案进行客观评分。

【文案内容】
{content}

【行业背景】
行业：{industry}
目标平台：{platform}
目标受众：{target_audience}

请从以下4个维度打分（每项0-1分，保留2位小数）：

1. **quality（内容质量）**：文案的专业性、语言流畅度、结构完整性
2. **relevance（行业相关性）**：内容是否切合{industry}行业特点和受众需求
3. **compliance（合规性）**：是否存在违禁词、夸大宣传、敏感内容（1=完全合规，0=有问题）
4. **conversion_potential（转化潜力）**：是否有明确钩子、行动召唤，预估引发互动的概率

请严格按照以下JSON格式输出，不要添加其他内容：
{
  "quality": 0.00,
  "relevance": 0.00,
  "compliance": 0.00,
  "conversion_potential": 0.00,
  "overall": 0.00,
  "strengths": ["优点1", "优点2"],
  "weaknesses": ["不足1"],
  "improvement_suggestion": "一句话改进建议"
}""",
        "required_context": ["industry", "platform"],
        "optional_context": ["target_audience"],
    },

    "compliance_check": {
        "name": "合规风险评估",
        "lobster": "catcher",
        "dimensions": ["compliance", "risk_level"],
        "judge_prompt": """你是一位专业的内容合规审核员，请对以下内容进行合规风险评估。

【待审核内容】
{content}

【平台】：{platform}

请从合规角度打分：
- compliance（合规分）：0-1，1=完全合规，0=严重违规
- risk_level：low/medium/high

JSON输出：
{
  "compliance": 0.00,
  "risk_level": "low",
  "violations": [],
  "suggestion": ""
}""",
        "required_context": ["platform"],
        "optional_context": [],
    },

    "lead_score_quality": {
        "name": "线索评分准确性评估",
        "lobster": "abacus",
        "dimensions": ["accuracy", "completeness"],
        "judge_prompt": """你是一位销售专家，请评估以下线索评分的准确性。

【评分结果】
{content}

【实际互动记录】
{interaction_data}

请评估评分质量（JSON输出）：
{
  "accuracy": 0.00,
  "completeness": 0.00,
  "feedback": "评估意见"
}""",
        "required_context": ["interaction_data"],
        "optional_context": [],
    },
}


# ─────────────────────────────────────────────────────────────────
# LLMQualityJudge
# ─────────────────────────────────────────────────────────────────

TASK_COMPLETION_PROMPT = """你是一名任务完成度评审员。

请根据用户任务、可选上下文、以及模型输出，判断输出是否完成了任务目标。

【用户任务】
{input_text}

【上下文】
{context_text}

【模型输出】
{output_text}

评分规则：
- 0.0：没有完成任务
- 0.3：只完成一小部分
- 0.6：基本完成，但仍有明显缺口
- 1.0：完整完成，且输出对任务直接可用

只输出 JSON：
{{"task_completion": 0.0, "reason": "一句话说明"}}
"""


class LLMQualityJudge:
    """
    LLM-as-Judge 自动质量评估引擎（对应 Langfuse Evals）。
    使用轻量 judge 模型（默认 gpt-4o-mini）对龙虾输出打分，
    结果写入 llm_call_logger 的 Score 表。
    """

    def __init__(
        self,
        judge_model: str = "gpt-4o-mini",
        judge_provider: str = "openai",
    ) -> None:
        self.judge_model = judge_model
        self.judge_provider = judge_provider
        self.hallucination_metric = HallucinationMetric(self._call_judge_llm)
        self.answer_relevance_metric = AnswerRelevanceMetric(self._call_judge_llm)

    def _call_judge_llm(self, prompt: str) -> Optional[dict[str, Any]]:
        """调用 judge LLM，返回解析后的 JSON 评分结果"""
        try:
            # 动态导入，避免强依赖
            from dragon_senate_saas_v2.provider_registry import get_provider_registry
            reg = get_provider_registry()
            response_text = reg.chat(
                model=self.judge_model,
                messages=[
                    {"role": "system", "content": "你是一位专业的内容质量评估专家，只输出JSON格式结果。"},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.1,
                max_tokens=500,
            )
        except Exception:
            # fallback：尝试直接用 openai
            try:
                import openai
                client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))
                resp = client.chat.completions.create(
                    model=self.judge_model,
                    messages=[
                        {"role": "system", "content": "你是一位专业的内容质量评估专家，只输出JSON格式结果。"},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.1,
                    max_tokens=500,
                )
                response_text = resp.choices[0].message.content or ""
            except Exception as e:
                return {"error": str(e)}

        # 解析 JSON
        try:
            # 提取 JSON 部分（处理 markdown 代码块）
            text = response_text.strip()
            if "```" in text:
                text = text.split("```")[1]
                if text.startswith("json"):
                    text = text[4:]
            return json.loads(text.strip())
        except Exception:
            return {"parse_error": response_text[:200]}

    @staticmethod
    def _normalize_context_text(context: Optional[dict[str, Any]]) -> str:
        if not context:
            return "(no context)"
        lines: list[str] = []
        for key, value in context.items():
            if value in (None, "", [], {}):
                continue
            text = str(value).strip()
            if text:
                lines.append(f"{key}: {text}")
        return "\n".join(lines)[:4000] or "(no context)"

    @staticmethod
    def _default_template_for_lobster(lobster_name: str) -> str:
        return {
            "inkwriter": "copy_quality",
            "catcher": "compliance_check",
            "abacus": "lead_score_quality",
        }.get(str(lobster_name or "").strip(), "copy_quality")

    def _score_task_completion(
        self,
        *,
        input_text: str,
        output_text: str,
        context: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        prompt = TASK_COMPLETION_PROMPT.format(
            input_text=str(input_text or "")[:2000],
            output_text=str(output_text or "")[:3000],
            context_text=self._normalize_context_text(context),
        )
        payload = self._call_judge_llm(prompt) or {}
        if "task_completion" not in payload and "score" in payload:
            payload["task_completion"] = payload.get("score")
        return payload

    def evaluate(
        self,
        content: str,
        eval_template: str = "copy_quality",
        context: Optional[dict[str, str]] = None,
        gen_id: str = "",
        trace_id: str = "",
        tenant_id: str = "tenant_main",
        auto_save_score: bool = True,
    ) -> dict[str, Any]:
        """
        对单条内容进行评估（对应 Langfuse Eval 单次执行）。
        auto_save_score=True 时，自动将评分写入 llm_call_logger Score 表。
        """
        template = EVAL_TEMPLATES.get(eval_template)
        if not template:
            return {"error": f"未知评估模板: {eval_template}"}

        ctx = context or {}
        prompt = template["judge_prompt"].replace("{content}", content)
        for k, v in ctx.items():
            prompt = prompt.replace(f"{{{k}}}", str(v))
        # 替换未填充的可选变量为空字符串
        import re
        prompt = re.sub(r"\{[\w_]+\}", "", prompt)

        t0 = time.time()
        result = self._call_judge_llm(prompt)
        latency_ms = int((time.time() - t0) * 1000)

        if result and "error" not in result and auto_save_score and gen_id:
            self._save_scores(result, gen_id, eval_template, tenant_id, latency_ms)

        return {
            "eval_template": eval_template,
            "judge_model": self.judge_model,
            "latency_ms": latency_ms,
            "gen_id": gen_id,
            "scores": result or {},
        }

    def _save_scores(
        self,
        scores: dict[str, Any],
        gen_id: str,
        eval_template: str,
        tenant_id: str,
        latency_ms: int,
    ) -> None:
        """将评分结果写入 llm_call_logger Score 表"""
        try:
            from dragon_senate_saas_v2.llm_call_logger import get_llm_call_logger
            logger = get_llm_call_logger()
        except ImportError:
            try:
                from llm_call_logger import get_llm_call_logger
                logger = get_llm_call_logger()
            except ImportError:
                return

        numeric_keys = [k for k, v in scores.items()
                        if isinstance(v, (int, float)) and k not in ("latency_ms",)]
        for key in numeric_keys:
            try:
                logger.add_score(
                    gen_id=gen_id,
                    name=f"{eval_template}.{key}",
                    value=float(scores[key]),
                    scorer="llm-judge",
                    comment=f"judge_model={self.judge_model}, latency={latency_ms}ms",
                    tenant_id=tenant_id,
                )
            except Exception:
                pass

    def _save_named_score(
        self,
        *,
        gen_id: str,
        name: str,
        value: float | None = None,
        boolean_value: bool | None = None,
        tenant_id: str = "tenant_main",
        comment: str = "",
    ) -> None:
        if not gen_id:
            return
        try:
            from llm_call_logger import get_llm_call_logger

            llm_logger = get_llm_call_logger()
        except Exception:
            return
        try:
            llm_logger.add_score(
                gen_id=gen_id,
                name=name,
                value=value,
                boolean_value=boolean_value,
                scorer="llm-judge",
                comment=comment,
                tenant_id=tenant_id,
            )
        except Exception:
            return

    def evaluate_with_context(
        self,
        *,
        lobster_name: str = "",
        input_text: str,
        output_text: str,
        context: Optional[dict[str, Any]] = None,
        metrics: Optional[list[str]] = None,
        eval_template: str | None = None,
        gen_id: str = "",
        tenant_id: str = "tenant_main",
    ) -> dict[str, Any]:
        requested_metrics = [str(item).strip() for item in (metrics or []) if str(item).strip()]
        requested_set = set(requested_metrics)
        result_scores: dict[str, Any] = {}
        details: dict[str, Any] = {}

        needs_template_eval = not requested_set or bool(
            requested_set.intersection({"quality", "overall", "relevance", "compliance", "conversion_potential"})
        )
        if needs_template_eval:
            template_name = eval_template or self._default_template_for_lobster(lobster_name)
            payload = self.evaluate(
                content=output_text,
                eval_template=template_name,
                context={str(k): str(v) for k, v in (context or {}).items()},
                gen_id=gen_id,
                tenant_id=tenant_id,
                auto_save_score=bool(gen_id),
            )
            template_scores = payload.get("scores", {}) if isinstance(payload, dict) else {}
            if isinstance(template_scores, dict):
                result_scores.update(template_scores)

        if "task_completion" in requested_set:
            task_completion = self._score_task_completion(
                input_text=input_text,
                output_text=output_text,
                context=context,
            )
            completion_score = float(task_completion.get("task_completion", 0.0) or 0.0)
            result_scores["task_completion"] = round(max(0.0, min(1.0, completion_score)), 3)
            details["task_completion_reason"] = str(task_completion.get("reason", "") or "").strip()
            self._save_named_score(
                gen_id=gen_id,
                name="online_eval.task_completion",
                value=result_scores["task_completion"],
                tenant_id=tenant_id,
                comment=details["task_completion_reason"],
            )

        if "hallucination" in requested_set:
            hallucination = self.hallucination_metric.score(
                input_text=input_text,
                output_text=output_text,
                context=context,
            )
            result_scores["hallucination"] = hallucination.value
            result_scores["hallucination_passed"] = hallucination.passed
            details["hallucination_reason"] = hallucination.reason
            self._save_named_score(
                gen_id=gen_id,
                name="online_eval.hallucination",
                value=hallucination.value,
                tenant_id=tenant_id,
                comment=hallucination.reason,
            )
            self._save_named_score(
                gen_id=gen_id,
                name="online_eval.hallucination_passed",
                boolean_value=hallucination.passed,
                tenant_id=tenant_id,
                comment=hallucination.reason,
            )
            if not hallucination.passed:
                logger.warning(
                    "[QualityJudge] hallucination detected score=%.3f tenant=%s gen_id=%s reason=%s",
                    hallucination.value,
                    tenant_id,
                    gen_id or "-",
                    hallucination.reason,
                )

        if "answer_relevance" in requested_set:
            answer_relevance = asyncio.run(
                self.answer_relevance_metric.score(
                    question=input_text,
                    answer=output_text,
                )
            )
            result_scores["answer_relevance"] = answer_relevance.value
            details["answer_relevance_hypotheses"] = answer_relevance.hypothesis_questions
            self._save_named_score(
                gen_id=gen_id,
                name="online_eval.answer_relevance",
                value=answer_relevance.value,
                tenant_id=tenant_id,
                comment=" | ".join(answer_relevance.hypothesis_questions[:3]),
            )

        if details:
            result_scores.update(details)
        return result_scores

    async def evaluate_async(
        self,
        *,
        lobster_name: str = "",
        input_text: str,
        output_text: str,
        context: Optional[dict[str, Any]] = None,
        metrics: Optional[list[str]] = None,
        eval_template: str | None = None,
        gen_id: str = "",
        tenant_id: str = "tenant_main",
    ) -> dict[str, Any]:
        return await asyncio.to_thread(
            self.evaluate_with_context,
            lobster_name=lobster_name,
            input_text=input_text,
            output_text=output_text,
            context=context,
            metrics=metrics,
            eval_template=eval_template,
            gen_id=gen_id,
            tenant_id=tenant_id,
        )

    async def track_instructor_stats(self, period: str = "") -> dict[str, Any]:
        try:
            from instructor_output_guard import get_instructor_output_guard_store

            stats = get_instructor_output_guard_store().stats_for_period(period)
        except Exception as exc:
            return {
                "period": period or "",
                "error": f"instructor_output_guard_unavailable:{exc}",
                "total_calls": 0,
                "retry_calls": 0,
                "failed_calls": 0,
                "success_rate": 0.0,
                "actual_loss_rate": 0.0,
                "baseline_loss_rate": 2.0,
                "improvement": 0.0,
                "active_seats": 0,
                "monthly_cost_savings": 0,
                "annual_cost_savings": 0,
            }

        active_seats = 0
        try:
            from seat_subscription_service import get_seat_billing_service

            subscriptions = await get_seat_billing_service().list_subscriptions()
            active_seats = sum(
                int(item.get("seat_count") or 0)
                for item in subscriptions
                if str(item.get("status") or "").lower() in {"active", "trial", "trialing"}
            )
        except Exception:
            active_seats = 0

        baseline_loss_rate = float(stats.get("baseline_loss_rate", 2.0) or 2.0)
        actual_loss_rate = float(stats.get("actual_loss_rate", 0.0) or 0.0)
        video_cost_per_seat_baseline = 20 * 15 * baseline_loss_rate
        video_cost_per_seat_actual = 20 * 15 * actual_loss_rate
        monthly_savings = max(0.0, (video_cost_per_seat_baseline - video_cost_per_seat_actual) * active_seats)
        return {
            **stats,
            "active_seats": active_seats,
            "monthly_cost_savings": round(monthly_savings),
            "annual_cost_savings": round(monthly_savings * 12),
        }

    def evaluate_generation(
        self,
        gen_id: str,
        eval_template: str = "copy_quality",
        context: Optional[dict[str, str]] = None,
        tenant_id: str = "tenant_main",
    ) -> dict[str, Any]:
        """
        按 gen_id 查询 llm_call_logger，自动拉取 output_text 进行评估。
        对应 Langfuse Eval 的 linked evaluation（关联到具体 Generation）。
        """
        try:
            from llm_call_logger import get_llm_call_logger
        except ImportError:
            return {"error": "llm_call_logger 未安装"}

        logger = get_llm_call_logger()
        conn = logger._conn()
        try:
            row = conn.execute(
                "SELECT output_text, meta, tenant_id FROM llm_generations WHERE gen_id=?",
                (gen_id,)
            ).fetchone()
        finally:
            conn.close()

        if not row:
            return {"error": f"gen_id={gen_id} 不存在"}

        output_text = row["output_text"]
        meta = json.loads(row["meta"] or "{}")
        tenant = row["tenant_id"] or tenant_id

        # 合并 context（meta 中的 lobster/skill 也一并传入）
        merged_ctx = {**meta, **(context or {})}

        return self.evaluate(
            content=output_text,
            eval_template=eval_template,
            context=merged_ctx,
            gen_id=gen_id,
            tenant_id=tenant,
            auto_save_score=True,
        )


# ─────────────────────────────────────────────────────────────────
# EvalRunner — 批量自动评估（对应 Langfuse Eval Job）
# ─────────────────────────────────────────────────────────────────

class EvalRunner:
    """
    批量自动评估 Runner（对应 Langfuse Eval Worker）。
    定期对未评估的新 Generation 自动触发评估。
    """

    def __init__(self, judge: Optional[LLMQualityJudge] = None) -> None:
        self.judge = judge or LLMQualityJudge()

    def run_batch(
        self,
        lobster: str = "inkwriter",
        eval_template: str = "copy_quality",
        limit: int = 20,
        tenant_id: str = "tenant_main",
        min_output_length: int = 50,
    ) -> dict[str, Any]:
        """
        对最近 N 条来自指定龙虾的、尚未评估的 Generation 运行评估。
        返回评估摘要。
        """
        try:
            from llm_call_logger import get_llm_call_logger
        except ImportError:
            return {"error": "llm_call_logger 未安装"}

        logger = get_llm_call_logger()
        conn = logger._conn()
        try:
            # 找出来自该 lobster 的 Generation（通过 span.lobster 关联）
            # 且在 llm_scores 中尚无该 eval_template 评分的
            rows = conn.execute(
                """SELECT g.gen_id, g.output_text, g.meta, g.tenant_id
                   FROM llm_generations g
                   LEFT JOIN llm_spans s ON g.span_id = s.span_id
                   WHERE (s.lobster=? OR json_extract(g.meta, '$.lobster')=?)
                     AND g.tenant_id=?
                     AND LENGTH(g.output_text) >= ?
                     AND g.status='success'
                     AND g.gen_id NOT IN (
                         SELECT DISTINCT sc.gen_id FROM llm_scores sc
                         WHERE sc.name LIKE ?
                     )
                   ORDER BY g.created_at DESC LIMIT ?""",
                (lobster, lobster, tenant_id, min_output_length,
                 f"{eval_template}.%", limit)
            ).fetchall()
        finally:
            conn.close()

        results = []
        for row in rows:
            gen_id = row["gen_id"]
            output = row["output_text"]
            meta = json.loads(row["meta"] or "{}")
            result = self.judge.evaluate(
                content=output,
                eval_template=eval_template,
                context=meta,
                gen_id=gen_id,
                tenant_id=row["tenant_id"] or tenant_id,
                auto_save_score=True,
            )
            results.append({"gen_id": gen_id, **result.get("scores", {})})

        scored = [r for r in results if "error" not in r]
        return {
            "lobster": lobster,
            "eval_template": eval_template,
            "evaluated": len(scored),
            "skipped": len(results) - len(scored),
            "avg_quality": (
                round(sum(r.get("quality", 0) for r in scored) / len(scored), 3)
                if scored else 0
            ),
            "results": results,
        }


# ─────────────────────────────────────────────────────────────────
# 全局单例
# ─────────────────────────────────────────────────────────────────

_default_judge: Optional[LLMQualityJudge] = None

def get_quality_judge(model: str = "gpt-4o-mini") -> LLMQualityJudge:
    global _default_judge
    if _default_judge is None:
        _default_judge = LLMQualityJudge(judge_model=model)
    return _default_judge
