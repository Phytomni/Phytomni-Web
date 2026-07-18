"""Contract tests for configuration-level suppression inventory."""

from __future__ import annotations

from pathlib import Path

import pytest

from scripts.static_analysis.collectors.config import collect_config_suppressions
from scripts.static_analysis.model import Mechanism, TargetKind

pytestmark = pytest.mark.unit

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "config"


def test_collects_eslint_typescript_and_prettier_configuration() -> None:
    findings = collect_config_suppressions(FIXTURE_DIR)
    identities = {(finding.tool, finding.rule, finding.target) for finding in findings}

    assert ("eslint", "ignore-pattern", "public/") in identities
    assert ("eslint", "no-console", "no-console") in identities
    assert ("typescript", "skipLibCheck", "compilerOptions.skipLibCheck") in identities
    assert ("typescript", "exclude", "exclude.generated/**") in identities
    assert ("prettier", "ignore", "generated/**") in identities

    config = next(
        finding
        for finding in findings
        if finding.tool == "typescript" and finding.rule == "skipLibCheck"
    )
    assert config.mechanism is Mechanism.CONFIG
    assert config.target_kind is TargetKind.CONFIG
    assert config.display_line is None
    assert config.evidence


def test_config_findings_include_unbounded_patterns_for_later_policy_rejection(
) -> None:
    findings = collect_config_suppressions(FIXTURE_DIR)

    assert any(finding.target == "**/*.generated.ts" for finding in findings)
    assert [
        (finding.path, finding.target, finding.rule) for finding in findings
    ] == sorted(
        (finding.path, finding.target, finding.rule) for finding in findings
    )
