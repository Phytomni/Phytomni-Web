"""Exact finding reconciliation primitives for static-analysis observation."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from hashlib import sha256

from .model import Exemption, Finding, Registry


FindingKey = tuple[str, str, str, str, str, str, str]
_WILDCARD_CHARS = frozenset("*?[]")


def canonical_identity(value: str) -> str:
    """Encode broad native patterns as exact, immutable identity tokens."""

    if any(char in value for char in _WILDCARD_CHARS):
        digest = sha256(value.encode("utf-8")).hexdigest()
        return f"pattern-sha256:{digest}"
    return value


def canonical_target(mechanism: str, target_kind: str, value: str) -> str:
    if mechanism in {"config", "command"} or target_kind in {"config", "command"}:
        return canonical_identity(value)
    return value


@dataclass(frozen=True, slots=True)
class Match:
    """One actual finding matched to one exact registry authorization."""

    finding: Finding
    exemption: Exemption


@dataclass(frozen=True, slots=True)
class Reconciliation:
    """The complete exact-set comparison result."""

    matched: tuple[Match, ...]
    unregistered: tuple[Finding, ...]
    stale: tuple[Exemption, ...]
    duplicates: tuple[str, ...]
    expired: tuple[Exemption, ...]


@dataclass(frozen=True, slots=True)
class Inventory:
    """Collected findings plus the policy comparison and execution context."""

    findings: tuple[Finding, ...]
    registry: Registry
    reconciliation: Reconciliation
    scope: str
    collectors: tuple[str, ...]


def finding_key(finding: Finding) -> FindingKey:
    """Return the exact authorization identity for one finding."""

    return (
        finding.tool,
        canonical_identity(finding.rule),
        finding.mechanism.value,
        finding.target_kind.value,
        finding.path,
        canonical_target(
            finding.mechanism.value, finding.target_kind.value, finding.target
        ),
        finding.fingerprint,
    )


def exemption_key(exemption: Exemption) -> FindingKey:
    """Return the exact authorization identity for one registry entry."""

    return (
        exemption.tool,
        canonical_identity(exemption.rule),
        exemption.mechanism.value,
        exemption.target_kind.value,
        exemption.path,
        canonical_target(
            exemption.mechanism.value, exemption.target_kind.value, exemption.target
        ),
        exemption.fingerprint,
    )


def _finding_sort_key(finding: Finding) -> tuple[str, str, str, str, str]:
    return (
        finding.tool,
        finding.rule,
        finding.path,
        finding.target,
        finding.fingerprint,
    )


def _exemption_sort_key(exemption: Exemption) -> tuple[str, str, str, str, str]:
    return (
        exemption.tool,
        exemption.rule,
        exemption.path,
        exemption.target,
        exemption.fingerprint,
    )


def reconcile(
    findings: Sequence[Finding], registry: Registry, *, today: date
) -> Reconciliation:
    """Compare observed findings and registry records as exact sets."""

    if type(today) is not date:
        raise TypeError("today must be a date")
    ordered_findings = tuple(sorted(findings, key=_finding_sort_key))
    ordered_exemptions = tuple(sorted(registry.exemptions, key=_exemption_sort_key))
    registry_by_key = {exemption_key(item): item for item in ordered_exemptions}

    matched: list[Match] = []
    unregistered: list[Finding] = []
    actual_keys: set[FindingKey] = set()
    duplicate_labels: set[str] = set()
    for finding in ordered_findings:
        key = finding_key(finding)
        if key in actual_keys:
            duplicate_labels.add(f"finding:{finding.fingerprint}")
        actual_keys.add(key)
        exemption = registry_by_key.get(key)
        if exemption is None:
            unregistered.append(finding)
        else:
            matched.append(Match(finding=finding, exemption=exemption))

    registry_keys: set[FindingKey] = set()
    registry_ids: set[str] = set()
    for exemption in ordered_exemptions:
        key = exemption_key(exemption)
        if key in registry_keys:
            duplicate_labels.add(f"registry-authorization:{exemption.id}")
        registry_keys.add(key)
        if exemption.id in registry_ids:
            duplicate_labels.add(f"registry-id:{exemption.id}")
        registry_ids.add(exemption.id)

    stale = [
        exemption
        for exemption in ordered_exemptions
        if exemption_key(exemption) not in actual_keys
    ]
    expired = [
        exemption
        for exemption in ordered_exemptions
        if exemption.expires_on is not None and exemption.expires_on < today
    ]
    return Reconciliation(
        matched=tuple(matched),
        unregistered=tuple(unregistered),
        stale=tuple(stale),
        duplicates=tuple(sorted(duplicate_labels)),
        expired=tuple(expired),
    )


__all__ = [
    "FindingKey",
    "Inventory",
    "Match",
    "Reconciliation",
    "canonical_identity",
    "canonical_target",
    "exemption_key",
    "finding_key",
    "reconcile",
]
