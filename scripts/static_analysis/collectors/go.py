"""Collect fail-closed Staticcheck findings and Go suppression directives."""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from pathlib import Path, PurePosixPath
from typing import Any

from ..fingerprints import normalize_source
from ..model import Finding, Mechanism, TargetKind
from .errors import CollectionError
from .helpers import make_finding


EXPECTED_STATICCHECK_VERSION = "2025.1.1"
_KNOWN_CODES = frozenset(
    {
        "SA1016",
        "SA4000",
        "S1000",
        "SA4006",
        "U1000",
        "SA1029",
        "S1008",
        "SA1019",
        "S1002",
    }
)
_ENTRY_KEYS = frozenset({"code", "severity", "location", "end", "message", "source"})
_LOCATION_KEYS = frozenset({"file", "line", "column"})
_END_KEYS = frozenset({"line", "column"})
_VERSION_RE = re.compile(r"\b(?P<version>\d+\.\d+\.\d+)\b")
_GENERATED_RE = re.compile(r"^\s*//\s*Code generated .*DO NOT EDIT\.\s*$")
_NOLINT_RE = re.compile(r"^\s*//\s*nolint(?::(?P<rules>[^\s]+))?\b", re.IGNORECASE)
_LINT_IGNORE_RE = re.compile(
    r"^\s*//\s*lint:ignore(?:\s+(?P<rule>\S+))?\b", re.IGNORECASE
)


def _fail(message: str) -> CollectionError:
    return CollectionError(f"go collector: {message}")


def _version(version: str) -> str:
    match = _VERSION_RE.search(version.strip())
    if match is None or match.group("version") != EXPECTED_STATICCHECK_VERSION:
        raise _fail(
            f"Staticcheck version mismatch: expected {EXPECTED_STATICCHECK_VERSION}, "
            f"got {version!r}"
        )
    return EXPECTED_STATICCHECK_VERSION


def _non_empty(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise _fail(f"{field} must be a non-empty string")
    return value.strip()


def _positive(value: object, field: str) -> int:
    if type(value) is not int or value <= 0:
        raise _fail(f"{field} must be a positive integer")
    return value


def _repo_path(root: Path, raw: object) -> str:
    value = _non_empty(raw, "location.file").replace("\\", "/")
    candidate = Path(value)
    if candidate.is_absolute():
        try:
            return candidate.resolve().relative_to(root.resolve()).as_posix()
        except ValueError as exc:
            raise _fail(f"location.file escapes repository: {value!r}") from exc
    pure = PurePosixPath(value)
    if ".." in pure.parts or pure == PurePosixPath("."):
        raise _fail(f"location.file escapes repository: {value!r}")
    normalized = pure.as_posix()
    if not (root / normalized).exists() and (root / "apps" / "server" / normalized).exists():
        normalized = PurePosixPath("apps/server", normalized).as_posix()
    return normalized


def _line_context(root: Path, path: str, line: int) -> str:
    source_path = root / path
    if not source_path.is_file() and (root / "apps" / "server" / path).is_file():
        source_path = root / "apps" / "server" / path
    try:
        lines = source_path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError):
        return ""
    return normalize_source(lines[line - 1]) if line <= len(lines) else ""


