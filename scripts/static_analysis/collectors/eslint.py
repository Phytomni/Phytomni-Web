"""Collect fail-closed, AST-bound diagnostics from the ESLint bridge."""

from __future__ import annotations

import json
import subprocess
from collections.abc import Sequence
from pathlib import Path, PurePosixPath
from typing import Any

from ..fingerprints import FingerprintInput, fingerprint
from ..model import Finding, Mechanism, TargetKind
from .errors import CollectionError


EXPECTED_ESLINT_VERSION = "8.22.0"
_SCHEMA_VERSION = 1
_FINDING_KEYS = frozenset(
    {
        "tool",
        "toolVersion",
        "rule",
        "path",
        "message",
        "severity",
        "display",
        "target",
    }
)
_DISPLAY_KEYS = frozenset({"line", "column", "endLine", "endColumn"})
_TARGET_KEYS = frozenset({"kind", "identity", "normalizedSource"})


def _fail(message: str) -> CollectionError:
    return CollectionError(f"eslint inventory: {message}")


def _non_empty_string(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise _fail(f"{field} must be a non-empty string")
    return value.strip()


def _positive_integer(value: object, field: str, *, allow_zero: bool = False) -> int:
    if type(value) is not int or (value < 0 if allow_zero else value <= 0):
        bound = "non-negative" if allow_zero else "positive"
        raise _fail(f"{field} must be a {bound} integer")
    return value


def _relative_path(value: object, field: str) -> str:
    path = _non_empty_string(value, field).replace("\\", "/")
    pure = PurePosixPath(path)
    if (
        path.startswith("/")
        or len(path) >= 2
        and path[1] == ":"
        or "\x00" in path
        or ".." in pure.parts
        or pure == PurePosixPath(".")
    ):
        raise _fail(f"{field} must be repository-relative")
    return pure.as_posix()


def _exact_keys(value: object, expected: frozenset[str], field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise _fail(f"{field} must be an object")
    unknown = set(value) - expected
    missing = expected - set(value)
    if unknown:
        raise _fail(f"{field} has unknown key(s): {', '.join(sorted(unknown))}")
    if missing:
        raise _fail(f"{field} is missing key(s): {', '.join(sorted(missing))}")
    return value


def validate_eslint_result(returncode: int, stdout: str, stderr: str) -> str:
    """Reject invocation failures and output that cannot be parsed exactly."""

    if returncode != 0:
        diagnostic = stderr.strip() or "no diagnostic was written to stderr"
        raise _fail(f"bridge exited with status {returncode}: {diagnostic}")
    if not stdout.strip():
        raise _fail("bridge returned empty stdout")
    try:
        document = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise _fail(f"bridge stdout is not JSON: {exc.msg}") from exc
    if not isinstance(document, dict):
        raise _fail("bridge stdout must contain one JSON object")
    expected = {"schemaVersion", "toolVersion", "filesScanned", "findings"}
    unknown = set(document) - expected
    missing = expected - set(document)
    if unknown:
        raise _fail(f"bridge envelope has unknown key(s): {', '.join(sorted(unknown))}")
    if missing:
        raise _fail(f"bridge envelope is missing key(s): {', '.join(sorted(missing))}")
    return stdout


def parse_eslint_inventory(root: Path, text: str) -> tuple[Finding, ...]:
    """Validate the bridge envelope and convert each diagnostic to a Finding."""

    try:
        document = json.loads(text)
    except (TypeError, json.JSONDecodeError) as exc:
        raise _fail("bridge stdout is not valid JSON") from exc
    if not isinstance(document, dict):
        raise _fail("top-level value must be an object")
    expected = {"schemaVersion", "toolVersion", "filesScanned", "findings"}
    unknown = set(document) - expected
    missing = expected - set(document)
    if unknown:
        raise _fail(f"top-level has unknown key(s): {', '.join(sorted(unknown))}")
    if missing:
        raise _fail(f"top-level is missing key(s): {', '.join(sorted(missing))}")
    if document["schemaVersion"] != _SCHEMA_VERSION:
        raise _fail(f"unsupported schema version {document['schemaVersion']!r}")
    tool_version = _non_empty_string(document["toolVersion"], "toolVersion")
    if tool_version != EXPECTED_ESLINT_VERSION:
        raise _fail(
            f"ESLint version mismatch: expected {EXPECTED_ESLINT_VERSION}, "
            f"got {tool_version}"
        )
    _positive_integer(document["filesScanned"], "filesScanned", allow_zero=True)
    raw_findings = document["findings"]
    if not isinstance(raw_findings, list):
        raise _fail("findings must be an array")

    findings: list[Finding] = []
    for index, raw in enumerate(raw_findings):
        finding = _exact_keys(raw, _FINDING_KEYS, f"findings[{index}]")
        tool = _non_empty_string(finding["tool"], f"findings[{index}].tool")
        if tool != "eslint":
            raise _fail(f"findings[{index}].tool must be 'eslint'")
        finding_version = _non_empty_string(
            finding["toolVersion"], f"findings[{index}].toolVersion"
        )
        if finding_version != tool_version:
            raise _fail(f"findings[{index}] toolVersion differs from envelope")
        rule = _non_empty_string(finding["rule"], f"findings[{index}].rule")
        path = _relative_path(finding["path"], f"findings[{index}].path")
        message = _non_empty_string(
            finding["message"], f"findings[{index}].message"
        )
        severity = finding["severity"]
        if type(severity) is not int or severity not in {1, 2}:
            raise _fail(f"findings[{index}].severity must be 1 or 2")
        display_value = finding["display"]
        if not isinstance(display_value, dict):
            raise _fail(f"findings[{index}].display must be an object")
        unknown_display = set(display_value) - _DISPLAY_KEYS
        if unknown_display:
            raise _fail(
                f"findings[{index}].display has unknown key(s): "
                f"{', '.join(sorted(unknown_display))}"
            )
        if "line" not in display_value or "column" not in display_value:
            raise _fail(f"findings[{index}].display needs line and column")
        display = display_value
        line = _positive_integer(display["line"], f"findings[{index}].display.line")
        _positive_integer(
            display["column"], f"findings[{index}].display.column"
        )
        for key in ("endLine", "endColumn"):
            if key in display:
                _positive_integer(display[key], f"findings[{index}].display.{key}")
        target = _exact_keys(
            finding["target"], _TARGET_KEYS, f"findings[{index}].target"
        )
        target_kind = target["kind"]
        if target_kind not in {TargetKind.SYMBOL.value, TargetKind.SPAN.value}:
            raise _fail(f"findings[{index}].target.kind is unsupported")
        identity = _non_empty_string(
            target["identity"], f"findings[{index}].target.identity"
        )
        normalized_source = _non_empty_string(
            target["normalizedSource"],
            f"findings[{index}].target.normalizedSource",
        )
        target_kind_value = TargetKind(target_kind)
        digest = fingerprint(
            FingerprintInput(
                tool=tool,
                rule=rule,
                mechanism=Mechanism.DIAGNOSTIC.value,
                target_kind=target_kind_value,
                path=path,
                target=identity,
                normalized_source=normalized_source,
            )
        )
        findings.append(
            Finding(
                tool=tool,
                rule=rule,
                mechanism=Mechanism.DIAGNOSTIC,
                target_kind=target_kind_value,
                path=path,
                target=identity,
                fingerprint=digest,
                message=message,
                display_line=line,
                tool_version=tool_version,
                evidence=(message,),
            )
        )
    return tuple(
        sorted(
            findings,
            key=lambda item: (
                item.path,
                item.display_line or 0,
                item.rule,
                item.target,
                item.message,
            ),
        )
    )


def collect_eslint(root: Path, files: Sequence[Path]) -> tuple[Finding, ...]:
    """Run the installed bridge for selected frontend files."""

    web_root = root / "apps" / "web"
    bridge = web_root / "scripts" / "quality" / "eslint-inventory.mjs"
    selected: list[str] = []
    for path in files:
        try:
            selected.append(path.resolve().relative_to(web_root.resolve()).as_posix())
        except ValueError:
            continue
    selected = sorted(set(selected))
    if not selected:
        return ()
    command = ["node", str(bridge), "--root", str(web_root)]
    for path in selected:
        command.extend(("--file", path))
    try:
        result = subprocess.run(
            command,
            cwd=web_root,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as exc:
        raise _fail(f"unable to invoke bridge: {exc}") from exc
    output = validate_eslint_result(result.returncode, result.stdout, result.stderr)
    return parse_eslint_inventory(web_root, output)


__all__ = [
    "EXPECTED_ESLINT_VERSION",
    "collect_eslint",
    "parse_eslint_inventory",
    "validate_eslint_result",
]
