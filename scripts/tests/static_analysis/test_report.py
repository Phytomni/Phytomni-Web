"""Contract tests for bounded, deterministic inventory output."""

from __future__ import annotations

import json
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
from scripts.static_analysis.report import (
    render_approval_candidates,
    render_json,
    render_ledger,
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


def _reviewed_inventory() -> Inventory:
    finding = _inventory().findings[0]
    temporary = Exemption(
        id="fixture-temporary",
        tool=finding.tool,
        rule=finding.rule,
        classification=Classification.TEMPORARY,
        mechanism=finding.mechanism,
        target_kind=finding.target_kind,
        path=finding.path,
        target=finding.target,
        fingerprint=finding.fingerprint,
        owner="web-maintainers",
        introduced_on=TODAY,
        review_on=date(2026, 7, 26),
        expires_on=date(2026, 8, 31),
        remediation="WEB-SA: remove the exact fixture target",
        rationale="A fixture boundary is being replaced.",
        counterfactual="Removing it before replacement would reduce test clarity.",
        risk="The temporary boundary is covered by the fixture test.",
        tests=("scripts/tests/static_analysis/test_report.py",),
    )
    structural = Exemption(
        id="fixture-structural",
        tool="fixture-tool",
        rule="fixture-structural-rule",
        classification=Classification.STRUCTURAL,
        mechanism=Mechanism.CONFIG,
        target_kind=TargetKind.CONFIG,
        path="apps/web/vite.config.ts",
        target="fixture-config",
        fingerprint="sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
        owner="web-maintainers",
        introduced_on=TODAY,
        review_on=date(2026, 8, 19),
        rationale="The fixture config is required by the test harness.",
        counterfactual="Removing it would break the isolated fixture contract.",
        risk="The config is restricted to a test-only path.",
        tests=("scripts/tests/static_analysis/test_report.py",),
    )
    registry = Registry(schema_version=1, default="deny", exemptions=(temporary, structural))
    reconciliation = reconcile((finding,), registry, today=TODAY)
    return Inventory(
        findings=(finding,),
        registry=registry,
        reconciliation=reconciliation,
        scope="full",
        collectors=("fixture-tool",),
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


def test_enforced_reports_are_not_labelled_as_observation() -> None:
    rendered_json = render_json(_inventory(), enforced=True)
    rendered_markdown = render_markdown(_inventory(), enforced=True)

    assert json.loads(rendered_json)["status"] == "ENFORCED"
    assert "# Static-analysis enforcement" in rendered_markdown
    assert "**ENFORCED**" in rendered_markdown
    assert "NOT ENFORCED" not in rendered_markdown


def test_ledger_is_deterministic_bounded_and_links_exact_entries() -> None:
    rendered = render_ledger(_reviewed_inventory())

    assert rendered == render_ledger(_reviewed_inventory())
    assert "Generated from schema version 1" in rendered
    assert "TOML remains the only authorization source" in rendered
    assert "## Structural entries" in rendered
    assert "## Temporary debt" in rendered
    assert "## Risk and linked tests" in rendered
    assert "## Reverse-probe status" in rendered
    assert "## Reconciliation summary" in rendered
    assert "## Regeneration" in rendered
    assert "[apps/web/src/fixture.ts:11](../../apps/web/src/fixture.ts#L11)" in rendered
    assert "[apps/web/vite.config.ts](../../apps/web/vite.config.ts)" in rendered
    assert "fixture-secret" not in rendered
    assert "source body" not in rendered
    assert "Generated at" not in rendered
    assert "\nsecond line" not in rendered
    assert "raw diagnostic omitted" in rendered


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


def test_approval_packet_enumerates_exact_pending_target_without_source_body() -> None:
    rendered = render_approval_candidates(
        _inventory(),
        probe_evidence={"other-native-mechanism": "measured fixture probe: no authorization"},
    )

    assert "Pending human decision" in rendered
    assert "Exact candidate index" in rendered
    assert "Exact decision records" in rendered
    assert "apps/web/src/fixture.ts:11" in rendered
    assert "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" in rendered
    assert "measured fixture probe: no authorization" in rendered
    assert "Reasonable alternatives:" in rendered
    assert "Concrete degradation if rejected:" in rendered
    assert "Retention risk:" in rendered
    assert "fixture-secret" not in rendered
    assert "source body" not in rendered