def _exact_keys(value: object, expected: frozenset[str], field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise _fail(f"{field} must be an object")
    unknown = set(value) - expected
    if unknown:
        raise _fail(f"{field} has unknown key(s): {', '.join(sorted(unknown))}")
    return value


def _parse_entry(root: Path, value: object, version: str) -> Finding:
    entry = _exact_keys(value, _ENTRY_KEYS, "Staticcheck finding")
    code = _non_empty(entry.get("code"), "code")
    if code not in _KNOWN_CODES:
        raise _fail(f"unknown Staticcheck code {code!r}")
    severity = _non_empty(entry.get("severity"), "severity")
    if severity not in {"warning", "error"}:
        raise _fail(f"unsupported Staticcheck severity {severity!r}")
    location = _exact_keys(entry.get("location"), _LOCATION_KEYS, "location")
    missing_location = _LOCATION_KEYS - set(location)
    if missing_location:
        raise _fail(
            f"location is missing key(s): {', '.join(sorted(missing_location))}"
        )
    path = _repo_path(root, location["file"])
    line = _positive(location["line"], "location.line")
    _positive(location["column"], "location.column")
    if entry.get("end") is not None:
        end = _exact_keys(entry["end"], _END_KEYS, "end")
        _positive(end.get("line"), "end.line")
        _positive(end.get("column"), "end.column")
    message = _non_empty(entry.get("message"), "message")
    context = _line_context(root, path, line)
    target = f"span:{context}" if context else f"span:{path}:{line}"
    return make_finding(
        root=root,
        path=root / path,
        tool="staticcheck",
        rule=code,
        mechanism=Mechanism.DIAGNOSTIC,
        target_kind=TargetKind.SPAN,
        target=target,
        message=message,
        display_line=line,
        source=context or message,
        tool_version=version,
        evidence=(message,),
    )


def parse_staticcheck_jsonl(
    root: Path, text: str, version: str
) -> tuple[Finding, ...]:
    """Parse only recognized Staticcheck JSONL findings."""

    normalized_version = _version(version)
    if not isinstance(text, str):
        raise _fail("Staticcheck output must be text")
    findings: list[Finding] = []
    for line_number, raw in enumerate(text.splitlines(), start=1):
        if not raw.strip():
            continue
        try:
            value = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise _fail(f"malformed JSONL at line {line_number}: {exc.msg}") from exc
        try:
            findings.append(_parse_entry(root, value, normalized_version))
        except CollectionError as exc:
            raise _fail(f"line {line_number}: {exc}") from exc
    return tuple(
        sorted(
            findings,
            key=lambda item: (
                item.path,
                item.display_line or 0,
                item.rule,
                item.target,
            ),
        )
    )


def validate_staticcheck_result(returncode: int, stdout: str, stderr: str) -> str:
    """Accept clean status or status 1 with JSONL diagnostics only."""

    if not isinstance(stdout, str):
        raise _fail("Staticcheck stdout must be text")
    if returncode == 0:
        if stdout.strip():
            for line_number, raw in enumerate(stdout.splitlines(), start=1):
                if not raw.strip():
                    continue
                try:
                    value = json.loads(raw)
                except json.JSONDecodeError as exc:
                    raise _fail(
                        f"non-JSON output at line {line_number}: {exc.msg}"
                    ) from exc
                if not isinstance(value, dict):
                    raise _fail(f"JSONL line {line_number} must be an object")
        return stdout
    if returncode != 1 or not stdout.strip():
        diagnostic = stderr.strip() or "no Staticcheck diagnostics were written"
        raise _fail(f"Staticcheck exited with status {returncode}: {diagnostic}")
    for line_number, raw in enumerate(stdout.splitlines(), start=1):
        if not raw.strip():
            continue
        try:
            value = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise _fail(f"non-JSON output at line {line_number}: {exc.msg}") from exc
        if not isinstance(value, dict):
            raise _fail(f"JSONL line {line_number} must be an object")
    return stdout


def _directive_finding(
    root: Path,
    path: Path,
    *,
    tool: str,
    rule: str,
    target: str,
    message: str,
    mechanism: Mechanism,
    line_number: int,
) -> Finding:
    return make_finding(
        root=root,
        path=path,
        tool=tool,
        rule=rule,
        mechanism=mechanism,
        target_kind=TargetKind.SPAN,
        target=target,
        message=message,
        display_line=line_number,
        source=message,
        evidence=(message,),
    )


def collect_go_directives(
    root: Path, files: Sequence[Path]
) -> tuple[Finding, ...]:
    """Collect Go-native and golangci-lint line directives without authorizing them."""

    findings: list[Finding] = []
    for path in sorted(files, key=lambda item: item.as_posix()):
        if path.suffix != ".go" or not path.is_file():
            continue
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeDecodeError) as exc:
            raise _fail(f"unable to read {path}: {exc}") from exc
        for line_number, line in enumerate(lines, start=1):
            if _GENERATED_RE.match(line):
                findings.append(
                    _directive_finding(
                        root,
                        path,
                        tool="go",
                        rule="generated",
                        target="generated:" + normalize_source(line),
                        message=line.strip(),
                        mechanism=Mechanism.MARKER,
                        line_number=line_number,
                    )
                )
            nolint = _NOLINT_RE.match(line)
            if nolint is not None:
                findings.append(
                    _directive_finding(
                        root,
                        path,
                        tool="golangci-lint",
                        rule="nolint",
                        target="nolint:" + normalize_source(line),
                        message=line.strip(),
                        mechanism=Mechanism.INLINE,
                        line_number=line_number,
                    )
                )
            lint_ignore = _LINT_IGNORE_RE.match(line)
            if lint_ignore is not None:
                findings.append(
                    _directive_finding(
                        root,
                        path,
                        tool="golangci-lint",
                        rule="lint:ignore",
                        target="lint:ignore:" + normalize_source(line),
                        message=line.strip(),
                        mechanism=Mechanism.INLINE,
                        line_number=line_number,
                    )
                )
    return tuple(
        sorted(
            findings,
            key=lambda item: (item.path, item.display_line or 0, item.rule, item.target),
        )
    )


__all__ = [
    "EXPECTED_STATICCHECK_VERSION",
    "collect_go_directives",
    "parse_staticcheck_jsonl",
    "validate_staticcheck_result",
]
