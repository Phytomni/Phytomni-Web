"""Contract tests for exact finding-to-registry reconciliation."""

from __future__ import annotations

from dataclasses import replace
from datetime import date
from pathlib import Path

import pytest

from scripts.static_analysis.inventory import Inventory, reconcile
from scripts.static_analysis.model import (
    Classification,
    Exemption,
    Finding,
    Mechanism,
    Registry,
    TargetKind,
    load_registry,
)
from scripts.static_analysis.inventory import select_registry_for_collectors

pytestmark = pytest.mark.unit

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "registry"
TODAY = date(2026, 7, 19)


def _registry(name: str = "valid-structural.toml") -> Registry:
    return load_registry(FIXTURE_DIR / name, today=TODAY)


def _finding_from(entry: Exemption, *, rule: str | None = None) -> Finding:
    return Finding(
        tool=entry.tool,
        rule=entry.rule if rule is None else rule,
        mechanism=entry.mechanism,
        target_kind=entry.target_kind,
        path=entry.path,
        target=entry.target,
        fingerprint=entry.fingerprint,
        message="fixture-secret source body",
        display_line=7,
        tool_version="fixture-tool",
        evidence=("fixture-secret source body",),
    )


def test_exact_identity_is_matched_without_mismatch() -> None:
    entry = _registry().exemptions[0]

    result = reconcile((_finding_from(entry),), _registry(), today=TODAY)

    assert len(result.matched) == 1
    assert result.matched[0].exemption.id == entry.id
    assert result.unregistered == ()
    assert result.stale == ()
    assert result.duplicates == ()
    assert result.expired == ()


def test_missing_observation_is_stale_and_unknown_rule_is_unregistered() -> None:
    registry = _registry()
    entry = registry.exemptions[0]

    stale = reconcile((), registry, today=TODAY)
    assert stale.stale == (entry,)

    unknown = reconcile((_finding_from(entry, rule="unknown-rule"),), registry, today=TODAY)
    assert len(unknown.unregistered) == 1
    assert unknown.unregistered[0].rule == "unknown-rule"
    assert unknown.stale == (entry,)


def test_duplicate_actual_identity_is_reported_even_when_authorized() -> None:
    entry = _registry().exemptions[0]

    result = reconcile(
        (_finding_from(entry), _finding_from(entry)), _registry(), today=TODAY
    )

    assert result.duplicates == (f"finding:{entry.fingerprint}",)
    assert len(result.matched) == 2


def test_duplicate_registry_authority_is_reported_for_direct_model_input() -> None:
    registry = _registry()
    entry = registry.exemptions[0]
    duplicate = replace(entry, id="web-eslint-structural-duplicate")
    duplicate_registry = Registry(
        schema_version=registry.schema_version,
        default=registry.default,
        exemptions=(entry, duplicate),
    )

    result = reconcile((), duplicate_registry, today=TODAY)

    assert result.duplicates == (
        "registry-authorization:web-eslint-structural-duplicate",
    )


def test_expired_temporary_entry_is_reported_without_loading_expired_toml() -> None:
    temporary = _registry("valid-temporary.toml").exemptions[0]
    expired = replace(
        temporary,
        expires_on=date(2026, 7, 18),
        classification=Classification.TEMPORARY,
    )
    registry = Registry(schema_version=1, default="deny", exemptions=(expired,))

    result = reconcile((), registry, today=TODAY)

    assert result.expired == (expired,)
    assert result.stale == (expired,)


def test_empty_inventory_is_a_valid_no_tracked_files_result() -> None:
    registry = _registry("valid-empty.toml")

    result = reconcile((), registry, today=TODAY)
    inventory = Inventory(
        findings=(),
        registry=registry,
        reconciliation=result,
        scope="full",
        collectors=("source",),
    )

    assert inventory.findings == ()
    assert result.matched == ()
    assert result.unregistered == ()
    assert result.stale == ()


def _surface_entry(
    entry_id: str,
    *,
    tool: str,
    mechanism: Mechanism,
    target: str,
    path: str = "apps/web/src/fixture.ts",
    rule: str = "fixture-rule",
) -> Exemption:
    import hashlib

    digest = hashlib.sha256(entry_id.encode("utf-8")).hexdigest()
    return Exemption(
        id=entry_id,
        tool=tool,
        rule=rule,
        classification=Classification.TEMPORARY,
        mechanism=mechanism,
        target_kind=(
            TargetKind.COMMAND
            if mechanism is Mechanism.COMMAND
            else TargetKind.CONFIG
            if mechanism is Mechanism.CONFIG
            else TargetKind.SPAN
        ),
        path=path,
        target=target,
        fingerprint=f"sha256:{digest}",
        owner="web-maintainers",
        introduced_on=TODAY,
        review_on=TODAY,
        rationale="A fixture-only exact authorization.",
        counterfactual="Removing the fixture marker would invalidate the collector fixture.",
        risk="The scope is limited to a named test fixture.",
        tests=("scripts/tests/static_analysis/test_inventory.py",),
        expires_on=date(2026, 8, 31),
        remediation="Remove the fixture marker when the fixture is retired.",
    )


def test_collector_scopes_reconcile_only_their_authorized_surface() -> None:
    entries = (
        _surface_entry(
            "eslint-diagnostic",
            tool="eslint",
            mechanism=Mechanism.DIAGNOSTIC,
            target="span:eslint",
        ),
        _surface_entry(
            "typescript-diagnostic",
            tool="typescript",
            mechanism=Mechanism.DIAGNOSTIC,
            target="span:typescript",
        ),
        _surface_entry(
            "source-inline",
            tool="eslint",
            mechanism=Mechanism.INLINE,
            target="line:1:eslint-disable",
        ),
        _surface_entry(
            "config-entry",
            tool="eslint",
            mechanism=Mechanism.CONFIG,
            target="ignore-pattern",
            path="apps/web/.eslintrc.cjs",
        ),
        _surface_entry(
            "ci-command",
            tool="shell",
            mechanism=Mechanism.COMMAND,
            target="--quiet",
            path="scripts/gates/example.sh",
        ),
        _surface_entry(
            "source-go-generate",
            tool="go",
            mechanism=Mechanism.COMMAND,
            target="line:1:go:generate:go:generate go run ./tools",
            path="scripts/tests/static_analysis/fixtures/source/go.go",
            rule="go:generate",
        ),
        _surface_entry(
            "go-marker",
            tool="go",
            mechanism=Mechanism.MARKER,
            target="generated:fixture",
            path="apps/server/fixture.go",
        ),
        _surface_entry(
            "go-source-inline",
            tool="golangci-lint",
            mechanism=Mechanism.INLINE,
            target="line:1:nolint",
            path="apps/server/fixture.go",
        ),
    )
    registry = Registry(schema_version=1, default="deny", exemptions=entries)

    native = select_registry_for_collectors(
        registry, ("eslint", "typescript")
    )
    assert {entry.id for entry in native.exemptions} == {
        "eslint-diagnostic",
        "typescript-diagnostic",
    }

    suppressions = select_registry_for_collectors(
        registry, ("source", "config", "ci")
    )
    assert {entry.id for entry in suppressions.exemptions} == {
        "source-inline",
        "go-source-inline",
        "source-go-generate",
        "config-entry",
        "ci-command",
    }

    ci = select_registry_for_collectors(registry, ("ci",))
    assert {entry.id for entry in ci.exemptions} == {"ci-command"}

    go = select_registry_for_collectors(registry, ("go",))
    assert {entry.id for entry in go.exemptions} == {"go-marker"}
