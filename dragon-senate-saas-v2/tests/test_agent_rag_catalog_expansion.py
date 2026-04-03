from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agent_rag_pack_factory import list_targets


CATALOG_PATH = ROOT / "rag_factory" / "rag_seed_catalog.json"


def _load_catalog() -> dict:
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8-sig"))


def _pack_count_by_agent(catalog: dict) -> dict[str, int]:
    counts: dict[str, int] = {}
    for agent in catalog["base_agents"]:
        counts[str(agent["agent_id"])] = len(agent["knowledge_targets"])
    for variant in catalog["ninth_agent_variants"].values():
        counts[str(variant["agent_id"])] = len(variant["knowledge_targets"])
    return counts


class AgentRagCatalogExpansionTestCase(unittest.TestCase):
    def test_catalog_total_packs_is_132(self) -> None:
        catalog = _load_catalog()
        counts = _pack_count_by_agent(catalog)
        self.assertEqual(sum(counts.values()), 132)

    def test_visualizer_has_15_packs(self) -> None:
        catalog = _load_catalog()
        counts = _pack_count_by_agent(catalog)
        self.assertEqual(counts["visualizer"], 15)

    def test_followup_has_12_packs(self) -> None:
        catalog = _load_catalog()
        counts = _pack_count_by_agent(catalog)
        self.assertEqual(counts["followup"], 12)

    def test_feedback_profile_targets_expand_without_batch_generator_changes(self) -> None:
        targets = list_targets(profile="feedback")
        self.assertGreaterEqual(len(targets), 122)

    def test_followup_profile_targets_expand_without_batch_generator_changes(self) -> None:
        targets = list_targets(profile="followup")
        self.assertEqual(len(targets), 122)

    def test_base_agent_pack_counts_match_expansion_targets(self) -> None:
        catalog = _load_catalog()
        counts = _pack_count_by_agent(catalog)
        self.assertEqual(counts["visualizer"], 15)
        self.assertEqual(counts["radar"], 14)
        self.assertEqual(counts["strategist"], 14)
        self.assertEqual(counts["inkwriter"], 14)
        self.assertEqual(counts["dispatcher"], 14)


if __name__ == "__main__":
    unittest.main()
