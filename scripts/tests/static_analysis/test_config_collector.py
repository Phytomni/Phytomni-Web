"""Contract tests for configuration-level suppression inventory."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.static_analysis.collectors.config import collect_config_suppressions
from scripts.static_analysis.model import Mechanism, TargetKind

pytestmark = pytest.mark.unit

WEB_ROOT = Path(__file__).resolve().parents[3] / "apps" / "web"


def _runtime_fixture_root(tmp_path: Path) -> Path:
    root = tmp_path / "config"
    root.mkdir()
    (root / ".eslintrc.cjs").write_text(
        "module.exports = {\n"
        '  ignorePatterns: ["public/", "**/*.generated.ts"],\n'
        "  rules: {\n"
        '    "no-console": "off",\n'
        "  },\n"
        "};\n",
        encoding="utf-8",
    )
    (root / ".prettierignore").write_text(
        "# generated output is intentionally excluded\n"
        "generated/**\n"
        "dist/\n",
        encoding="utf-8",
    )
    (root / "tsconfig.json").write_text(
        '{\n'
        '  "compilerOptions": {\n'
        '    "skipLibCheck": true\n'
        "  },\n"
        '  "exclude": ["exclude.generated/**", "tests/**"]\n'
        "}\n",
        encoding="utf-8",
    )
    return root


def test_collects_eslint_typescript_and_prettier_configuration(
    tmp_path: Path,
) -> None:
    findings = collect_config_suppressions(_runtime_fixture_root(tmp_path))
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
    tmp_path: Path,
) -> None:
    findings = collect_config_suppressions(_runtime_fixture_root(tmp_path))

    assert any(finding.target == "**/*.generated.ts" for finding in findings)
    assert [
        (finding.path, finding.target, finding.rule) for finding in findings
    ] == sorted(
        (finding.path, finding.target, finding.rule) for finding in findings
    )


def test_web_configuration_names_only_exact_owned_boundaries() -> None:
    findings = collect_config_suppressions(WEB_ROOT.parents[1])
    legacy_model_root = "public/" + "modle"
    live = {
        (finding.tool, finding.rule, finding.target)
        for finding in findings
        if finding.path in {
            "apps/web/.eslintrc.cjs",
            "apps/web/.prettierignore",
            "apps/web/tsconfig.json",
        }
    }

    assert ("eslint", "ignore-pattern", "dist/") not in live
    assert ("eslint", "ignore-pattern", "public/") not in live

    tsconfig = json.loads((WEB_ROOT / "tsconfig.json").read_text(encoding="utf-8"))
    assert f"{legacy_model_root}/3Dmol-min.js" not in tsconfig["include"]
    assert legacy_model_root not in tsconfig["include"]

    assert not any(
        finding.tool == "prettier" and finding.path == "apps/web/.prettierignore"
        for finding in findings
    )
