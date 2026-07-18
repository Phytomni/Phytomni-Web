"""Contract tests for observation and exact-check CLI behavior."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

import scripts.check_static_analysis_exemptions as cli
from scripts.static_analysis.collectors.errors import CollectionError
from scripts.static_analysis.model import Finding, Mechanism, TargetKind

pytestmark = pytest.mark.unit

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "registry"
TODAY = "2026-07-19"


def _finding() -> Finding:
    return Finding(
        tool="fixture-tool",
        rule="fixture-rule",
        mechanism=Mechanism.INLINE,
        target_kind=TargetKind.SPAN,
        path="apps/web/src/fixture.ts",
        target="target",
        fingerprint="sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        message="fixture-secret source body",
        display_line=4,
        tool_version="fixture-version",
        evidence=("fixture-secret source body",),
    )


def test_inventory_mode_reports_empty_tracked_scope_without_failing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(cli, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(cli, "tracked_files", lambda _root: ())

    result = cli.main(
        [
            "--inventory",
            "--collector",
            "source",
            "--registry",
            str(FIXTURE_DIR / "valid-empty.toml"),
            "--today",
            TODAY,
        ]
    )

    captured = capsys.readouterr()
    assert result == 0
    assert "NOT ENFORCED" in captured.out
    assert "Findings" in captured.out
    assert "fixture-secret" not in captured.out


def test_check_mode_fails_only_for_exact_reconciliation_mismatch(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(cli, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(cli, "collect_findings", lambda *args, **kwargs: (_finding(),))

    result = cli.main(
        [
            "--check",
            "--json",
            "--collector",
            "source",
            "--registry",
            str(FIXTURE_DIR / "valid-empty.toml"),
            "--today",
            TODAY,
        ]
    )

    captured = capsys.readouterr()
    assert result == 1
    assert '"status": "NOT ENFORCED"' in captured.out
    assert "fixture-secret" not in captured.out
    assert captured.err == ""


def test_collector_exception_fails_closed_without_echoing_fixture_data(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(cli, "REPO_ROOT", tmp_path)

    def fail(*_args: object, **_kwargs: object) -> tuple[Finding, ...]:
        raise CollectionError("fixture-secret tool crash with empty output")

    monkeypatch.setattr(cli, "collect_findings", fail)

    result = cli.main(
        [
            "--inventory",
            "--collector",
            "source",
            "--registry",
            str(FIXTURE_DIR / "valid-empty.toml"),
            "--today",
            TODAY,
        ]
    )

    captured = capsys.readouterr()
    assert result == 2
    assert "failed closed (CollectionError)" in captured.err
    assert "fixture-secret" not in captured.err
    assert captured.out == ""


def test_ledger_write_and_check_are_byte_stable(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(cli, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(cli, "tracked_files", lambda _root: ())
    ledger = tmp_path / "ledger.md"
    args = [
        "--inventory",
        "--collector",
        "source",
        "--registry",
        str(FIXTURE_DIR / "valid-empty.toml"),
        "--today",
        TODAY,
        "--write-ledger",
        str(ledger),
    ]

    assert cli.main(args) == 0
    first = ledger.read_text(encoding="utf-8")
    assert cli.main(
        [
            "--inventory",
            "--collector",
            "source",
            "--registry",
            str(FIXTURE_DIR / "valid-empty.toml"),
            "--today",
            TODAY,
            "--check-ledger",
            str(ledger),
        ]
    ) == 0
    assert ledger.read_text(encoding="utf-8") == first
