"""Contract tests for CI and shell command suppression inventory."""

from __future__ import annotations

from pathlib import Path

import pytest

from scripts.static_analysis.collectors.ci import collect_ci_suppressions
from scripts.static_analysis.model import Mechanism, TargetKind

pytestmark = pytest.mark.unit

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "ci"
ROOT = Path(__file__).resolve().parents[3]


def _runtime_fixture_root(tmp_path: Path) -> Path:
    root = tmp_path / "ci"
    workflow_dir = root / ".github" / "workflows"
    script_dir = root / "scripts"
    workflow_dir.mkdir(parents=True)
    script_dir.mkdir(parents=True)
    (workflow_dir / "fixture.yml").write_text(
        "name: fixture\n\n"
        "jobs:\n"
        "  lint:\n"
        "    continue-on-error: true\n"
        "    steps:\n"
        '      - run: npm run lint --quiet --max-warnings 20 --ignore-pattern "src/**"\n'
        '      - run: npm run lint --ignore-pattern ""\n',
        encoding="utf-8",
    )
    (root / "Makefile").write_text(
        "lint:\n\tnpm run lint --quiet --max-warnings 0\n",
        encoding="utf-8",
    )
    (script_dir / "fixture.sh").write_text(
        "#!/usr/bin/env bash\n"
        "npm run lint || true\n"
        "if ! npm run type-check; then\n"
        "    exit 1\n"
        "fi\n"
        "npm run build || {\n"
        "    rc=$?\n"
        '    exit "$rc"\n'
        "}\n"
        "# The phrase npm run lint || true in this comment is not a live fallback.\n",
        encoding="utf-8",
    )
    return root


def test_collects_workflow_and_shell_fallback_suppressions(tmp_path: Path) -> None:
    findings = collect_ci_suppressions(_runtime_fixture_root(tmp_path))
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


def test_explicit_return_code_branches_are_not_fallback_success(
    tmp_path: Path,
) -> None:
    findings = collect_ci_suppressions(_runtime_fixture_root(tmp_path))
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
