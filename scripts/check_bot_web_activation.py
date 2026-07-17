#!/usr/bin/env python3
"""Check the local, fail-closed Bot/Web activation evidence matrix.

The checker is intentionally offline.  It reads one sanitized JSON block from
the versioned Web matrix and a fixed set of Web-owned default sources.  It does
not inspect a sibling checkout, handoff/evidence trees, fixture payloads, or
live endpoints.
"""

from __future__ import annotations

import argparse
import json
import re
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
MATRIX_REL = Path("docs/reference/bot-web-activation-matrix.md")
MATRIX_JSON_START = "<!-- BOT_WEB_ACTIVATION_MATRIX_JSON_START -->"
MATRIX_JSON_END = "<!-- BOT_WEB_ACTIVATION_MATRIX_JSON_END -->"

ROW_IDS = (
    "RC-WEB-001",
    "RC-WEB-002",
    "RC-WEB-003",
    "RC-WEB-004",
    "RC-WEB-005",
    "RC-WEB-006",
    "RC-WEB-007",
    "RC-LIVE-001",
)
ALLOWED_STATUSES = frozenset({"External Pending", "Reviewed", "Passed"})
FEATURE_FLAGS = ("expert", "stream", "a2ui", "history_dual_read")
FEATURE_REQUIREMENTS: dict[str, tuple[str, ...]] = {
    "stream": (
        "RC-WEB-001",
        "RC-WEB-002",
        "RC-WEB-003",
        "RC-WEB-004",
        "RC-WEB-005",
        "RC-WEB-006",
    ),
    "expert": ("RC-WEB-001", "RC-WEB-004", "RC-WEB-005", "RC-WEB-007"),
    "a2ui": ("RC-WEB-001", "RC-WEB-005", "RC-WEB-006"),
    "history_dual_read": (
        "RC-WEB-001",
        "RC-WEB-002",
        "RC-WEB-003",
        "RC-WEB-007",
    ),
}
FEATURE_ACCEPTED_STATUSES: dict[str, frozenset[str]] = {
    "stream": frozenset({"Reviewed", "Passed"}),
    "expert": frozenset({"Reviewed", "Passed"}),
    "a2ui": frozenset({"Reviewed"}),
    "history_dual_read": frozenset({"Reviewed"}),
}
ROLLBACK_MARKERS = [
    "disable_web_flag",
    "retain_legacy_history",
    "restore_previous_web_release",
]

# These are the only non-matrix files the checker may read.  Values are small
# synthetic snippets used by tests that build an isolated temporary checkout;
# the checker itself always reads the corresponding file from ``root``.
DEFAULT_CHECK_FILES: dict[Path, str] = {
    Path("apps/server/config/app.yml.example"): (
        "bot:\n"
        "  expert_enabled: false\n"
        "  stream_enabled: false\n"
        "  a2ui_actions_enabled: false\n"
    ),
    Path("apps/web/src/stores/user.ts"): "expertEnabled: false\n",
    Path("apps/web/src/views/chat/composables/useSendMessage.ts"): (
        'import.meta.env.VITE_STREAM_ENABLED === "true"\n'
    ),
    Path("apps/server/service/api_service/bot_capabilities.go"): (
        "func HistoryReadModeFromConfig() HistoryReadMode {\n"
        '  if viper.GetBool("bot.history_dual_read") {\n'
        "    return HistoryReadModeDual\n"
        "  }\n"
        "  return HistoryReadModeLegacy\n"
        "}\n"
    ),
}

PASS_LINE = "Bot/Web activation evidence: PASS"
FAIL_LINE = "Bot/Web activation evidence: FAIL"
MAX_FAILURE_LINES = 32
MAX_FAILURE_LENGTH = 240

