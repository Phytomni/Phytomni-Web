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
    Registry,
    load_registry,
)

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
