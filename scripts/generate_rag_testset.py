from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_DIR = ROOT / "dragon-senate-saas-v2"
if str(RUNTIME_DIR) not in sys.path:
    sys.path.insert(0, str(RUNTIME_DIR))

from llm_quality_judge import get_quality_judge  # noqa: E402
from rag_testset_generator import RagTestsetGenerator  # noqa: E402


logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


async def _main() -> None:
    parser = argparse.ArgumentParser(description="Generate a RAG evaluation testset from enterprise memory.")
    parser.add_argument("--tenant-id", required=True, help="Target tenant ID.")
    parser.add_argument("--size", type=int, default=50, help="Total generated questions.")
    parser.add_argument("--name", default="", help="Optional dataset name override.")
    args = parser.parse_args()

    generator = RagTestsetGenerator(get_quality_judge()._call_judge_llm)  # noqa: SLF001
    result = await generator.generate(
        args.tenant_id,
        test_size=max(1, int(args.size)),
        dataset_name=str(args.name or "").strip() or None,
        save_to_dataset_store=True,
    )
    print(f"Generated {result['generated']} items for tenant={result['tenant_id']}")
    print(f"Dataset: {result['dataset_name']} ({result.get('dataset_id')})")
    print(result["question_type_breakdown"])


if __name__ == "__main__":
    asyncio.run(_main())