_MATRIX_FIELDS = {"schema_version", "feature_flags", "rows", "rollback"}
_ROW_FIELDS = {"id", "status", "fixture_id", "fixture_sha256"}
_SAFE_FIXTURE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
_SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")
_EXPERT_DEFAULT_RE = re.compile(r"(?m)^\s*expertEnabled\s*:\s*false\b")
_CONFIG_FLAG_RE = re.compile(
    r"(?m)^\s*(?P<key>expert_enabled|stream_enabled|a2ui_actions_enabled)"
    r"\s*:\s*(?P<value>true|false)\b"
)

_FORBIDDEN_PARTS = frozenset(
    {
        "handoff",
        "handoffs",
        "ops",
        "operations",
        "phytomni-bot",
    }
)


def _within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
    except ValueError:
        return False
    return True


def _safe_relative_path(root: Path, relative: Path) -> Path | None:
    candidate = root / relative
    if not _within(candidate, root):
        return None
    try:
        parts = candidate.resolve().relative_to(root.resolve()).parts
    except ValueError:
        return None
    if any(part.casefold() in _FORBIDDEN_PARTS for part in parts):
        return None
    return candidate


def _read_text(root: Path, relative: Path, violations: list[str]) -> str | None:
    candidate = _safe_relative_path(root, relative)
    if candidate is None:
        violations.append("refusing to read out-of-scope activation path")
        return None
    try:
        raw = candidate.read_bytes()
    except FileNotFoundError:
        violations.append("missing Web activation source")
        return None
    except OSError:
        violations.append("cannot read Web activation source")
        return None
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        violations.append("Web activation source is not UTF-8")
        return None


def _extract_json_block(text: str) -> str | None:
    """Return only the explicitly delimited JSON block, never surrounding prose."""

    if text.count(MATRIX_JSON_START) != 1 or text.count(MATRIX_JSON_END) != 1:
        return None
    start = text.index(MATRIX_JSON_START) + len(MATRIX_JSON_START)
    end = text.index(MATRIX_JSON_END, start)
    if end < start:
        return None
    block = text[start:end].strip()
    if block.startswith("```json") and block.endswith("```"):
        block = block[len("```json") : -len("```")].strip()
    return block or None


def parse_matrix(text: str) -> Any | None:
    """Parse the sanitized JSON block; return ``None`` for malformed input."""

    block = _extract_json_block(text)
    if block is None:
        return None
    try:
        return json.loads(block)
    except json.JSONDecodeError:
        return None


def _row_statuses(rows: Any) -> dict[str, str]:
    """Extract safe id/status pairs for the pure feature requirement helper."""

    statuses: dict[str, str] = {}
    if isinstance(rows, Mapping):
        for row_id, status in rows.items():
            if isinstance(row_id, str) and row_id not in statuses:
                statuses[row_id] = status if isinstance(status, str) else ""
        return statuses
    if isinstance(rows, Sequence) and not isinstance(rows, (str, bytes, bytearray)):
        for row in rows:
            if not isinstance(row, Mapping):
                continue
            row_id = row.get("id")
            if isinstance(row_id, str) and row_id not in statuses:
                status = row.get("status")
                statuses[row_id] = status if isinstance(status, str) else ""
    return statuses


def _requirement_label(flag: str) -> str:
    required = FEATURE_REQUIREMENTS[flag]
    if flag == "stream":
        return "RC-WEB-001 through RC-WEB-006"
    if flag == "expert":
        return "RC-WEB-001, RC-WEB-004, RC-WEB-005, and RC-WEB-007"
    if flag == "a2ui":
        return "RC-WEB-001, RC-WEB-005, and RC-WEB-006"
    return "RC-WEB-001, RC-WEB-002, RC-WEB-003, and RC-WEB-007"


