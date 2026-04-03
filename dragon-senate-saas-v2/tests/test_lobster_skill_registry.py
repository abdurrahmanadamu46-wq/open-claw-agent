"""Tests for lobster skill registry."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lobster_skill_registry import SkillFieldType, get_skill_registry  # noqa: E402


class TestLobsterSkillRegistry(unittest.TestCase):
    def test_total_skill_count(self):
        """验证所有 46 个技能已注册"""
        registry = get_skill_registry()
        self.assertEqual(len(registry.get_all()), 46)

    def test_visualizer_has_8_skills(self):
        """幻影虾应该有 8 个技能（含数字人视频等）"""
        registry = get_skill_registry()
        skills = registry.get_by_lobster("visualizer")
        self.assertEqual(len(skills), 8)
        skill_ids = [s.id for s in skills]
        self.assertIn("visualizer_digital_human_video", skill_ids)
        self.assertIn("visualizer_ai_prompt", skill_ids)

    def test_radar_has_8_skills(self):
        """触须虾应该有 8 个技能"""
        registry = get_skill_registry()
        skills = registry.get_by_lobster("radar")
        self.assertEqual(len(skills), 8)

    def test_business_loop_coverage(self):
        """验证 7 个业务阶段都有对应龙虾技能覆盖"""
        registry = get_skill_registry()
        categories = set(s.category for s in registry.get_all())
        required = {
            "信号采集",
            "策略规划",
            "内容生产",
            "视觉生产",
            "视频生产",
            "调度执行",
            "互动",
            "转化",
            "线索管理",
            "数据分析",
            "客户跟进",
            "闭环优化",
            "风控",
        }
        self.assertTrue(required.issubset(categories))

    def test_password_field_masked(self):
        """PASSWORD 类型字段在 API 返回时必须脱敏"""
        registry = get_skill_registry()
        skill = registry.get("visualizer_image_gen")
        self.assertIsNotNone(skill)
        skill.config_values["image_api_key"] = "secret-key"
        payload = skill.to_api_dict()
        self.assertEqual(payload["config_values"]["image_api_key"], "***")
        field_types = {f["key"]: f["field_type"] for f in payload["config_fields"]}
        self.assertEqual(field_types["image_api_key"], SkillFieldType.PASSWORD.value)

    def test_skill_payload_includes_prompt_templates(self):
        """技能详情应暴露 design-time Prompt 资产引用。"""
        registry = get_skill_registry()
        skill = registry.get("inkwriter_copy_generate")
        self.assertIsNotNone(skill)
        assert skill is not None
        payload = skill.to_api_dict()
        self.assertGreaterEqual(len(payload["prompt_templates"]), 1)
        prompt_ids = {item["id"] for item in payload["prompt_templates"]}
        self.assertIn("inkwriter.douyin.short-script.v1", prompt_ids)


if __name__ == "__main__":
    unittest.main()
