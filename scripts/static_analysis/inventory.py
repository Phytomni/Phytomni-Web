"""Exact finding reconciliation primitives for static-analysis observation."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from hashlib import sha256

from .model import Classification, Exemption, Finding, Mechanism, Registry


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


_GO_TOOLS = frozenset({"go", "golangci-lint", "staticcheck"})
_REPOSITORY_TOOLS = frozenset(
    {
        "actionlint",
        "markdownlint",
        "prettier",
        "secret-scan",
        "shellcheck",
        "shfmt",
        "yamllint",
    }
)


def _belongs_to_collector(exemption: Exemption, collector: str) -> bool:
    """Return whether one registry identity belongs to a collector surface.

    A registry record does not carry a collector column because the identity
    itself is the durable authority.  These exact, mechanism-aware partitions
    keep a scoped checker from treating records owned by another collector as
    stale while preserving stale detection inside the selected surface.
    """

    if collector == "eslint":
        return (
            exemption.tool == "eslint"
            and exemption.mechanism is Mechanism.DIAGNOSTIC
        )
    if collector == "typescript":
        return (
            exemption.tool == "typescript"
            and exemption.mechanism is Mechanism.DIAGNOSTIC
        )
    if collector == "config":
        return exemption.mechanism is Mechanism.CONFIG
    if collector == "ci":
        return exemption.mechanism is Mechanism.COMMAND and not (
            exemption.tool == "go" and exemption.rule == "go:generate"
        )
    if collector == "go":
        return (
            exemption.tool in _GO_TOOLS
            and exemption.mechanism
            in {Mechanism.DIAGNOSTIC, Mechanism.INLINE, Mechanism.MARKER}
            and (
                exemption.tool == "staticcheck"
                or exemption.target.startswith(
                    ("generated:", "nolint:", "lint:ignore:")
                )
            )
        )
    if collector == "repository_tools":
        return exemption.tool in _REPOSITORY_TOOLS
    if collector == "source":
        if exemption.mechanism is Mechanism.CONFIG:
            return False
        if exemption.mechanism is Mechanism.COMMAND:
            return exemption.tool == "go" and exemption.rule == "go:generate"
        if (
            exemption.tool in {"eslint", "typescript"}
            and exemption.mechanism is Mechanism.DIAGNOSTIC
        ):
            return False
        if exemption.tool in _GO_TOOLS:
            return exemption.target.startswith("line:")
        if exemption.tool == "staticcheck":
            return False
        return True
    raise ValueError(f"unknown collector {collector!r}")


def select_registry_for_collectors(
    registry: Registry, collectors: Sequence[str]
) -> Registry:
    """Project the registry onto the exact surfaces a checker will collect."""

    selected = tuple(dict.fromkeys(collectors))
    exemptions = tuple(
        entry
        for entry in registry.exemptions
        if any(_belongs_to_collector(entry, collector) for collector in selected)
    )
    return Registry(
        schema_version=registry.schema_version,
        default=registry.default,
        exemptions=exemptions,
        allow_temporary=registry.allow_temporary,
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


def closure_errors(
    inventory: Inventory, *, pending_candidate: bool = False
) -> tuple[str, ...]:
    """Return bounded reasons an exact inventory cannot close the program."""

    reconciliation = inventory.reconciliation
    errors: list[str] = []
    if inventory.registry.allow_temporary:
        errors.append("closure requires policy allow_temporary = false")
    if not inventory.registry.exemptions:
        errors.append("closure rejects an empty registry")
    if any(
        entry.classification is Classification.TEMPORARY
        for entry in inventory.registry.exemptions
    ):
        errors.append("closure rejects temporary registry records")
    if any(
        match.exemption.classification is not Classification.STRUCTURAL
        for match in reconciliation.matched
    ):
        errors.append("closure requires every matched record to be structural")
    if reconciliation.unregistered:
        errors.append("closure found unregistered findings")
    if reconciliation.stale:
        errors.append("closure found stale structural records")
    if reconciliation.duplicates:
        errors.append("closure found duplicate identities")
    if reconciliation.expired:
        errors.append("closure found expired registry records")
    if pending_candidate:
        errors.append("closure found a pending candidate packet")
    return tuple(errors)


__all__ = [
    "FindingKey",
    "Inventory",
    "Match",
    "Reconciliation",
    "canonical_identity",
    "canonical_target",
    "closure_errors",
    "exemption_key",
    "finding_key",
    "reconcile",
    "select_registry_for_collectors",
]