def activation_errors(
    rows: Mapping[str, Any] | Sequence[Mapping[str, Any]],
    requested_flags: Mapping[str, Any],
) -> list[str]:
    """Return bounded feature-gate errors without exposing row content."""

    errors: list[str] = []
    if isinstance(rows, Mapping):
        if any(isinstance(row_id, str) and row_id not in ROW_IDS for row_id in rows):
            errors.append("matrix row id is unknown")
    elif isinstance(rows, Sequence) and not isinstance(rows, (str, bytes, bytearray)):
        seen: set[str] = set()
        for row in rows:
            if not isinstance(row, Mapping):
                errors.append("matrix row must be an object")
                continue
            row_id = row.get("id")
            if not isinstance(row_id, str):
                errors.append("matrix row id must be a non-empty string")
                continue
            if row_id not in ROW_IDS:
                errors.append("matrix row id is unknown")
            elif row_id in seen:
                errors.append("matrix row id is duplicated")
            else:
                seen.add(row_id)
    statuses = _row_statuses(rows)
    for flag, requested in requested_flags.items():
        if flag not in FEATURE_REQUIREMENTS:
            errors.append("unknown feature flag")
            continue
        if requested is not True:
            continue
        accepted = FEATURE_ACCEPTED_STATUSES[flag]
        if any(statuses.get(row_id) not in accepted for row_id in FEATURE_REQUIREMENTS[flag]):
            errors.append(f"{flag} requires {_requirement_label(flag)} reviewed")
    return errors


def validate_rows(rows: Any) -> list[str]:
    """Validate row shape and metadata without echoing untrusted values."""

    if not isinstance(rows, list):
        return ["matrix rows must be a list"]
    errors: list[str] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            errors.append("matrix row must be an object")
            continue
        if set(row) - _ROW_FIELDS:
            errors.append("matrix row contains unsupported fields")
        row_id = row.get("id")
        if not isinstance(row_id, str) or not row_id.strip():
            errors.append("matrix row id must be a non-empty string")
            row_id = None
        elif row_id not in ROW_IDS:
            errors.append("matrix row id is unknown")
        elif row_id in seen:
            errors.append("matrix row id is duplicated")
        else:
            seen.add(row_id)

        status = row.get("status")
        if status not in ALLOWED_STATUSES:
            errors.append("matrix row status is unknown")

        fixture_id = row.get("fixture_id", "")
        digest = row.get("fixture_sha256", "")
        if not isinstance(fixture_id, str) or (
            fixture_id and not _SAFE_FIXTURE_ID_RE.fullmatch(fixture_id)
        ):
            errors.append("matrix fixture id must be bounded metadata")
        if not isinstance(digest, str) or (digest and not _SHA256_RE.fullmatch(digest)):
            errors.append("matrix fixture checksum must be 64 hex characters")
        if status == "Passed" and (
            not isinstance(fixture_id, str)
            or not fixture_id
            or not _SAFE_FIXTURE_ID_RE.fullmatch(fixture_id)
            or not isinstance(digest, str)
            or not _SHA256_RE.fullmatch(digest)
        ):
            errors.append("Passed matrix row requires fixture id and checksum")

    if set(ROW_IDS) - seen:
        errors.append("matrix rows are missing required acceptance rows")
    return errors


def _check_defaults(source: Mapping[Path, str], violations: list[str]) -> None:
    config = source.get(Path("apps/server/config/app.yml.example"), "")
    matches = {
        match.group("key"): match.group("value")
        for match in _CONFIG_FLAG_RE.finditer(config)
    }
    for key in ("expert_enabled", "stream_enabled", "a2ui_actions_enabled"):
        if matches.get(key) != "false":
            violations.append(f"{key} default must be false")

    user_store = source.get(Path("apps/web/src/stores/user.ts"), "")
    if _EXPERT_DEFAULT_RE.search(user_store) is None:
        violations.append("Web expertEnabled default must be false")

    stream_source = source.get(
        Path("apps/web/src/views/chat/composables/useSendMessage.ts"), ""
    )
    stream_refs = stream_source.count("import.meta.env.VITE_STREAM_ENABLED")
    explicit_true = len(
        re.findall(
            r'import\.meta\.env\.VITE_STREAM_ENABLED\s*===\s*["\']true["\']',
            stream_source,
        )
    )
    if stream_refs == 0 or stream_refs != explicit_true:
        violations.append("Web VITE_STREAM_ENABLED must use an explicit true opt-in")

    history_source = source.get(
        Path("apps/server/service/api_service/bot_capabilities.go"), ""
    )
    if (
        "HistoryReadModeFromConfig" not in history_source
        or 'viper.GetBool("bot.history_dual_read")' not in history_source
        or "return HistoryReadModeLegacy" not in history_source
    ):
        violations.append("history_dual_read default must remain legacy/off")


