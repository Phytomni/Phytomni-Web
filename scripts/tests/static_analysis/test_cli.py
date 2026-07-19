"""Contract tests for observation and exact-check CLI behavior."""

from __future__ import annotations

import tomllib
from dataclasses import replace
from datetime import date
from pathlib import Path

import pytest

import scripts.check_static_analysis_exemptions as cli
from scripts.static_analysis.collectors.errors import CollectionError
from scripts.static_analysis.model import (
    Classification,
    Exemption,
    Finding,
    Mechanism,
    Registry,
    TargetKind,
)

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


def test_partial_collector_scope_does_not_mark_other_surfaces_stale(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    native = replace(
        _finding(),
        tool="eslint",
        mechanism=Mechanism.DIAGNOSTIC,
        target="span:eslint",
    )
    unrelated = replace(
        native,
        mechanism=Mechanism.INLINE,
        target="line:1:eslint-disable",
        fingerprint=(
            "sha256:fedcba9876543210fedcba9876543210"
            "fedcba9876543210fedcba9876543210fedcba9876543210"
        ),
    )
    registry = Registry(
        schema_version=1,
        default="deny",
        exemptions=(
            Exemption(
                id="native",
                tool=native.tool,
                rule=native.rule,
                classification=Classification.TEMPORARY,
                mechanism=native.mechanism,
                target_kind=native.target_kind,
                path=native.path,
                target=native.target,
                fingerprint=native.fingerprint,
                owner="web-maintainers",
                introduced_on=date(2026, 7, 19),
                review_on=date(2026, 7, 19),
                rationale="A fixture-only exact authorization.",
                counterfactual="The native diagnostic remains tracked.",
                risk="Fixture scope only.",
                tests=("scripts/tests/static_analysis/test_cli.py",),
                expires_on=date(2026, 8, 31),
                remediation="Remove the fixture diagnostic.",
            ),
            Exemption(
                id="unrelated-source",
                tool=unrelated.tool,
                rule=unrelated.rule,
                classification=Classification.TEMPORARY,
                mechanism=unrelated.mechanism,
                target_kind=unrelated.target_kind,
                path=unrelated.path,
                target=unrelated.target,
                fingerprint=unrelated.fingerprint,
                owner="web-maintainers",
                introduced_on=date(2026, 7, 19),
                review_on=date(2026, 7, 19),
                rationale="A fixture-only source marker.",
                counterfactual="The source marker remains tracked.",
                risk="Fixture scope only.",
                tests=("scripts/tests/static_analysis/test_cli.py",),
                expires_on=date(2026, 8, 31),
                remediation="Remove the fixture marker.",
            ),
        ),
    )
    monkeypatch.setattr(cli, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(cli, "load_registry", lambda *_args, **_kwargs: registry)
    monkeypatch.setattr(cli, "collect_findings", lambda *_args, **_kwargs: (native,))

    result = cli.main(
        [
            "--check",
            "--json",
            "--collector",
            "eslint",
            "--registry",
            str(tmp_path / "registry.toml"),
            "--today",
            TODAY,
        ]
    )

    payload = __import__("json").loads(capsys.readouterr().out)
    assert result == 0
    assert payload["counts"]["matched"] == 1
    assert payload["counts"]["stale"] == 0
    assert payload["counts"]["unregistered"] == 0


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
    assert "Generated from schema version 1" in first
    assert str(tmp_path) not in first


def test_check_ledger_fails_closed_on_one_byte_difference(
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
    ledger.write_text(
        ledger.read_text(encoding="utf-8").replace(
            "Generated from schema version 1",
            "Generated from schema version 2",
            1,
        ),
        encoding="utf-8",
    )
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
    ) == 1


def _emit_args(registry: Path, output: Path) -> list[str]:
    return [
        "--emit-temporary-candidates",
        "--collector",
        "source",
        "--registry",
        str(registry),
        "--today",
        TODAY,
        "--owner",
        "web-maintainers",
        "--expires-on",
        "2026-08-31",
        "--remediation-prefix",
        "WEB-SA",
        "--output",
        str(output),
    ]


def test_emit_temporary_candidates_requires_explicit_lifecycle_arguments(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(cli, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(cli, "tracked_files", lambda _root: ())
    registry = FIXTURE_DIR / "valid-empty.toml"
    output = tmp_path / "candidates.toml"

    for missing in ("--owner", "--expires-on", "--remediation-prefix"):
        args = _emit_args(registry, output)
        index = args.index(missing)
        del args[index : index + 2]
        assert cli.main(args) == 2
        assert "failed closed" in capsys.readouterr().err


def test_emit_temporary_candidates_writes_exact_targets_and_is_deterministic(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(cli, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(cli, "collect_findings", lambda *args, **kwargs: (_finding(),))
    registry = FIXTURE_DIR / "valid-empty.toml"
    first_output = tmp_path / "first.toml"
    second_output = tmp_path / "second.toml"

    assert cli.main(_emit_args(registry, first_output)) == 0
    assert cli.main(_emit_args(registry, second_output)) == 0
    first = first_output.read_bytes()
    assert first == second_output.read_bytes()

    document = tomllib.loads(first.decode("utf-8"))
    entries = document["exemptions"]
    assert len(entries) == 1
    entry = entries[0]
    assert entry["classification"] == "temporary"
    assert entry["path"] == _finding().path
    assert entry["target"] == _finding().target
    assert entry["fingerprint"] == _finding().fingerprint
    assert entry["remediation"].startswith("WEB-SA")
    assert "structural" not in first.decode("utf-8")
    assert "*" not in entry["target"]
    assert "\ncount =" not in first.decode("utf-8")


def test_emit_refuses_non_empty_registry_unless_merge_and_preserves_ids(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(cli, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(cli, "collect_findings", lambda *args, **kwargs: (_finding(),))
    registry = FIXTURE_DIR / "valid-structural.toml"
    output = tmp_path / "merged.toml"

    assert cli.main(_emit_args(registry, output)) == 2
    merge_args = _emit_args(registry, output)
    merge_args.insert(1, "--merge")
    assert cli.main(merge_args) == 0

    document = tomllib.loads(output.read_text(encoding="utf-8"))
    entries = document["exemptions"]
    ids = {entry["id"] for entry in entries}
    assert "web-eslint-structural-001" in ids
    assert any(entry["classification"] == "temporary" for entry in entries)


def test_emit_encodes_wildcard_authority_as_exact_identity_tokens(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    wildcard = replace(
        _finding(),
        rule="*",
        mechanism=Mechanism.CONFIG,
        target_kind=TargetKind.CONFIG,
        target="src/**",
    )
    monkeypatch.setattr(cli, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(cli, "collect_findings", lambda *args, **kwargs: (wildcard,))
    output = tmp_path / "wildcard.toml"

    assert cli.main(_emit_args(FIXTURE_DIR / "valid-empty.toml", output)) == 0
    text = output.read_text(encoding="utf-8")
    document = tomllib.loads(text)
    entry = document["exemptions"][0]
    assert entry["rule"].startswith("pattern-sha256:")
    assert entry["target"].startswith("pattern-sha256:")
    assert "*" not in text
