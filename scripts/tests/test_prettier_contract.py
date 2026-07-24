"""Contract tests for the standalone, read-only frontend formatter."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]
WEB_ROOT = ROOT / "apps" / "web"
FRONTEND_STATIC_GATE = ROOT / "scripts" / "gates" / "frontend-static.sh"
EXPECTED_SCOPE_MARKERS = (
    "src/**/*.",
    "tests/**/*.",
    "vite/**/*.",
    "*.{js,jsx,cjs,mjs,ts,tsx,cts,mts}",
    ".eslintrc.cjs",
    ".prettierrc.cjs",
)
EXPECTED_IGNORES: set[str] = set()


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
    raw_lint = scripts["lint:raw"]
    assert isinstance(check, str)
    assert isinstance(write, str)
    assert isinstance(lint, str)
    assert isinstance(raw_lint, str)
    assert check != write
    assert "--write" not in check
    assert "--fix" not in check
    assert lint == (
        "python3 ../../scripts/check_static_analysis_exemptions.py "
        "--check --collector eslint"
    )
    assert "eslint" in raw_lint
    assert "--format json" in raw_lint
    assert "--fix" not in raw_lint
    assert raw_lint == (
        "eslint src tests vite vite.config.mts vitest.config.mts .eslintrc.cjs "
        "--ext .vue,.js,.jsx,.cjs,.mjs,.ts,.tsx,.cts,.mts --max-warnings 0 "
        "--format json"
    )
    assert "format:write" not in lint
    assert all(marker in check and marker in write for marker in EXPECTED_SCOPE_MARKERS)

    write_commands = [
        name
        for name, command in scripts.items()
        if isinstance(command, str) and ("--write" in command or "--fix" in command)
    ]
    assert write_commands == ["format:write"]


def test_prettier_ignore_has_no_redundant_path_bypass() -> None:
    entries = _ignore_entries()

    assert entries == EXPECTED_IGNORES
    assert "src/" not in entries
    assert "tests/" not in entries
    assert "public/" not in entries
    assert all(not entry.startswith("**/") for entry in entries)


def test_frontend_static_group_runs_standalone_format_check_before_exact_eslint() -> None:
    gate = FRONTEND_STATIC_GATE.read_text(encoding="utf-8")
    format_step = 'step "G2.1 apps/web: Prettier format check (read-only)"'
    eslint_step = 'step "G2 apps/web: exact ESLint reconciliation"'

    assert format_step in gate
    assert "(cd apps/web && npm run --silent format:check)" in gate
    assert gate.index(format_step) < gate.index(eslint_step)


def test_eslint_delegates_formatting_to_standalone_prettier() -> None:
    config = (WEB_ROOT / ".eslintrc.cjs").read_text(encoding="utf-8")

    assert '"@vue/eslint-config-prettier"' in config
    assert '"prettier/prettier"' not in config


def test_first_party_format_check_is_clean() -> None:
    completed = subprocess.run(
        ["npm", "run", "--silent", "format:check"],
        cwd=WEB_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 0, completed.stdout + completed.stderr


def test_eslint_emits_no_prettier_diagnostics() -> None:
    completed = subprocess.run(
        ["npm", "run", "--silent", "lint:raw"],
        cwd=WEB_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 0, completed.stdout + completed.stderr
    reports = json.loads(completed.stdout)
    prettier_messages = [
        message
        for report in reports
        for message in report.get("messages", [])
        if message.get("ruleId") == "prettier/prettier"
    ]
    assert prettier_messages == []