def validate_matrix(value: Any) -> list[str]:
    """Validate matrix schema, row evidence, rollback markers, and dark flags."""

    if not isinstance(value, dict):
        return ["activation matrix root must be an object"]
    errors: list[str] = []
    if set(value) - _MATRIX_FIELDS:
        errors.append("activation matrix contains unsupported fields")
    if value.get("schema_version") != 1:
        errors.append("activation matrix schema_version must be 1")

    flags = value.get("feature_flags")
    if not isinstance(flags, dict):
        errors.append("activation matrix feature_flags must be an object")
        flags = {}
    else:
        if set(flags) - set(FEATURE_FLAGS):
            errors.append("activation matrix contains an unknown feature flag")
        if set(FEATURE_FLAGS) - set(flags):
            errors.append("activation matrix is missing a feature flag")
        for flag in FEATURE_FLAGS:
            if flag in flags and not isinstance(flags[flag], bool):
                errors.append("activation matrix feature flags must be boolean")

    rows = value.get("rows")
    errors.extend(validate_rows(rows))

    rollback = value.get("rollback")
    if not isinstance(rollback, list) or any(not isinstance(item, str) for item in rollback):
        errors.append("activation matrix rollback markers must be a list")
    else:
        if set(ROLLBACK_MARKERS) - set(rollback):
            errors.append("activation matrix is missing a rollback marker")
        if set(rollback) - set(ROLLBACK_MARKERS):
            errors.append("activation matrix contains an unknown rollback marker")
        if len(rollback) != len(set(rollback)):
            errors.append("activation matrix contains a duplicate rollback marker")

    if isinstance(flags, dict) and isinstance(rows, list):
        requested = {flag: flags.get(flag) for flag in FEATURE_FLAGS}
        errors.extend(activation_errors(rows, requested))
    return errors


def _sanitize_failure(message: str) -> str:
    compact = " ".join(str(message).split())
    if len(compact) > MAX_FAILURE_LENGTH:
        return compact[: MAX_FAILURE_LENGTH - 1] + "…"
    return compact


def check(root: Path) -> list[str]:
    """Return deterministic, bounded activation violations for ``root``."""

    requested_root = Path(root)
    if any(part.casefold() in _FORBIDDEN_PARTS for part in requested_root.parts):
        return ["refusing to read out-of-scope activation root"]
    root = requested_root.resolve()
    violations: list[str] = []
    matrix_text = _read_text(root, MATRIX_REL, violations)
    if matrix_text is None:
        return [_sanitize_failure(item) for item in violations[:MAX_FAILURE_LINES]]
    matrix_value = parse_matrix(matrix_text)
    if matrix_value is None:
        violations.append("activation matrix JSON block is missing or malformed")
    else:
        violations.extend(validate_matrix(matrix_value))

    source: dict[Path, str] = {}
    for relative in DEFAULT_CHECK_FILES:
        text = _read_text(root, relative, violations)
        if text is not None:
            source[relative] = text
    _check_defaults(source, violations)
    return [_sanitize_failure(item) for item in violations[:MAX_FAILURE_LINES]]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=ROOT,
        help="Web checkout root (defaults to the checkout containing this script)",
    )
    args = parser.parse_args(argv)
    violations = check(args.root)
    if violations:
        print(FAIL_LINE)
        for violation in violations:
            print(f"- {violation}")
        return 1
    print(PASS_LINE)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
