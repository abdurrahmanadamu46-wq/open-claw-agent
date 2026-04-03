from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "dragon-senate-saas-v2"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from skill_scanner import ScanResultModel  # noqa: E402
from skill_scanner import scan_skill_content  # noqa: E402

__all__ = ["ScanResultModel", "scan_skill_content"]
