"""Stable, content-addressed identities for static-analysis targets."""

from __future__ import annotations

import hashlib
import json
import textwrap
from dataclasses import dataclass
from typing import Any

from .model import Endpoint, TargetKind


@dataclass(frozen=True, slots=True)
class FingerprintInput:
    """The exact finding context that contributes to a fingerprint."""

    tool: str
    rule: str
    mechanism: str
    target_kind: TargetKind
    path: str
    target: str
    normalized_source: str
    peer_path: str | None = None
    peer_target: str | None = None


def _identity_text(value: object, field: str) -> str:
    rendered = getattr(value, "value", value)
    if not isinstance(rendered, str) or not rendered.strip():
        raise ValueError(f"{field} must be a non-empty string")
    return rendered.strip()


def _append_separator(parts: list[str], pending: list[bool]) -> None:
    if pending[0] and parts and not parts[-1].isspace():
        parts.append(" ")
    pending[0] = False


def normalize_source(text: str) -> str:
    """Normalize display whitespace and comments while preserving literals.

    Source content is scanned without a language-specific parser so the same
    identity contract works for Vue, TypeScript, Go, JSON, YAML, and shell
    fragments. Whitespace and comments outside quoted literals are display
    details; characters inside quoted literals remain byte-for-byte visible.
    """

    if not isinstance(text, str):
        raise TypeError("source must be a string")
    source = text.replace("\r\n", "\n").replace("\r", "\n")
    source = textwrap.dedent(source)

    parts: list[str] = []
    pending_space = [False]
    quote: str | None = None
    i = 0
    while i < len(source):
        if quote is not None:
            if len(quote) == 3 and source.startswith(quote, i):
                parts.append(quote)
                i += 3
                quote = None
                continue
            char = source[i]
            parts.append(char)
            if char == "\\" and i + 1 < len(source):
                parts.append(source[i + 1])
                i += 2
                continue
            if len(quote) == 1 and char == quote:
                quote = None
            i += 1
            continue

        if source.startswith("/*", i):
            end = source.find("*/", i + 2)
            i = len(source) if end == -1 else end + 2
            pending_space[0] = True
            continue
        if source.startswith("//", i):
            end = source.find("\n", i + 2)
            i = len(source) if end == -1 else end + 1
            pending_space[0] = True
            continue
        if source[i] == "#":
            end = source.find("\n", i + 1)
            i = len(source) if end == -1 else end + 1
            pending_space[0] = True
            continue

        if source.startswith("'''", i) or source.startswith('"""', i):
            _append_separator(parts, pending_space)
            quote = source[i : i + 3]
            parts.append(quote)
            i += 3
            continue
        if source[i] in "'\"`":
            _append_separator(parts, pending_space)
            quote = source[i]
            parts.append(quote)
            i += 1
            continue

        if source[i].isspace():
            pending_space[0] = True
            i += 1
            continue

        _append_separator(parts, pending_space)
        parts.append(source[i])
        i += 1

    return "".join(parts).strip()


def canonical_pair(left: Endpoint, right: Endpoint) -> tuple[Endpoint, Endpoint]:
    """Return paired endpoints in deterministic lexical order."""

    if not isinstance(left, Endpoint) or not isinstance(right, Endpoint):
        raise TypeError("pair endpoints must be Endpoint values")
    ordered = sorted((left, right), key=lambda item: (item.path, item.target))
    return ordered[0], ordered[1]


def _endpoint_payload(endpoint: Endpoint) -> dict[str, str]:
    return {"path": endpoint.path, "target": endpoint.target}


def _sha256_payload(payload: dict[str, Any]) -> str:
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def fingerprint(value: FingerprintInput) -> str:
    """Hash the exact finding identity using canonical JSON and SHA-256."""

    if not isinstance(value, FingerprintInput):
        raise TypeError("value must be a FingerprintInput")
    target_kind = _identity_text(value.target_kind, "target_kind")
    path = _identity_text(value.path, "path")
    target = _identity_text(value.target, "target")
    peer_values = (value.peer_path, value.peer_target)
    if (value.peer_path is None) != (value.peer_target is None):
        raise ValueError("peer_path and peer_target must be provided together")
    is_pair = target_kind == TargetKind.PAIR.value
    if is_pair and value.peer_path is None:
        raise ValueError("pair targets require peer_path and peer_target")
    if not is_pair and any(item is not None for item in peer_values):
        raise ValueError("peer target fields are only valid for pair targets")

    endpoints = [Endpoint(path, target)]
    if value.peer_path is not None and value.peer_target is not None:
        endpoints.append(
            Endpoint(
                _identity_text(value.peer_path, "peer_path"),
                _identity_text(value.peer_target, "peer_target"),
            )
        )

    payload: dict[str, Any] = {
        "mechanism": _identity_text(value.mechanism, "mechanism"),
        "normalized_source": normalize_source(value.normalized_source),
        "rule": _identity_text(value.rule, "rule"),
        "target_kind": target_kind,
        "tool": _identity_text(value.tool, "tool"),
        "endpoints": [
            _endpoint_payload(endpoint) for endpoint in sorted(
                endpoints, key=lambda item: (item.path, item.target)
            )
        ],
    }
    return _sha256_payload(payload)


__all__ = [
    "Endpoint",
    "FingerprintInput",
    "canonical_pair",
    "fingerprint",
    "normalize_source",
]
