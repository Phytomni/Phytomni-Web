"""Contract tests for tracked repository-tool exception inventory."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from scripts.static_analysis.collectors.repository_tools import (
    collect_repository_tool_exceptions,
)
from scripts.static_analysis.model import Mechanism

pytestmark = pytest.mark.unit

FIXTURE_ROOT = Path(__file__).parent / "fixtures" / "repository_tools" / "project"


def test_repository_collector_covers_shell_yaml_markdown_formatter_and_secret_scopes(
    tmp_path: Path,
) -> None:
    root = tmp_path / "project"
    shutil.copytree(FIXTURE_ROOT, root)
    marker = "pragma: " + "allowlist secret"
    (root / "docs" / "runtime-secret.md").write_text(
        f"<!-- {marker} -->\n", encoding="utf-8"
    )
    findings = collect_repository_tool_exceptions(root)

    identities = {(finding.tool, finding.rule) for finding in findings}
    assert ("shellcheck", "SC2086") in identities
    assert ("shfmt", "skip") in identities
    assert ("actionlint", "ignore") in identities
    assert ("yamllint", "disable-line") in identities
    assert ("markdownlint", "MD013") in identities
    assert ("prettier", "ignore") in identities
    assert ("secret-scan", "pragma: allowlist secret") in identities
    inline_findings = [
        finding for finding in findings if finding.mechanism is Mechanism.INLINE
    ]
    assert inline_findings
    assert all(finding.mechanism is Mechanism.INLINE for finding in inline_findings)


def test_repository_collector_reads_exact_config_exclusions(tmp_path: Path) -> None:
    root = tmp_path / "project"
    shutil.copytree(FIXTURE_ROOT, root)
    findings = collect_repository_tool_exceptions(root)

    config_findings = {
        (finding.tool, finding.rule, finding.path, finding.target)
        for finding in findings
        if finding.mechanism is Mechanism.CONFIG
    }
    assert (
        "markdownlint",
        "rule-off",
        ".markdownlint.json",
        "MD013",
    ) in config_findings
    assert ("shfmt", "ignore", ".shfmtignore", "generated/*.sh") in config_findings


def test_repository_collector_excludes_ignored_or_generated_trees(
    tmp_path: Path,
) -> None:
    root = tmp_path / "project"
    shutil.copytree(FIXTURE_ROOT, root)
    findings = collect_repository_tool_exceptions(root)

    assert all("node_modules" not in finding.path for finding in findings)
    assert all("dist" not in finding.path for finding in findings)
    assert all(".codex/evidence" not in finding.path for finding in findings)
