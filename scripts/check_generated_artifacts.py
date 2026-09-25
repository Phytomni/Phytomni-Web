#!/usr/bin/env python3
"""Read-only generated-artifact inventory for review and staging gates."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any


_GENERATED_DIRECTORY_NAMES = {
    ".codex-runtime",
    ".codex-test-cache",
    ".gocache",
    "coverage",
    "test-results",
}
_GENERATED_FILES = {
    "apps/server/phytomni-server",
    "apps/server/server-app",
}


def is_generated_path(value: str) -> bool:
    """Return whether a repository-relative path is tool-owned output."""
    path = value.replace("\\", "/").strip("/")
    if not path:
        return False
    parts = tuple(part for part in path.split("/") if part)
    if any(part in _GENERATED_DIRECTORY_NAMES for part in parts):
        return True
    if any(
        parts[index : index + 2] == ("node_modules", ".vite")
        for index in range(max(0, len(parts) - 1))
    ):
        return True
    return path in _GENERATED_FILES


def _git_lines(repo: Path, *arguments: str) -> list[str]:
    completed = subprocess.run(
        ["git", *arguments],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return sorted(
        line.replace("\\", "/")
        for line in completed.stdout.splitlines()
        if line.strip()
    )


def generated_artifact_inventory(repo: Path) -> dict[str, Any]:
    """Separate generated findings from reviewable untracked business source."""
    root = repo.resolve()
    tracked = _git_lines(root, "ls-files")
    untracked = _git_lines(root, "ls-files", "--others", "--exclude-standard")
    return {
        "schema_version": 1,
        "repository": str(root),
        "tracked_generated": [
            path for path in tracked if is_generated_path(path)
        ],
        "unignored_generated": [
            path for path in untracked if is_generated_path(path)
        ],
        "untracked_business_source": [
            path for path in untracked if not is_generated_path(path)
        ],
    }


def generated_artifact_violations(repo: Path) -> list[str]:
    inventory = generated_artifact_inventory(repo)
    return [
        *(f"tracked generated artifact: {path}" for path in inventory["tracked_generated"]),
        *(f"unignored generated artifact: {path}" for path in inventory["unignored_generated"]),
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args()
    inventory = generated_artifact_inventory(arguments.repo)
    print(json.dumps(inventory, ensure_ascii=False, indent=2))
    if arguments.check and generated_artifact_violations(arguments.repo):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
