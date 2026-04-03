"""
skill_effectiveness_calibrator.py — 技能效力评级校准器 (CODEX-PC-04)

从 lobster_pool_manager 的 step reward 数据中统计每个技能在不同
行业/渠道下的历史表现，自动更新 LobsterSkillRegistry 中的 effectiveness 字段。

触发方式:
  - API: POST /api/skills/calibrate
  - 定期任务: 由 workflow_scheduler 每日凌晨触发
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("skill_effectiveness_calibrator")


class SkillEffectivenessCalibrator:
    """
    技能效力评级校准器。

    从 step reward 历史数据中计算每个技能在不同行业/渠道的评级，
    并写回 LobsterSkillRegistry。

    约束:
    - 仅在 sample_size > MIN_SAMPLE 时才覆盖人工初始评级
    - 评级是数值 1-5，由 reward (0.0-1.0) 映射而来
    - confidence = min(1.0, sample_size / 100)
    """

    MIN_SAMPLE = 10  # 低于此样本量不更新评级

    def __init__(self, registry: Any | None = None) -> None:
        if registry is None:
            from lobster_skill_registry import get_skill_registry
            registry = get_skill_registry()
        self._registry = registry

    # ── 核心校准方法 ──────────────────────────────────────────────

    def calibrate_from_rewards(self, reward_history: list[dict[str, Any]]) -> dict[str, Any]:
        """
        从 step reward 历史中校准评级并回写注册表。

        Args:
            reward_history: 列表，每条记录格式:
                {
                    "skill_id": "inkwriter_copy_generate",
                    "industry": "beauty",
                    "channel": "xiaohongshu",
                    "reward": 0.85,      # 0.0-1.0
                    "timestamp": "...",  # ISO
                }

        Returns:
            {
                "calibrated": <count>,
                "skills": {"skill_id": {"overall": 4, ...}, ...},
            }
        """
        # 按 skill_id 聚合
        buckets: dict[str, list[dict[str, Any]]] = {}
        for r in reward_history:
            sid = str(r.get("skill_id") or "").strip()
            if not sid:
                continue
            buckets.setdefault(sid, []).append(r)

        results: dict[str, Any] = {}
        for skill_id, rows in buckets.items():
            skill = self._registry.get(skill_id)
            if skill is None:
                continue

            n = len(rows)
            if n < self.MIN_SAMPLE:
                logger.debug("Skipping %s — only %d samples (min %d)", skill_id, n, self.MIN_SAMPLE)
                continue

            rewards = [float(r.get("reward") or 0.0) for r in rows]
            avg = sum(rewards) / n
            overall = max(1, min(5, round(avg * 5)))

            # 按行业聚合
            by_industry = self._aggregate_dimension(rows, "industry")
            # 按渠道聚合
            by_channel = self._aggregate_dimension(rows, "channel")

            confidence = min(1.0, n / 100.0)

            from lobster_skill_registry import SkillEffectivenessRating
            new_rating = SkillEffectivenessRating(
                overall=overall,
                by_industry=by_industry,
                by_channel=by_channel,
                sample_size=n,
                last_calibrated=datetime.now(timezone.utc).isoformat(),
                confidence=confidence,
            )
            skill.effectiveness = new_rating
            results[skill_id] = new_rating.to_dict()
            logger.info(
                "Calibrated %s: overall=%d, samples=%d, confidence=%.2f",
                skill_id, overall, n, confidence,
            )

        return {"calibrated": len(results), "skills": results}

    def calibrate_from_pool_manager(self, limit: int = 1000) -> dict[str, Any]:
        """
        从 lobster_pool_manager 的 step reward 数据库中拉取历史并校准。
        这是最常用的入口，供 API 端点直接调用。
        """
        try:
            from lobster_pool_manager import get_all_step_rewards
            history = get_all_step_rewards(limit=limit)
        except Exception as exc:
            logger.warning("Failed to load reward history from pool_manager: %s", exc)
            history = []

        return self.calibrate_from_rewards(history)

    # ── 推荐方法 ─────────────────────────────────────────────────

    def get_recommended_skills(
        self,
        lobster_id: str,
        industry: str | None = None,
        channel: str | None = None,
        top_n: int = 5,
    ) -> list[dict[str, Any]]:
        """
        按效力评级返回推荐技能列表（Commander 技能选择使用）。

        Returns:
            [{"skill_id": ..., "name": ..., "score": 1-5, "confidence": 0-1}, ...]
        """
        skills = self._registry.get_by_lobster(lobster_id)
        scored: list[dict[str, Any]] = []

        for s in skills:
            if not s.enabled:
                continue
            score = float(s.effectiveness.overall)
            if industry:
                score = float(s.effectiveness.get_industry_rating(industry))
            if channel:
                ch_score = float(s.effectiveness.get_channel_rating(channel))
                score = (score + ch_score) / 2.0
            scored.append({
                "skill_id": s.id,
                "name": s.name,
                "score": score,
                "confidence": s.effectiveness.confidence,
                "icon": s.icon,
                "category": s.category or "",
            })

        scored.sort(key=lambda x: (x["score"], x["confidence"]), reverse=True)
        return scored[:top_n]

    # ── 私有辅助 ─────────────────────────────────────────────────

    def _aggregate_dimension(
        self, rows: list[dict[str, Any]], field: str
    ) -> dict[str, int]:
        """按维度（industry/channel）聚合 reward，映射到 1-5。"""
        buckets: dict[str, list[float]] = {}
        for r in rows:
            val = str(r.get(field) or "").strip()
            if val:
                buckets.setdefault(val, []).append(float(r.get("reward") or 0.0))
        return {
            k: max(1, min(5, round(sum(vs) / len(vs) * 5)))
            for k, vs in buckets.items()
        }


# ── 模块级便捷函数 ────────────────────────────────────────────────

_calibrator: SkillEffectivenessCalibrator | None = None


def get_calibrator() -> SkillEffectivenessCalibrator:
    global _calibrator
    if _calibrator is None:
        _calibrator = SkillEffectivenessCalibrator()
    return _calibrator
