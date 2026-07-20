"""Policy tests for the type-aware frontend ESLint project."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]
WEB_ROOT = ROOT / "apps" / "web"
BRIDGE = WEB_ROOT / "scripts" / "quality" / "eslint-inventory.mjs"
PROJECT = WEB_ROOT / "tsconfig.eslint.json"
ESLINT_CONFIG = WEB_ROOT / ".eslintrc.cjs"


def _tracked_frontend_type_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "apps/web"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return [
        path.removeprefix("apps/web/")
        for path in result.stdout.splitlines()
        if path.endswith((".ts", ".tsx", ".vue"))
    ]


def test_eslint_project_covers_every_linted_typescript_file() -> None:
    document = json.loads(PROJECT.read_text(encoding="utf-8"))

    assert document["extends"] == "./tsconfig.json"
    assert set(document["include"]) == {
        "env.d.ts",
        "src/**/*.ts",
        "src/**/*.vue",
        "tests/**/*.ts",
        "tests/**/*.vue",
        "vite/**/*.ts",
        "vite.config.ts",
        "vitest.config.ts",
    }
    allowed = ("src/", "tests/", "vite/")
    exact = {"env.d.ts", "vite.config.ts", "vitest.config.ts"}
    assert all(path.startswith(allowed) or path in exact for path in _tracked_frontend_type_files())


def test_eslint_project_excludes_generated_and_biological_assets() -> None:
    document = json.loads(PROJECT.read_text(encoding="utf-8"))
    excluded = set(document["exclude"])

    assert {"dist", "coverage", "node_modules"}.issubset(excluded)
    assert "src/assets/**/*.md" in excluded
    assert "public/static/js/3Dmol-min.js" in excluded


def test_parser_project_is_scoped_to_typescript_and_vue_files() -> None:
    text = ESLINT_CONFIG.read_text(encoding="utf-8")

    assert 'files: ["**/*.ts", "**/*.tsx", "**/*.vue"]' in text
    assert 'project: "./tsconfig.eslint.json"' in text
    assert "tsconfigRootDir: __dirname" in text


def test_inventory_rejects_a_file_outside_the_project_root() -> None:
    result = subprocess.run(
        ["node", str(BRIDGE), "--root", str(WEB_ROOT), "--file", "../outside.ts"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode != 0
    assert "outside root" in result.stderr
