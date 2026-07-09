#!/usr/bin/env python3
"""Fail if legacy competing brand hexes reappear in the web app."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB_SRC = ROOT / "apps" / "web" / "src"
INDEX = ROOT / "apps" / "web" / "index.html"

BANNED = [
    "409eff",
    "66b1ff",
    "1890ff",
    "626aef",
    "4b6bfb",
    "4f46e5",
    "7c3aed",
    "7171c6",
    "3aa3ed",
]
PATTERN = re.compile(
    r"#(?:" + "|".join(BANNED) + r")\b",
    re.IGNORECASE,
)
TEXT_SUFFIXES = {".vue", ".css", ".scss", ".ts", ".tsx", ".js", ".html"}
SKIP_BASENAMES = {"tokens.ts", "tokens.spec.ts"}
SKIP_PARTS = {"node_modules", ".git"}


def should_skip_file(path: Path) -> bool:
    if path.name in SKIP_BASENAMES:
        return True
    return any(part in SKIP_PARTS for part in path.parts)


def scan_paths(paths: list[Path]) -> list[str]:
    hits: list[str] = []
    for path in paths:
        if path.is_dir():
            files = [
                p
                for p in path.rglob("*")
                if p.suffix in TEXT_SUFFIXES and not should_skip_file(p)
            ]
        else:
            files = [] if should_skip_file(path) else [path]
        for file in files:
            try:
                text = file.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            for i, line in enumerate(text.splitlines(), 1):
                if PATTERN.search(line):
                    hits.append(f"{file}:{i}:{line.strip()}")
    return hits


def main() -> int:
    targets = [WEB_SRC, INDEX]
    hits = scan_paths(targets)
    if hits:
        print("Banned brand color hardcodes found:")
        for h in hits:
            print(h)
        return 1
    print("OK: no banned brand color hardcodes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
