"""Data model and fail-closed loader for static-analysis exemptions."""

from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass
from datetime import date
from enum import StrEnum
from pathlib import Path, PurePosixPath
from typing import Any


class RegistryError(ValueError):
    """Raised when the exemption registry is malformed or unsafe."""


class Classification(StrEnum):
    """The approved lifecycle classification for an exemption."""

    STRUCTURAL = "structural"
    TEMPORARY = "temporary"
    FORBIDDEN = "forbidden"


class TargetKind(StrEnum):
    """The exact target identity represented by an exemption."""

    SYMBOL = "symbol"
    SPAN = "span"
    PAIR = "pair"
    CONFIG = "config"
    COMMAND = "command"
    FIXTURE = "fixture"


class Mechanism(StrEnum):
    """The static-analysis mechanism that creates a finding."""

    DIAGNOSTIC = "diagnostic"
    INLINE = "inline"
    CONFIG = "config"
    COMMAND = "command"
    DECORATOR = "decorator"
    MARKER = "marker"


@dataclass(frozen=True, slots=True)
class Endpoint:
    """One canonical endpoint of a paired static-analysis target."""

    path: str
    target: str


@dataclass(frozen=True, slots=True)
class Finding:
    """One observed static-analysis exception or diagnostic."""

    tool: str
    rule: str
    mechanism: Mechanism
    target_kind: TargetKind
    path: str
    target: str
    fingerprint: str
    message: str
    display_line: int | None
    tool_version: str
    evidence: tuple[str, ...]
    peer_path: str | None = None
    peer_target: str | None = None


@dataclass(frozen=True, slots=True)
class Exemption:  # pylint: disable=too-many-instance-attributes
    """One exact, reviewed authorization in the registry."""

    id: str
    tool: str
    rule: str
    classification: Classification
    mechanism: Mechanism
    target_kind: TargetKind
    path: str
    target: str
    fingerprint: str
    owner: str
    introduced_on: date
    review_on: date
    rationale: str
    counterfactual: str
    risk: str
    tests: tuple[str, ...]
    expires_on: date | None = None
    remediation: str | None = None


@dataclass(frozen=True, slots=True)
class Registry:
    """The deny-by-default registry and its exact exemptions."""

    schema_version: int
    default: str
    exemptions: tuple[Exemption, ...]
    allow_temporary: bool = True


_TOP_LEVEL_KEYS = frozenset({"schema_version", "policy", "exemptions"})
_POLICY_KEYS = frozenset({"default", "allow_temporary"})
_ENTRY_KEYS = frozenset(
    {
        "id",
        "tool",
        "rule",
        "classification",
        "mechanism",
        "target_kind",
        "path",
        "target",
        "fingerprint",
        "owner",
        "introduced_on",
        "review_on",
        "expires_on",
        "remediation",
        "rationale",
        "counterfactual",
        "risk",
        "tests",
    }
)
_FINGERPRINT_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
_WILDCARD_CHARS = frozenset("*?[]")
_MAX_TEMPORARY_EXPIRATION = date(2026, 8, 31)
_WINDOWS_ABSOLUTE_RE = re.compile(r"^[A-Za-z]:")


def _error(message: str) -> RegistryError:
    """Build a consistently worded schema error."""

    return RegistryError(f"registry: {message}")


def _required_string(raw: dict[str, Any], key: str) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or not value.strip():
        raise _error(f"{key} must be a non-empty string")
    return value.strip()


def _optional_string(raw: dict[str, Any], key: str) -> str | None:
    value = raw.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise _error(f"{key} must be a non-empty string when provided")
    return value.strip()


def _enum_value(enum_type: type[StrEnum], raw: dict[str, Any], key: str) -> StrEnum:
    value = _required_string(raw, key)
    try:
        return enum_type(value)
    except ValueError as exc:
        raise _error(f"unknown {key} {value!r}") from exc


