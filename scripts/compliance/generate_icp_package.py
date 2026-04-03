#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

DOC_KEYWORDS = ("合规", "审计", "白皮书", "标准体系", "隐私", "安全")
EXTRA_FILES = [
    "deploy/new-api/README.md",
    "deploy/compliance/README.md",
    "deploy/compliance/icp_launch_profile.template.json",
    "PROJECT_STATE.md",
    "docs/handover/03-OPEN-ITEMS.md",
]
OFFLINE_GAPS = [
    "Business entity certificates",
    "Domain ownership and real-name verification",
    "Legal authorization letters",
    "Production payment contracts",
]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def collect_files(repo_root: Path) -> list[Path]:
    files: list[Path] = []
    docs_root = repo_root / "docs"
    if docs_root.exists():
        for path in docs_root.rglob("*.md"):
            if any(keyword in path.name for keyword in DOC_KEYWORDS):
                files.append(path)

    for rel_path in EXTRA_FILES:
        path = repo_root / rel_path
        if path.exists():
            files.append(path)

    unique: dict[str, Path] = {}
    for path in files:
        unique[str(path.resolve())] = path
    return sorted(unique.values(), key=lambda item: str(item.relative_to(repo_root)))


def write_summary(output_dir: Path, files: list[Path], repo_root: Path) -> None:
    summary_path = output_dir / "AUDIT_SUMMARY.md"
    lines = [
        "# ICP / Compliance Package",
        "",
        f"- Generated at: {datetime.now(timezone.utc).isoformat()}",
        f"- Included files: {len(files)}",
        "",
        "## Included Materials",
        "",
    ]
    for path in files:
        lines.append(f"- `{path.relative_to(repo_root)}`")
    lines.extend(
        [
            "",
            "## Offline Materials Still Required",
            "",
        ]
    )
    for item in OFFLINE_GAPS:
        lines.append(f"- {item}")
    summary_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_manifest(output_dir: Path, files: list[Path], repo_root: Path) -> None:
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "file_count": len(files),
        "files": [
            {
                "path": str(path.relative_to(repo_root)).replace("\\", "/"),
                "sha256": sha256_file(path),
                "size_bytes": path.stat().st_size,
            }
            for path in files
        ],
        "offline_gaps": OFFLINE_GAPS,
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate ICP/compliance material package from repo docs")
    parser.add_argument(
        "--output-dir",
        default="tmp/icp_materials",
        help="Directory where the package will be created",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    output_dir = (repo_root / args.output_dir).resolve()
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    files = collect_files(repo_root)
    materials_dir = output_dir / "materials"
    materials_dir.mkdir(parents=True, exist_ok=True)

    for source in files:
        target = materials_dir / source.relative_to(repo_root)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)

    write_summary(output_dir, files, repo_root)
    write_manifest(output_dir, files, repo_root)

    print(f"[compliance-pack] output={output_dir}")
    print(f"[compliance-pack] files={len(files)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
