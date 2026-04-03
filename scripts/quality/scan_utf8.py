#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

TEXT_EXTENSIONS = {
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".cjs",
    ".mjs",
    ".json",
    ".md",
    ".py",
    ".ps1",
    ".yml",
    ".yaml",
    ".toml",
    ".txt",
    ".csv",
    ".html",
    ".css",
    ".scss",
    ".rs",
    ".conf",
    ".env",
    ".example",
}

TEXT_FILENAMES = {
    "Dockerfile",
    "README",
    "VERSION",
}

SKIP_DIRS = {
    ".git",
    ".next",
    "node_modules",
    "dist",
    "__pycache__",
    "logs",
    "pkg-cache",
    "tmp",
    "data",
    "target",
}


def should_scan(path: Path) -> bool:
    if path.name in TEXT_FILENAMES:
        return True
    if path.suffix.lower() in TEXT_EXTENSIONS:
        return True
    if path.name.endswith(".env.example"):
        return True
    return False


def iter_files(root: Path):
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if should_scan(path):
            yield path


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan workspace files for UTF-8 decoding issues")
    parser.add_argument(
        "--roots",
        nargs="*",
        default=["backend", "web", "dragon-senate-saas-v2", "docs", "scripts", "apps"],
        help="Directories to scan",
    )
    parser.add_argument("--limit", type=int, default=100, help="Maximum failures to print")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    failures: list[tuple[str, str]] = []
    scanned = 0

    for raw_root in args.roots:
        root = (repo_root / raw_root).resolve()
        if not root.exists():
            continue
        for path in iter_files(root):
            scanned += 1
            try:
                data = path.read_bytes()
                if b"\x00" in data:
                    continue
                data.decode("utf-8-sig")
            except UnicodeDecodeError as exc:
                failures.append((str(path.relative_to(repo_root)), str(exc)))
                if len(failures) >= max(1, args.limit):
                    break
        if len(failures) >= max(1, args.limit):
            break

    print(f"[utf8-scan] scanned={scanned} failures={len(failures)}")
    for rel_path, message in failures:
        print(f"- {rel_path}: {message}")

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