def _date_value(raw: dict[str, Any], key: str, *, required: bool) -> date | None:
    value = raw.get(key)
    if value is None:
        if required:
            raise _error(f"{key} is required")
        return None
    if type(value) is not date:
        raise _error(f"{key} must be a TOML date")
    return value


def _normalize_path(raw_path: str) -> str:
    """Return a repository-relative POSIX path or reject unsafe authority."""

    path = raw_path.replace("\\", "/").strip()
    if not path or "\x00" in path:
        raise _error("path must be a non-empty repository-relative path")
    if path.startswith("/") or _WINDOWS_ABSOLUTE_RE.match(path):
        raise _error(f"path must be repository-relative: {raw_path!r}")
    if any(char in path for char in _WILDCARD_CHARS):
        raise _error(f"unbounded path pattern is not allowed: {raw_path!r}")

    parts = PurePosixPath(path).parts
    if not parts or parts == (".",) or ".." in parts:
        raise _error(f"path may not escape the repository: {raw_path!r}")
    return PurePosixPath(path).as_posix()


def _validate_target(target: str, *, target_kind: TargetKind) -> str:
    if "\x00" in target:
        raise _error(f"{target_kind.value} target may not use wildcard authority")
    if target_kind is not TargetKind.SPAN and any(
        char in target for char in _WILDCARD_CHARS
    ):
        raise _error(f"{target_kind.value} target may not use wildcard authority")
    if "\n" in target or "\r" in target:
        raise _error("target must be a single-line identity")
    return target


def _parse_identity(raw: dict[str, Any], ids: set[str]) -> Exemption:
    entry_id = _required_string(raw, "id")
    if entry_id in ids:
        raise _error(f"duplicate id {entry_id!r}")
    ids.add(entry_id)

    tool = _required_string(raw, "tool")
    rule = _required_string(raw, "rule")
    if any(char in rule for char in _WILDCARD_CHARS):
        raise _error("rule may not be a wildcard")
    classification = _enum_value(Classification, raw, "classification")
    if classification is Classification.FORBIDDEN:
        raise _error("classification forbidden is not an authorization")
    mechanism = _enum_value(Mechanism, raw, "mechanism")
    target_kind = _enum_value(TargetKind, raw, "target_kind")
    path = _normalize_path(_required_string(raw, "path"))
    target = _validate_target(
        _required_string(raw, "target"), target_kind=target_kind
    )
    fingerprint = _required_string(raw, "fingerprint")
    if not _FINGERPRINT_RE.fullmatch(fingerprint):
        raise _error(
            "fingerprint must match sha256:<64 lowercase hex>: "
            f"{fingerprint!r}"
        )

    return Exemption(
        id=entry_id,
        tool=tool,
        rule=rule,
        classification=classification,
        mechanism=mechanism,
        target_kind=target_kind,
        path=path,
        target=target,
        fingerprint=fingerprint,
        owner="",
        introduced_on=date.min,
        review_on=date.min,
        rationale="",
        counterfactual="",
        risk="",
        tests=(),
    )


