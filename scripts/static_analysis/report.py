"""Bounded deterministic renderers for static-analysis observation output."""

from __future__ import annotations

import json
from typing import Any

from .inventory import Inventory


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


__all__ = ["render_json", "render_markdown"]
