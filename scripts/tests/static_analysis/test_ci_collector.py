"""Contract tests for CI and shell command suppression inventory."""

from __future__ import annotations

from pathlib import Path

import pytest

from scripts.static_analysis.collectors.ci import collect_ci_suppressions
from scripts.static_analysis.model import Mechanism, TargetKind

pytestmark = pytest.mark.unit

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "ci"
ROOT = Path(__file__).resolve().parents[3]


def test_collects_workflow_and_shell_fallback_suppressions() -> None:
    findings = collect_ci_suppressions(FIXTURE_DIR)
    rules = {finding.rule for finding in findings}

    assert "continue-on-error" in rules
    assert "quiet" in rules
    assert "max-warnings" in rules
    assert "ignore-pattern" in rules
    assert "shell-fallback-success" in rules
    assert "empty-argument" in rules
    assert "unbounded-path-pattern" in rules

    fallback = next(
        finding for finding in findings if finding.rule == "shell-fallback-success"
    )
    assert fallback.mechanism is Mechanism.COMMAND
    assert fallback.target_kind is TargetKind.COMMAND
    assert fallback.display_line is not None
    assert "|| true" in fallback.message


def test_explicit_return_code_branches_are_not_fallback_success() -> None:
    findings = collect_ci_suppressions(FIXTURE_DIR)
    messages = [finding.message for finding in findings]

    assert any("npm run lint || true" in message for message in messages)
    assert all("exit \"$rc\"" not in message for message in messages)
    keys = [
        (finding.path, finding.display_line or 0, finding.rule)
        for finding in findings
    ]
    assert keys == sorted(keys)


def test_live_match_scans_use_shared_fail_closed_status_classification() -> None:
    for name in ("hygiene.sh", "contracts.sh"):
        text = (ROOT / "scripts" / "gates" / name).read_text(encoding="utf-8")
        assert "check_match_status" in text
        assert "|| true" not in text