def _parse_review(raw: dict[str, Any], identity: Exemption, *, today: date) -> Exemption:
    owner = _required_string(raw, "owner")
    introduced_on = _date_value(raw, "introduced_on", required=True)
    review_on = _date_value(raw, "review_on", required=True)
    assert introduced_on is not None
    assert review_on is not None
    if review_on < introduced_on:
        raise _error("review_on must not precede introduced_on")

    rationale = _required_string(raw, "rationale")
    counterfactual = _required_string(raw, "counterfactual")
    risk = _required_string(raw, "risk")
    tests_raw = raw.get("tests")
    if (
        not isinstance(tests_raw, list)
        or not tests_raw
        or any(not isinstance(item, str) or not item.strip() for item in tests_raw)
    ):
        raise _error("tests must be a non-empty list of strings")
    tests = tuple(item.strip() for item in tests_raw)

    expires_on = _date_value(raw, "expires_on", required=False)
    remediation = _optional_string(raw, "remediation")
    if identity.classification is Classification.TEMPORARY:
        if expires_on is None:
            raise _error("temporary entry requires expires_on")
        if remediation is None:
            raise _error("temporary entry requires remediation")
        if expires_on < introduced_on:
            raise _error("expires_on must not precede introduced_on")
        if expires_on > _MAX_TEMPORARY_EXPIRATION:
            raise _error(
                "temporary expiration may not exceed "
                f"{_MAX_TEMPORARY_EXPIRATION.isoformat()}"
            )
        if expires_on < today:
            raise _error(f"temporary entry {identity.id!r} is expired")
    elif expires_on is not None or remediation is not None:
        raise _error("structural entry may not define temporary lifecycle fields")

    return Exemption(
        id=identity.id,
        tool=identity.tool,
        rule=identity.rule,
        classification=identity.classification,
        mechanism=identity.mechanism,
        target_kind=identity.target_kind,
        path=identity.path,
        target=identity.target,
        fingerprint=identity.fingerprint,
        owner=owner,
        introduced_on=introduced_on,
        review_on=review_on,
        rationale=rationale,
        counterfactual=counterfactual,
        risk=risk,
        tests=tests,
        expires_on=expires_on,
        remediation=remediation,
    )


def _validate_entry(raw: object, *, today: date, ids: set[str]) -> Exemption:
    if not isinstance(raw, dict):
        raise _error("each exemption must be a table")
    unknown = set(raw) - _ENTRY_KEYS
    if unknown:
        raise _error(
            f"unknown key(s) in exemption: {', '.join(sorted(unknown))}"
        )
    identity = _parse_identity(raw, ids)
    return _parse_review(raw, identity, today=today)


def _authorization_key(entry: Exemption) -> tuple[str, ...]:
    return (
        entry.tool,
        entry.rule,
        entry.mechanism.value,
        entry.target_kind.value,
        entry.path,
        entry.target,
        entry.fingerprint,
    )


def load_registry(path: Path, *, today: date | None = None) -> Registry:
    """Load and validate a deny-by-default TOML registry."""

    try:
        with path.open("rb") as handle:
            document = tomllib.load(handle)
    except tomllib.TOMLDecodeError as exc:
        raise _error(f"invalid TOML: {exc}") from exc

    if not isinstance(document, dict):
        raise _error("top-level document must be a table")
    unknown = set(document) - _TOP_LEVEL_KEYS
    if unknown:
        raise _error(f"unknown top-level key(s): {', '.join(sorted(unknown))}")
    schema_version = document.get("schema_version")
    if schema_version != 1 or isinstance(schema_version, bool):
        raise _error("schema_version must be 1")

    policy = document.get("policy")
    if not isinstance(policy, dict):
        raise _error("policy must be a table")
    unknown_policy = set(policy) - _POLICY_KEYS
    if unknown_policy:
        raise _error(
            f"unknown policy key(s): {', '.join(sorted(unknown_policy))}"
        )
    default = policy.get("default")
    if default != "deny":
        raise _error("policy default must be deny")
    allow_temporary = policy.get("allow_temporary", True)
    if type(allow_temporary) is not bool:
        raise _error("policy allow_temporary must be boolean")

    raw_exemptions = document.get("exemptions", [])
    if not isinstance(raw_exemptions, list):
        raise _error("exemptions must be an array of tables")
    effective_today = today or date.today()
    if type(effective_today) is not date:
        raise _error("today must be a date")
    ids: set[str] = set()
    exemptions: list[Exemption] = []
    authorizations: set[tuple[str, ...]] = set()
    for item in raw_exemptions:
        entry = _validate_entry(item, today=effective_today, ids=ids)
        authorization = _authorization_key(entry)
        if authorization in authorizations:
            raise _error(f"duplicate authorization for {entry.id!r}")
        authorizations.add(authorization)
        exemptions.append(entry)

    return Registry(
        schema_version=schema_version,
        default=default,
        exemptions=tuple(exemptions),
        allow_temporary=allow_temporary,
    )
