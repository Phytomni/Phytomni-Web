"""Contract tests for bounded, deterministic inventory output."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from scripts.static_analysis.inventory import Inventory, reconcile
from scripts.static_analysis.model import Finding, Mechanism, TargetKind, load_registry
from scripts.static_analysis.report import (
    render_json,
    render_markdown,
    render_temporary_candidates,
)

pytestmark = pytest.mark.unit

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "registry"
TODAY = date(2026, 7, 19)


def _inventory() -> Inventory:
    registry = load_registry(FIXTURE_DIR / "valid-empty.toml", today=TODAY)
    findings = (
        Finding(
            tool="fixture-tool",
            rule="fixture-rule",
            mechanism=Mechanism.INLINE,
            target_kind=TargetKind.SPAN,
            path="apps/web/src/fixture.ts",
            target="target",
            fingerprint="sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            message="fixture-secret source body",
            display_line=11,
            tool_version="fixture-version",
            evidence=("fixture-secret source body",),
        ),
    )
    reconciliation = reconcile(findings, registry, today=TODAY)
    return Inventory(
        findings=findings,
        registry=registry,
        reconciliation=reconciliation,
        scope="full",
        collectors=("source",),
    )


def test_json_is_machine_readable_and_omits_source_bodies() -> None:
    rendered = render_json(_inventory())
    payload = json.loads(rendered)

    assert payload["status"] == "NOT ENFORCED"
    assert payload["counts"]["unregistered"] == 1
    assert payload["findings"][0]["path"] == "apps/web/src/fixture.ts"
    assert "target" not in payload["findings"][0]
    assert "fixture-secret" not in rendered
    assert "source body" not in rendered


def test_markdown_is_bounded_and_explicitly_observation_only() -> None:
    rendered = render_markdown(_inventory())

    assert "**NOT ENFORCED**" in rendered
    assert "fixture-tool" in rendered
    assert "fixture-rule" in rendered
    assert "fixture-secret" not in rendered
    assert "source body" not in rendered
    assert rendered.endswith("\n")


def test_temporary_candidate_toml_is_stable_and_exact() -> None:
    inventory = _inventory()
    rendered = render_temporary_candidates(
        inventory.findings,
        inventory.registry,
        owner="web-maintainers",
        introduced_on=TODAY,
        review_on=TODAY,
        expires_on=date(2026, 8, 31),
        remediation_prefix="WEB-SA",
    )

    assert rendered == render_temporary_candidates(
        inventory.findings,
        inventory.registry,
        owner="web-maintainers",
        introduced_on=TODAY,
        review_on=TODAY,
        expires_on=date(2026, 8, 31),
        remediation_prefix="WEB-SA",
    )
    assert 'classification = "temporary"' in rendered
    assert 'target = "target"' in rendered
    assert 'fingerprint = "sha256:' in rendered
    assert "classification = \"structural\"" not in rendered
