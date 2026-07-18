"""Contract tests for the deny-by-default exemption registry model."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from scripts.static_analysis.model import (
    Classification,
    Mechanism,
    RegistryError,
    TargetKind,
    load_registry,
)

pytestmark = pytest.mark.unit

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "registry"
TODAY = date(2026, 7, 19)


def _load_fixture(name: str):
    return load_registry(FIXTURE_DIR / name, today=TODAY)


def test_valid_empty_registry_is_deny_by_default() -> None:
    registry = _load_fixture("valid-empty.toml")

    assert registry.schema_version == 1
    assert registry.default == "deny"
    assert registry.exemptions == ()


def test_valid_structural_entry_normalizes_and_types_fields() -> None:
    registry = _load_fixture("valid-structural.toml")
    entry = registry.exemptions[0]

    assert entry.id == "web-eslint-structural-001"
    assert entry.classification is Classification.STRUCTURAL
    assert entry.mechanism is Mechanism.INLINE
    assert entry.target_kind is TargetKind.SYMBOL
    assert entry.path == "apps/web/src/views/chat/index.vue"
    assert entry.target == "sendMessage"
    assert entry.tests == ("scripts/tests/static_analysis/test_model.py",)
    assert entry.expires_on is None
    assert entry.remediation is None


def test_valid_temporary_entry_requires_and_retains_lifecycle() -> None:
    registry = _load_fixture("valid-temporary.toml")
    entry = registry.exemptions[0]

    assert entry.classification is Classification.TEMPORARY
    assert entry.expires_on == date(2026, 8, 31)
    assert entry.remediation == "Remove the directive after the replacement lands."


@pytest.mark.parametrize(
    "fixture",
    [
        "wrong-schema.toml",
        "unknown-top-level.toml",
        "unknown-policy-key.toml",
        "unknown-entry-key.toml",
        "default-allow.toml",
        "duplicate-id.toml",
        "duplicate-authorization.toml",
        "unsupported-target-kind.toml",
        "unsupported-mechanism.toml",
        "malformed-fingerprint.toml",
        "missing-target.toml",
        "wildcard-authority.toml",
        "empty-tests.toml",
        "expired-temporary.toml",
        "temporary-missing-lifecycle.toml",
        "structural-missing-counterfactual.toml",
        "forbidden-classification.toml",
    ],
)
def test_malformed_registry_fails_closed(fixture: str) -> None:
    with pytest.raises(RegistryError):
        _load_fixture(fixture)


def test_expiration_boundary_is_inclusive() -> None:
    entry = _load_fixture("valid-temporary.toml").exemptions[0]

    assert entry.expires_on == TODAY.replace(month=8, day=31)


def test_temporary_expiration_is_bounded_by_policy() -> None:
    with pytest.raises(RegistryError, match="2026-08-31"):
        load_registry(FIXTURE_DIR / "after-policy-expiration.toml", today=TODAY)


@pytest.mark.parametrize(
    "fixture",
    ["absolute-path.toml", "parent-path.toml", "wildcard-path.toml"],
)
def test_unsafe_repository_paths_are_rejected(fixture: str) -> None:
    with pytest.raises(RegistryError, match="path"):
        _load_fixture(fixture)


def test_duplicate_authorization_requires_exact_identity_not_just_id() -> None:
    with pytest.raises(RegistryError, match="duplicate authorization"):
        _load_fixture("duplicate-authorization.toml")
