"""Contract tests for source-level suppression inventory."""

from __future__ import annotations

from pathlib import Path

import pytest

from scripts.static_analysis.collectors.source import collect_source_suppressions
from scripts.static_analysis.model import Mechanism, TargetKind

pytestmark = pytest.mark.unit

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "source"


def test_collects_supported_source_directives_with_exact_context() -> None:
    root = FIXTURE_DIR
    paths = tuple(sorted(root.glob("*")))

    findings = collect_source_suppressions(root, paths)
    rules = {(finding.tool, finding.rule) for finding in findings}

    assert ("eslint", "no-console") in rules
    assert ("eslint", "@typescript-eslint/no-explicit-any") in rules
    assert ("typescript", "@ts-expect-error") in rules
    assert ("typescript", "@ts-ignore") in rules
    assert ("typescript", "@ts-nocheck") in rules
    assert ("prettier", "prettier-ignore") in rules
    assert ("golangci-lint", "errcheck") in rules
    assert ("go", "go:build") in rules
    assert ("mypy", "index") in rules
    assert ("secret-scan", "pragma: allowlist secret") in rules
    assert ("python", "filterwarnings") in rules

    eslint = next(
        finding
        for finding in findings
        if finding.tool == "eslint" and finding.rule == "no-console"
    )
    assert eslint.mechanism is Mechanism.INLINE
    assert eslint.target_kind is TargetKind.SPAN
    assert eslint.path == "javascript.ts"
    assert eslint.display_line is not None
    assert eslint.evidence
    assert eslint.fingerprint.startswith("sha256:")


def test_source_findings_are_deterministically_sorted_and_descriptions_are_ignored(
) -> None:
    root = FIXTURE_DIR
    findings = collect_source_suppressions(root, tuple(root.glob("*")))

    keys = [
        (finding.path, finding.display_line or 0, finding.rule)
        for finding in findings
    ]
    assert keys == sorted(keys)
    assert all(
        "documents eslint-disable" not in finding.message for finding in findings
    )


def test_bot_activation_fixture_mutations_have_no_index_suppression() -> None:
    path = Path(__file__).parents[1] / "test_check_bot_web_activation.py"
    source = path.read_text(encoding="utf-8")

    assert "type: ignore[index]" not in source
