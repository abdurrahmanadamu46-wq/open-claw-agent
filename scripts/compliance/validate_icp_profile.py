#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

PLACEHOLDER_PREFIX = "REPLACE_WITH_"


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate ICP launch profile placeholders")
    parser.add_argument(
        "--profile",
        default="deploy/compliance/icp_launch_profile.template.json",
        help="Path to ICP launch profile JSON",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    profile_path = (repo_root / args.profile).resolve()
    if not profile_path.exists():
      print(f"[icp-validate] missing profile: {profile_path}")
      return 1

    payload = json.loads(profile_path.read_text(encoding="utf-8"))
    missing: list[str] = []

    def walk(node: object, prefix: str) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                next_prefix = f"{prefix}.{key}" if prefix else key
                walk(value, next_prefix)
        elif isinstance(node, list):
            for index, value in enumerate(node):
                walk(value, f"{prefix}[{index}]")
        elif isinstance(node, str):
            if node.startswith(PLACEHOLDER_PREFIX):
                missing.append(prefix)

    walk(payload, "")
    print(f"[icp-validate] profile={profile_path}")
    print(f"[icp-validate] unresolved={len(missing)}")
    for item in missing:
        print(f"- {item}")
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
