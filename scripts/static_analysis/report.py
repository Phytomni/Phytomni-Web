"""Bounded deterministic renderers for static-analysis observation output."""

from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import date
from typing import Any

from .inventory import Inventory
from .inventory import (
    canonical_identity,
    canonical_target,
    exemption_key,
    finding_key,
)
from .model import Classification, Exemption, Finding, Registry


def _finding_sort_key(finding: Any) -> tuple[str, str, str, str, str]:
    return (
        finding.tool,
        finding.rule,
        finding.path,
        finding.target,
        finding.fingerprint,
    )


def _finding_view(finding: Any) -> dict[str, Any]:
    """Render identity metadata only; never expose source, evidence, or messages."""

    return {
        "tool": finding.tool,
        "rule": finding.rule,
        "mechanism": finding.mechanism.value,
        "targetKind": finding.target_kind.value,
        "path": finding.path,
        "fingerprint": finding.fingerprint,
        "displayLine": finding.display_line,
        "toolVersion": finding.tool_version,
    }


def _exemption_view(exemption: Any) -> dict[str, Any]:
    return {
        "id": exemption.id,
        "tool": exemption.tool,
        "rule": exemption.rule,
        "classification": exemption.classification.value,
        "mechanism": exemption.mechanism.value,
        "targetKind": exemption.target_kind.value,
        "path": exemption.path,
        "fingerprint": exemption.fingerprint,
        "reviewOn": exemption.review_on.isoformat(),
        "expiresOn": (
            exemption.expires_on.isoformat() if exemption.expires_on is not None else None
        ),
    }


def _counts(inventory: Inventory) -> dict[str, int]:
    reconciliation = inventory.reconciliation
    return {
        "findings": len(inventory.findings),
        "matched": len(reconciliation.matched),
        "unregistered": len(reconciliation.unregistered),
        "stale": len(reconciliation.stale),
        "duplicates": len(reconciliation.duplicates),
        "expired": len(reconciliation.expired),
    }


def _payload(inventory: Inventory) -> dict[str, Any]:
    reconciliation = inventory.reconciliation
    findings = tuple(sorted(inventory.findings, key=_finding_sort_key))
    return {
        "schemaVersion": 1,
        "status": "NOT ENFORCED",
        "scope": inventory.scope,
        "collectors": list(inventory.collectors),
        "counts": _counts(inventory),
        "findings": [_finding_view(item) for item in findings],
        "reconciliation": {
            "unregistered": [_finding_view(item) for item in reconciliation.unregistered],
            "stale": [_exemption_view(item) for item in reconciliation.stale],
            "duplicates": list(reconciliation.duplicates),
            "expired": [_exemption_view(item) for item in reconciliation.expired],
        },
    }


def render_json(inventory: Inventory) -> str:
    """Render stable JSON without raw diagnostic/source bodies."""

    return json.dumps(
        _payload(inventory), ensure_ascii=False, indent=2, sort_keys=True
    ) + "\n"


def _finding_row(finding: Any) -> str:
    return (
        f"| `{finding.tool}` | `{finding.rule}` | `{finding.mechanism.value}` | "
        f"`{finding.target_kind.value}` | `{finding.path}` | `{finding.fingerprint}` |"
    )


