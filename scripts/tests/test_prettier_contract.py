"""Contract tests for the standalone, read-only frontend formatter."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]
WEB_ROOT = ROOT / "apps" / "web"
EXPECTED_SCOPE_MARKERS = (
    "src/**/*.",
    "tests/**/*.",
    "vite/**/*.",
    "*.{js,jsx,cjs,mjs,ts,tsx,cts,mts}",
    ".eslintrc.cjs",
    ".prettierrc.cjs",
)
EXPECTED_IGNORES = {
    "dist/",
    "coverage/",
    "node_modules/",
    "package-lock.json",
    "public/static/downloads/",
    "public/static/pdb/",
    "public/static/js/3Dmol-min.js",
    "src/assets/agentExample/",
    "src/assets/agentOut/",
}


def _package() -> dict[str, object]:
    return json.loads((WEB_ROOT / "package.json").read_text(encoding="utf-8"))


def _ignore_entries() -> set[str]:
    return {
        line.strip()
        for line in (WEB_ROOT / ".prettierignore").read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }


def test_prettier_is_exactly_pinned_and_scripts_have_one_write_boundary() -> None:
    package = _package()
    dev_dependencies = package["devDependencies"]
    scripts = package["scripts"]

    assert isinstance(dev_dependencies, dict)
    assert dev_dependencies["prettier"] == "2.7.1"
    assert isinstance(scripts, dict)
    check = scripts["format:check"]
    write = scripts["format:write"]
    lint = scripts["lint"]
    assert isinstance(check, str)
    assert isinstance(write, str)
    assert isinstance(lint, str)
    assert check != write
    assert "--write" not in check
    assert "--fix" not in check
    assert "--fix" not in lint
    assert "format:write" not in lint
    assert all(marker in check and marker in write for marker in EXPECTED_SCOPE_MARKERS)


def test_prettier_ignore_is_exact_without_broad_source_or_public_bypass() -> None:
    entries = _ignore_entries()

    assert EXPECTED_IGNORES <= entries
    assert "src/" not in entries
    assert "tests/" not in entries
    assert "public/" not in entries
    assert all(not entry.startswith("**/") for entry in entries)
