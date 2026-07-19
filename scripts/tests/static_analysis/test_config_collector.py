"""Contract tests for configuration-level suppression inventory."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.static_analysis.collectors.config import collect_config_suppressions
from scripts.static_analysis.model import Mechanism, TargetKind

pytestmark = pytest.mark.unit

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "config"
WEB_ROOT = Path(__file__).resolve().parents[3] / "apps" / "web"


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


def test_web_configuration_names_only_exact_owned_boundaries() -> None:
    findings = collect_config_suppressions(WEB_ROOT.parents[1])
    live = {
        (finding.tool, finding.rule, finding.target)
        for finding in findings
        if finding.path in {
            "apps/web/.eslintrc.cjs",
            "apps/web/.prettierignore",
            "apps/web/tsconfig.json",
        }
    }

    assert ("eslint", "ignore-pattern", "dist/") in live
    assert (
        "eslint",
        "ignore-pattern",
        "public/static/js/3Dmol-min.js",
    ) in live
    assert ("eslint", "ignore-pattern", "public/") not in live

    tsconfig = json.loads((WEB_ROOT / "tsconfig.json").read_text(encoding="utf-8"))
    assert "public/modle/3Dmol-min.js" not in tsconfig["include"]
    assert "public/modle" not in tsconfig["include"]

    prettier_ignores = {
        line.strip()
        for line in (WEB_ROOT / ".prettierignore")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }
    assert {
        "public/static/downloads/",
        "public/static/pdb/",
        "public/static/js/3Dmol-min.js",
        "src/assets/agentExample/",
        "src/assets/agentOut/",
    } <= prettier_ignores
    assert "public/" not in prettier_ignores