def render_markdown(inventory: Inventory) -> str:
    """Render a bounded human-readable observation ledger."""

    reconciliation = inventory.reconciliation
    counts = _counts(inventory)
    lines = [
        "# Static-analysis observation",
        "",
        "> **NOT ENFORCED** — this report observes exact findings but is not a merge gate.",
        "",
        f"- Scope: `{inventory.scope}`",
        f"- Collectors: {', '.join(f'`{name}`' for name in inventory.collectors)}",
        "",
        "## Counts",
        "",
        "| Findings | Matched | Unregistered | Stale | Duplicates | Expired |",
        "| ---: | ---: | ---: | ---: | ---: | ---: |",
        "| "
        + " | ".join(str(counts[key]) for key in (
            "findings",
            "matched",
            "unregistered",
            "stale",
            "duplicates",
            "expired",
        ))
        + " |",
        "",
        "## Finding identities",
        "",
        "| Tool | Rule | Mechanism | Target kind | Path | Fingerprint |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    findings = tuple(sorted(inventory.findings, key=_finding_sort_key))
    lines.extend(_finding_row(item) for item in findings)
    if not findings:
        lines.append("| *(none)* |  |  |  |  |  |")
    lines.extend(
        [
            "",
            "## Reconciliation",
            "",
            f"- Unregistered findings: `{len(reconciliation.unregistered)}`",
            f"- Stale registry entries: `{len(reconciliation.stale)}`",
            f"- Duplicate identities: `{len(reconciliation.duplicates)}`",
            f"- Expired temporary entries: `{len(reconciliation.expired)}`",
            "",
        ]
    )
    return "\n".join(lines)


def _toml_string(value: str) -> str:
    """Encode a value as a TOML basic string without adding dependencies."""

    return json.dumps(value, ensure_ascii=False)


def _toml_entry(entry: Exemption) -> list[str]:
    lines = [
        "[[exemptions]]",
        f"id = {_toml_string(entry.id)}",
        f"tool = {_toml_string(entry.tool)}",
        f"rule = {_toml_string(entry.rule)}",
        f"classification = {_toml_string(entry.classification.value)}",
        f"mechanism = {_toml_string(entry.mechanism.value)}",
        f"target_kind = {_toml_string(entry.target_kind.value)}",
        f"path = {_toml_string(entry.path)}",
        f"target = {_toml_string(entry.target)}",
        f"fingerprint = {_toml_string(entry.fingerprint)}",
        f"owner = {_toml_string(entry.owner)}",
        f"introduced_on = {entry.introduced_on.isoformat()}",
        f"review_on = {entry.review_on.isoformat()}",
    ]
    if entry.expires_on is not None:
        lines.append(f"expires_on = {entry.expires_on.isoformat()}")
    if entry.remediation is not None:
        lines.append(f"remediation = {_toml_string(entry.remediation)}")
    lines.extend(
        [
            f"rationale = {_toml_string(entry.rationale)}",
            f"counterfactual = {_toml_string(entry.counterfactual)}",
            f"risk = {_toml_string(entry.risk)}",
            "tests = ["
            + ", ".join(_toml_string(test) for test in entry.tests)
            + "]",
            "",
        ]
    )
    return lines


def _temporary_entry(
    finding: Finding,
    *,
    owner: str,
    introduced_on: date,
    review_on: date,
    expires_on: date,
    remediation_prefix: str,
    entry_id: str,
) -> Exemption:
    target = canonical_target(
        finding.mechanism.value, finding.target_kind.value, finding.target
    )
    target_label = f"{finding.path}:{target}"
    return Exemption(
        id=entry_id,
        tool=finding.tool,
        rule=canonical_identity(finding.rule),
        classification=Classification.TEMPORARY,
        mechanism=finding.mechanism,
        target_kind=finding.target_kind,
        path=finding.path,
        target=target,
        fingerprint=finding.fingerprint,
        owner=owner,
        introduced_on=introduced_on,
        review_on=review_on,
        expires_on=expires_on,
        remediation=f"{remediation_prefix}: remediate exact target {target_label}",
        rationale=(
            "Observed by the bounded static-analysis inventory; this temporary "
            "record is not approval."
        ),
        counterfactual=(
            "Not adjudicated; remove or replace the exact finding before the "
            "temporary record expires."
        ),
        risk=(
            "Tracking only; the registry entry does not authorize unrelated "
            "findings or future occurrences."
        ),
        tests=("scripts/check_static_analysis_exemptions.py --check",),
    )


def render_temporary_candidates(
    findings: Sequence[Finding],
    registry: Registry,
    *,
    owner: str,
    introduced_on: date,
    review_on: date,
    expires_on: date,
    remediation_prefix: str,
) -> str:
    """Render exact temporary records while preserving reviewed registry IDs."""

    existing = tuple(registry.exemptions)
    existing_keys = {exemption_key(entry) for entry in existing}
    existing_ids = {entry.id for entry in existing}
    candidates: list[Exemption] = []
    seen_findings = set(existing_keys)
    for finding in sorted(findings, key=_finding_sort_key):
        key = finding_key(finding)
        if key in seen_findings:
            continue
        seen_findings.add(key)
        base_id = f"web-sa-{finding.fingerprint.removeprefix('sha256:')}"
        entry_id = base_id
        suffix = 2
        while entry_id in existing_ids:
            entry_id = f"{base_id}-{suffix}"
            suffix += 1
        existing_ids.add(entry_id)
        candidates.append(
            _temporary_entry(
                finding,
                owner=owner,
                introduced_on=introduced_on,
                review_on=review_on,
                expires_on=expires_on,
                remediation_prefix=remediation_prefix,
                entry_id=entry_id,
            )
        )

    entries = tuple(
        sorted(
            (*existing, *candidates),
            key=lambda entry: (
                entry.tool,
                entry.rule,
                entry.path,
                entry.target,
                entry.fingerprint,
                entry.id,
            ),
        )
    )
    lines = [
        "schema_version = 1",
        "",
        "[policy]",
        'default = "deny"',
        "",
    ]
    for entry in entries:
        lines.extend(_toml_entry(entry))
    return "\n".join(lines).rstrip() + "\n"


__all__ = [
    "render_json",
    "render_markdown",
    "render_temporary_candidates",
]
