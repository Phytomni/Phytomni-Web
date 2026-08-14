#!/usr/bin/env python3
"""Check the local, fail-closed Bot/Web activation evidence matrix.

The checker is intentionally offline.  It reads one sanitized JSON block from
the versioned Web matrix, a fixed set of Web-owned default sources, and the
small RC-WEB-004 terminal fixture metadata needed for local readiness.  It does
not inspect a sibling checkout, handoff/evidence trees, or live endpoints.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, NamedTuple


ROOT = Path(__file__).resolve().parents[1]
MATRIX_REL = Path("docs/reference/bot-web-activation-matrix.md")
MATRIX_JSON_START = "<!-- BOT_WEB_ACTIVATION_MATRIX_JSON_START -->"
MATRIX_JSON_END = "<!-- BOT_WEB_ACTIVATION_MATRIX_JSON_END -->"
RESEARCH_INPUT_FIXTURE_REL = Path(
    "apps/server/external/bot/testdata/head/research_input_resolution_v1.json"
)
RESEARCH_FORMAT_SOURCE_REL = Path(
    "apps/server/service/api_service/attachment_classifier.go"
)
RESEARCH_LIMIT_SOURCE_REL = Path("apps/server/external/bot/input_limits.go")
RESEARCH_CONTRACT_SOURCE_REL = Path(
    "apps/server/external/bot/research_input_contract.go"
)
AGENT_CANONICAL_SOURCE_REL = Path(
    "apps/server/external/bot/agent_canonical.go"
)
AGENT_MAP_SOURCE_REL = Path("apps/server/external/bot/agent_map.go")
UPLOAD_CONTRACT_SOURCE_REL = Path(
    "apps/server/external/bot/upload_contract.go"
)
_RESEARCH_INPUT_LIMIT_DECLARATIONS = {
    "max_user_query_chars": (
        "DefaultMaxUserQueryChars",
        "HardMaxUserQueryChars",
    ),
    "max_attachments_per_request": (
        "DefaultMaxAssetAttachmentRefs",
        "HardMaxAssetAttachmentRefs",
    ),
    "max_research_dataset_paths": (
        "DefaultMaxResearchDatasetPaths",
        "HardMaxResearchDatasetPaths",
    ),
    "max_research_input_references": (
        "DefaultMaxResearchInputReferences",
        "HardMaxResearchInputReferences",
    ),
}
_RESEARCH_CONTRACT_DECLARATIONS = (
    "ResearchInputProtocol",
    "ResearchInputProtocolVersion",
    "maxResearchDatasetFormats",
    "maxResearchDatasetFormatSize",
    "acceptedResearchInputFixtureSHA256",
)

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
        "  research_enabled: false\n"
        "  design_enabled: false\n"
        "  network_enabled: false\n"
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

PRODUCT_FIXTURE_IDS = ("analyst", "research", "network", "design")
PRODUCT_FIXTURE_PATHS: dict[str, Path] = {
    agent: Path(f"apps/server/external/bot/testdata/head/{agent}_terminal.json")
    for agent in PRODUCT_FIXTURE_IDS
}
PRODUCT_FIXTURE_AGENTS = {agent: agent for agent in PRODUCT_FIXTURE_IDS}
SHARED_REPORT_SURFACE_TEST = Path(
    "apps/web/tests/component/BotRemoteAgentSurfaces.spec.ts"
)
SHARED_REPORT_SURFACE_MARKER = '"renders one shared report contract for %s"'

PASS_LINE = "Bot/Web activation evidence: PASS"
FAIL_LINE = "Bot/Web activation evidence: FAIL"
MAX_FAILURE_LINES = 32
MAX_FAILURE_LENGTH = 240
MAX_MATRIX_JSON_BYTES = 256 * 1024
MAX_MATRIX_JSON_DEPTH = 256
MAX_RESEARCH_INPUT_FIXTURE_BYTES = 256 * 1024


class _ResearchGoContract(NamedTuple):
    protocol: str
    protocol_version: int
    limit_bounds: dict[str, tuple[int, int]]
    archive_formats: frozenset[str]
    max_dataset_formats: int
    max_dataset_format_size: int
    accepted_fixture_sha256: str
    canonical_agent_tools: dict[str, str]
    max_agent_descriptors: int
    max_dataset_file_bytes: int


class _GoLexicalView(NamedTuple):
    masked: str
    brace_depth: tuple[int, ...]


_MATRIX_FIELDS = {
    "schema_version",
    "feature_flags",
    "rows",
    "rollback",
    "local_readiness",
}
_ROW_FIELDS = {"id", "status", "fixture_id", "fixture_sha256"}
_LOCAL_READINESS_FIELDS = {"rc_web_004"}
_RC_WEB_004_READINESS_FIELDS = {"fixture_ids", "shared_report_surface_test"}
_SAFE_FIXTURE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
_SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")
_RESEARCH_FORMAT_RE = re.compile(r"^[a-z0-9][a-z0-9.+_-]*$")
_RESEARCH_PROTOCOL_RE = re.compile(r"^[a-z0-9][a-z0-9_]*$")
_EXPERT_DEFAULT_RE = re.compile(
    r"(?m)^[ \t]*expertEnabled[ \t]*:[ \t]*(?P<value>true|false)\b"
)
_CONFIG_FLAG_RE = re.compile(
    r"(?m)^[ \t]*(?P<key>expert_enabled|stream_enabled|a2ui_actions_enabled|"
    r"research_enabled|design_enabled|network_enabled)"
    r"[ \t]*:[ \t]*(?P<value>true|false)\b"
)
_HISTORY_FUNCTION_RE = re.compile(
    r"(?m)^[ \t]*func[ \t]+HistoryReadModeFromConfig[ \t]*\([^)]*\)"
    r"[ \t]*HistoryReadMode[ \t]*\{"
)

_YAML_BLOCK_SCALAR_RE = re.compile(
    r"^[ \t]*(?!#)[^#\n]*:[ \t]*(?P<indicator>[|>])"
    r"(?P<modifiers>[+-]?[1-9]?[+-]?)[ \t]*(?:#.*)?$"
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

_PRIVATE_DELIVERY_FIELDS = frozenset(
    {
        "delivery_internal",
        "inventory",
        "object_ref",
        "private_delivery",
        "retry_attempts",
    }
)
_FIXTURE_DEPTH_LIMIT_MARKER = "__fixture_depth_limit__"
_RESULT_ARCHIVE_REF_RE = re.compile(r"^result-archive:sha256:[0-9a-f]{64}$")
_RESULT_ARCHIVE_DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")


def _has_forbidden_part(path: Path) -> bool:
    return any(part.casefold() in _FORBIDDEN_PARTS for part in path.parts)


def _resolve(path: Path) -> Path | None:
    try:
        return path.resolve()
    except (OSError, RuntimeError):
        return None


def _safe_relative_path(root: Path, relative: Path) -> Path | None:
    candidate = root / relative
    resolved_root = _resolve(root)
    resolved_candidate = _resolve(candidate)
    if resolved_root is None or resolved_candidate is None:
        return None
    try:
        resolved_candidate.relative_to(resolved_root)
    except ValueError:
        return None
    if _has_forbidden_part(resolved_candidate):
        return None
    return candidate


def _read_bytes(root: Path, relative: Path, violations: list[str]) -> bytes | None:
    candidate = _safe_relative_path(root, relative)
    if candidate is None:
        violations.append("refusing to read out-of-scope activation path")
        return None
    try:
        return candidate.read_bytes()
    except FileNotFoundError:
        violations.append("missing Web activation source")
    except OSError:
        violations.append("cannot read Web activation source")

    return None


def _read_text(root: Path, relative: Path, violations: list[str]) -> str | None:
    raw = _read_bytes(root, relative, violations)
    if raw is None:
        return None
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        violations.append("Web activation source is not UTF-8")
        return None


def _go_top_level_const_bodies(
    source: str,
) -> list[tuple[str, str]] | None:
    """Return source/masked bodies for finite package-level const declarations."""

    lexical = _scan_go_source(source)
    if lexical is None:
        return None
    masked = lexical.masked
    bodies: list[tuple[str, str]] = []
    for match in re.finditer(r"\bconst\b", masked):
        if lexical.brace_depth[match.start()] != 0:
            continue
        cursor = match.end()
        while cursor < len(masked) and masked[cursor] in " \t":
            cursor += 1
        if cursor < len(masked) and masked[cursor] == "(":
            opening = cursor
            depth = 0
            closing = None
            for index in range(opening, len(masked)):
                if masked[index] == "(":
                    depth += 1
                elif masked[index] == ")":
                    depth -= 1
                    if depth == 0:
                        closing = index
                        break
            if closing is None:
                return None
            bodies.append(
                (
                    source[opening + 1 : closing],
                    masked[opening + 1 : closing],
                )
            )
            continue

        line_end = masked.find("\n", cursor)
        if line_end < 0:
            line_end = len(masked)
        bodies.append((source[cursor:line_end], masked[cursor:line_end]))
    return bodies


def _parse_go_finite_literal(
    literal: str, declared_type: str | None
) -> str | int | None:
    if re.fullmatch(r'"(?:\\.|[^"\\])*"', literal):
        if declared_type not in (None, "string"):
            return None
        try:
            value = json.loads(literal)
        except (TypeError, ValueError):
            return None
        return value if isinstance(value, str) else None

    decimal = r"[0-9](?:_?[0-9])*"
    integer = re.fullmatch(
        rf"(?P<base>{decimal})(?:[ \t]*<<[ \t]*(?P<shift>{decimal}))?",
        literal,
    )
    if integer is None or declared_type not in (None, "int", "int64"):
        return None
    base = int(integer.group("base").replace("_", ""))
    shift_text = integer.group("shift")
    shift = int(shift_text.replace("_", "")) if shift_text else 0
    if shift > 62:
        return None
    value = base << shift
    return value if value <= (1 << 63) - 1 else None


def _parse_go_named_const_literals(
    source: str, expected_names: tuple[str, ...]
) -> dict[str, str | int] | None:
    """Extract only guarded const symbols and reject ambiguous declarations."""

    bodies = _go_top_level_const_bodies(source)
    if bodies is None:
        return None
    expected = set(expected_names)
    values: dict[str, str | int] = {}
    for body, masked_body in bodies:
        starts = [0]
        starts.extend(match.end() for match in re.finditer(r"[;\r\n]", masked_body))
        ends = [match.start() for match in re.finditer(r"[;\r\n]", masked_body)]
        ends.append(len(masked_body))
        for start, end in zip(starts, ends, strict=True):
            masked_spec = masked_body[start:end]
            source_spec = _strip_go_comments(body[start:end]).strip()
            equals = masked_spec.find("=")
            lhs = masked_spec if equals < 0 else masked_spec[:equals]
            identifiers = re.findall(r"[A-Za-z_][A-Za-z0-9_]*", lhs)
            guarded = [name for name in identifiers if name in expected]
            if not guarded:
                continue
            if len(guarded) != 1 or identifiers[0] != guarded[0]:
                return None
            name = guarded[0]
            if name in values:
                return None
            declaration = re.fullmatch(
                rf"{re.escape(name)}"
                r"(?:[ \t]+(?P<type>[A-Za-z_][A-Za-z0-9_]*))?"
                r"[ \t]*=[ \t]*(?P<literal>.+?)",
                source_spec,
            )
            if declaration is None:
                return None
            value = _parse_go_finite_literal(
                declaration.group("literal").strip(), declaration.group("type")
            )
            if value is None:
                return None
            values[name] = value
    return values if set(values) == expected else None


def _parse_go_string_map(source: str, name: str) -> dict[str, str] | None:
    lexical = _scan_go_source(source)
    if lexical is None:
        return None
    masked = lexical.masked
    guarded = list(
        match
        for match in re.finditer(rf"\bvar[ \t]+{re.escape(name)}\b", masked)
        if lexical.brace_depth[match.start()] == 0
    )
    declaration = re.compile(
        rf"\bvar[ \t]+{re.escape(name)}[ \t]*=[ \t]*"
        r"map[ \t]*\[[ \t]*string[ \t]*\][ \t]*string[ \t]*\{"
    )
    matches = [
        match
        for match in declaration.finditer(masked)
        if lexical.brace_depth[match.start()] == 0
    ]
    if (
        len(guarded) != 1
        or len(matches) != 1
        or guarded[0].start() != matches[0].start()
    ):
        return None
    opening = matches[0].end() - 1
    depth = 0
    closing = None
    for index in range(opening, len(masked)):
        if masked[index] == "{":
            depth += 1
        elif masked[index] == "}":
            depth -= 1
            if depth == 0:
                closing = index
                break
    if closing is None:
        return None

    body = _strip_go_comments(source[opening + 1 : closing])
    entry = re.compile(
        r'\s*(?P<key>"(?:\\.|[^"\\])*")[ \t]*:[ \t]*'
        r'(?P<value>"(?:\\.|[^"\\])*")[ \t]*,?'
    )
    values: dict[str, str] = {}
    position = 0
    while position < len(body):
        if not body[position:].strip():
            break
        match = entry.match(body, position)
        if match is None:
            return None
        try:
            key = json.loads(match.group("key"))
            value = json.loads(match.group("value"))
        except (TypeError, ValueError):
            return None
        if not isinstance(key, str) or not isinstance(value, str) or key in values:
            return None
        values[key] = value
        position = match.end()
    return values or None


def _parse_go_string_set_map(source: str, name: str) -> set[str] | None:
    lexical = _scan_go_source(source)
    if lexical is None:
        return None
    masked = lexical.masked
    guarded = [
        match
        for match in re.finditer(rf"\bvar\s+{re.escape(name)}\b", masked)
        if lexical.brace_depth[match.start()] == 0
    ]
    declaration = re.compile(
        rf"\bvar\s+{re.escape(name)}\s*=\s*"
        r"map\s*\[\s*string\s*\]\s*struct\s*\{\s*\}\s*\{"
    )
    matches = [
        match
        for match in declaration.finditer(masked)
        if lexical.brace_depth[match.start()] == 0
    ]
    if (
        len(guarded) != 1
        or len(matches) != 1
        or guarded[0].start() != matches[0].start()
    ):
        return None
    opening = matches[0].end() - 1
    depth = 0
    closing = None
    for index in range(opening, len(masked)):
        if masked[index] == "{":
            depth += 1
        elif masked[index] == "}":
            depth -= 1
            if depth == 0:
                closing = index
                break
    if closing is None:
        return None

    body = _strip_go_comments(source[opening + 1 : closing])
    entry = re.compile(
        r'\s*"(?P<key>\.?[a-z0-9][a-z0-9.]*)"\s*:\s*\{\s*\}\s*,?'
    )
    values: set[str] = set()
    position = 0
    while position < len(body):
        if not body[position:].strip():
            break
        match = entry.match(body, position)
        if match is None:
            return None
        token = match.group("key")
        if token in values:
            return None
        values.add(token)
        position = match.end()
    return values or None


def _parse_go_suffix_map(source: str, name: str) -> set[str] | None:
    values = _parse_go_string_set_map(source, name)
    if values is None or any(not value.startswith(".") for value in values):
        return None
    return {value.removeprefix(".") for value in values}


def _load_research_go_contract(
    limit_source: str | None,
    contract_source: str | None,
    agent_canonical_source: str | None,
    agent_map_source: str | None,
    upload_contract_source: str | None,
    violations: list[str],
) -> _ResearchGoContract | None:
    if any(
        source is None
        for source in (
            limit_source,
            contract_source,
            agent_canonical_source,
            agent_map_source,
            upload_contract_source,
        )
    ):
        violations.append("Web Research Go contract sources are missing")
        return None

    assert limit_source is not None
    assert contract_source is not None
    assert agent_canonical_source is not None
    assert agent_map_source is not None
    assert upload_contract_source is not None

    limit_names = tuple(
        name
        for declaration_names in _RESEARCH_INPUT_LIMIT_DECLARATIONS.values()
        for name in declaration_names
    )
    limit_values = _parse_go_named_const_literals(
        limit_source, limit_names
    )
    contract_values = _parse_go_named_const_literals(
        contract_source, _RESEARCH_CONTRACT_DECLARATIONS
    )
    agent_tools = _parse_go_string_map(
        agent_canonical_source, "CanonicalAgentTool"
    )
    descriptor_values = _parse_go_named_const_literals(
        agent_map_source, ("maxBotAgentDescriptors",)
    )
    upload_values = _parse_go_named_const_literals(
        upload_contract_source, ("maxResumableUploadFileBytes",)
    )
    archive_formats = _parse_go_string_set_map(
        contract_source, "acceptedResearchArchiveFormats"
    )
    accepted_digest = (
        contract_values.get("acceptedResearchInputFixtureSHA256")
        if contract_values is not None
        else None
    )
    max_agent_descriptors = (
        descriptor_values.get("maxBotAgentDescriptors")
        if descriptor_values is not None
        else None
    )
    max_dataset_file_bytes = (
        upload_values.get("maxResumableUploadFileBytes")
        if upload_values is not None
        else None
    )
    if limit_values is None or contract_values is None:
        violations.append("Web Research Go contract sources are malformed or drifted")
        return None

    limit_bounds: dict[str, tuple[int, int]] = {}
    for field, (
        default_name,
        hard_name,
    ) in _RESEARCH_INPUT_LIMIT_DECLARATIONS.items():
        default_value = limit_values.get(default_name)
        hard_value = limit_values.get(hard_name)
        if (
            not isinstance(default_value, int)
            or not isinstance(hard_value, int)
            or default_value < 1
            or hard_value < default_value
        ):
            violations.append(
                "Web Research Go contract sources are malformed or drifted"
            )
            return None
        limit_bounds[field] = (default_value, hard_value)

    reference_bounds = limit_bounds["max_research_input_references"]
    attachment_bounds = limit_bounds["max_attachments_per_request"]
    dataset_bounds = limit_bounds["max_research_dataset_paths"]
    protocol = contract_values.get("ResearchInputProtocol")
    protocol_version = contract_values.get("ResearchInputProtocolVersion")
    max_dataset_formats = contract_values.get("maxResearchDatasetFormats")
    max_dataset_format_size = contract_values.get("maxResearchDatasetFormatSize")
    if (
        not isinstance(protocol, str)
        or _RESEARCH_PROTOCOL_RE.fullmatch(protocol) is None
        or not isinstance(protocol_version, int)
        or protocol_version < 1
        or not isinstance(max_dataset_formats, int)
        or max_dataset_formats < 1
        or not isinstance(max_dataset_format_size, int)
        or max_dataset_format_size < 1
        or not isinstance(accepted_digest, str)
        or re.fullmatch(r"[0-9a-f]{64}", accepted_digest) is None
        or agent_tools is None
        or not isinstance(max_agent_descriptors, int)
        or max_agent_descriptors < 1
        or not isinstance(max_dataset_file_bytes, int)
        or max_dataset_file_bytes < 1
        or archive_formats is None
        or len(archive_formats) > max_dataset_formats
        or any(
            len(value) > max_dataset_format_size
            or _RESEARCH_FORMAT_RE.fullmatch(value) is None
            for value in archive_formats
        )
        or any(
            reference_bounds[index]
            < max(attachment_bounds[index], dataset_bounds[index])
            for index in (0, 1)
        )
    ):
        violations.append("Web Research Go contract sources are malformed or drifted")
        return None

    return _ResearchGoContract(
        protocol=protocol,
        protocol_version=protocol_version,
        limit_bounds=limit_bounds,
        archive_formats=frozenset(archive_formats),
        max_dataset_formats=max_dataset_formats,
        max_dataset_format_size=max_dataset_format_size,
        accepted_fixture_sha256=accepted_digest,
        canonical_agent_tools=agent_tools,
        max_agent_descriptors=max_agent_descriptors,
        max_dataset_file_bytes=max_dataset_file_bytes,
    )


def _parse_research_input_fixture(text: str) -> Mapping[str, Any] | None:
    if len(text.encode("utf-8")) > MAX_RESEARCH_INPUT_FIXTURE_BYTES:
        return None

    def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        value: dict[str, Any] = {}
        for key, item in pairs:
            if key in value:
                raise ValueError("duplicate key")
            value[key] = item
        return value

    try:
        value = json.loads(text, object_pairs_hook=reject_duplicate_keys)
    except (RecursionError, TypeError, ValueError):
        return None
    return value if isinstance(value, Mapping) else None


def _normalized_research_formats(
    value: Any, max_formats: int, max_format_size: int
) -> set[str] | None:
    if not isinstance(value, list) or not 1 <= len(value) <= max_formats:
        return None
    normalized: set[str] = set()
    for item in value:
        if (
            not isinstance(item, str)
            or item != item.strip().lower()
            or len(item) > max_format_size
            or _RESEARCH_FORMAT_RE.fullmatch(item) is None
            or item in normalized
        ):
            return None
        normalized.add(item)
    return normalized


def _bounded_integer(value: Any, floor: int, ceiling: int) -> bool:
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and floor <= value <= ceiling
    )


def _check_research_input_contract(
    root: Path,
    format_source: str | None,
    limit_source: str | None,
    contract_source: str | None,
    agent_canonical_source: str | None,
    agent_map_source: str | None,
    upload_contract_source: str | None,
    violations: list[str],
) -> None:
    go_contract = _load_research_go_contract(
        limit_source,
        contract_source,
        agent_canonical_source,
        agent_map_source,
        upload_contract_source,
        violations,
    )
    fixture_raw = _read_bytes(root, RESEARCH_INPUT_FIXTURE_REL, violations)
    if fixture_raw is None:
        violations.append("research_input_resolution_v1.json is missing")
        return
    if (
        go_contract is not None
        and hashlib.sha256(fixture_raw).hexdigest()
        != go_contract.accepted_fixture_sha256
    ):
        violations.append("Research fixture SHA-256 differs from accepted bytes")
    try:
        fixture_text = fixture_raw.decode("utf-8")
    except UnicodeDecodeError:
        violations.append("research_input_resolution_v1.json is not UTF-8")
        return
    fixture = _parse_research_input_fixture(fixture_text)
    if fixture is None:
        violations.append("research_input_resolution_v1.json is malformed")
        return
    if go_contract is None:
        return

    protocols = fixture.get("protocols")
    versions = (
        protocols.get(go_contract.protocol) if isinstance(protocols, Mapping) else None
    )
    if versions != [go_contract.protocol_version]:
        violations.append("research input protocol is incompatible")

    descriptor = fixture.get("research_input_resolution")
    if not isinstance(descriptor, Mapping):
        violations.append("research_input_resolution descriptor is missing")
    else:
        valid_limits: dict[str, int] = {}
        for field, (floor, ceiling) in go_contract.limit_bounds.items():
            value = descriptor.get(field)
            if not _bounded_integer(value, floor, ceiling):
                violations.append(
                    f"research_input_resolution.{field} is outside Web bounds"
                )
            else:
                valid_limits[field] = value
        references = valid_limits.get("max_research_input_references")
        attachments_limit = valid_limits.get("max_attachments_per_request")
        dataset_paths = valid_limits.get("max_research_dataset_paths")
        if references is not None and (
            (attachments_limit is not None and references < attachments_limit)
            or (dataset_paths is not None and references < dataset_paths)
        ):
            violations.append("research input reference limit is below an input lane")

    data = fixture.get("data")
    if not isinstance(data, list) or len(data) > go_contract.max_agent_descriptors:
        violations.append("agent descriptor catalog is malformed")
        return
    research_rows: list[Mapping[str, Any]] = []
    seen_slugs: set[str] = set()
    for row in data:
        if not isinstance(row, Mapping):
            violations.append("agent descriptor catalog is malformed")
            continue
        slug = row.get("slug")
        tool = row.get("tool")
        if (
            not isinstance(slug, str)
            or not isinstance(tool, str)
            or slug != slug.strip()
            or tool != tool.strip()
            or go_contract.canonical_agent_tools.get(slug) != tool
            or slug in seen_slugs
        ):
            violations.append("agent descriptor catalog is malformed")
        else:
            seen_slugs.add(slug)
        if slug == "research":
            research_rows.append(row)
    if len(research_rows) != 1:
        violations.append("research capability row count must be one")
        return
    capabilities = research_rows[0].get("capabilities")
    attachments = capabilities.get("attachments") if isinstance(capabilities, Mapping) else None
    document_context = (
        attachments.get("document_context") if isinstance(attachments, Mapping) else None
    )
    datasets = attachments.get("datasets") if isinstance(attachments, Mapping) else None
    attachment_floor, attachment_ceiling = go_contract.limit_bounds[
        "max_attachments_per_request"
    ]
    if not isinstance(document_context, Mapping) or not _bounded_integer(
        document_context.get("max_files"), attachment_floor, attachment_ceiling
    ):
        violations.append("research document_context.max_files is outside Web bounds")
    if not isinstance(datasets, Mapping) or not _bounded_integer(
        datasets.get("max_files"), attachment_floor, attachment_ceiling
    ):
        violations.append("research datasets.max_files is outside Web bounds")
        return

    max_files = datasets["max_files"]
    max_file_bytes = datasets.get("max_file_bytes")
    max_total_bytes = datasets.get("max_total_bytes")
    if not _bounded_integer(
        max_file_bytes, 1, go_contract.max_dataset_file_bytes
    ):
        violations.append("research datasets.max_file_bytes is outside Web bounds")
    max_total_bytes_ceiling = (
        go_contract.max_dataset_file_bytes * attachment_ceiling
    )
    if (
        not isinstance(max_total_bytes, int)
        or isinstance(max_total_bytes, bool)
        or not isinstance(max_file_bytes, int)
        or isinstance(max_file_bytes, bool)
        or max_total_bytes < max_file_bytes
        or max_total_bytes > max_total_bytes_ceiling
        or max_total_bytes > max_file_bytes * max_files
    ):
        violations.append("research datasets.max_total_bytes is outside Web bounds")

    advertised_formats = _normalized_research_formats(
        datasets.get("formats"),
        go_contract.max_dataset_formats,
        go_contract.max_dataset_format_size,
    )
    archive_formats = (
        _parse_go_suffix_map(format_source, "archiveAttachmentSuffixes")
        if format_source is not None
        else None
    )
    dataset_formats = (
        _parse_go_suffix_map(format_source, "datasetAttachmentSuffixes")
        if format_source is not None
        else None
    )
    if (
        archive_formats != go_contract.archive_formats
        or dataset_formats is None
        or "mtx" not in dataset_formats
    ):
        violations.append("attachment_classifier.go Research format maps are malformed")
        return
    required_formats = archive_formats | dataset_formats
    if advertised_formats is None or not required_formats.issubset(advertised_formats):
        violations.append("research datasets.formats do not cover Web formats")


def _extract_json_block(text: str) -> str | None:
    """Return only the explicitly delimited JSON block, never surrounding prose."""

    if text.count(MATRIX_JSON_START) != 1 or text.count(MATRIX_JSON_END) != 1:
        return None
    marker_start = text.find(MATRIX_JSON_START)
    marker_end = text.find(MATRIX_JSON_END)
    if marker_start < 0 or marker_end < 0 or marker_end <= marker_start:
        return None
    start = marker_start + len(MATRIX_JSON_START)
    end = marker_end
    block = text[start:end].strip()
    if block.startswith("```json") and block.endswith("```"):
        block = block[len("```json") : -len("```")].strip()
    return block or None


def parse_matrix(text: str) -> Any | None:
    """Parse the sanitized JSON block; return ``None`` for malformed input."""

    block = _extract_json_block(text)
    if block is None:
        return None
    if len(block.encode("utf-8")) > MAX_MATRIX_JSON_BYTES:
        return None

    depth = 0
    in_string = False
    escaped = False
    for char in block:
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char in "[{":
            depth += 1
            if depth > MAX_MATRIX_JSON_DEPTH:
                return None
        elif char in "]}":
            depth -= 1
            if depth < 0:
                return None
    if in_string or depth != 0:
        return None
    try:
        return json.loads(block)
    except (RecursionError, TypeError, ValueError):
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


def validate_local_readiness(value: Any) -> list[str]:
    """Validate the local-only RC-WEB-004 evidence references."""

    if not isinstance(value, dict):
        return ["local readiness must be an object"]
    errors: list[str] = []
    if set(value) != _LOCAL_READINESS_FIELDS:
        errors.append("local readiness must contain only RC-WEB-004")
    entry = value.get("rc_web_004")
    if not isinstance(entry, dict):
        return [*errors, "RC-WEB-004 local readiness must be an object"]
    if set(entry) != _RC_WEB_004_READINESS_FIELDS:
        errors.append("RC-WEB-004 local readiness fields are unsupported")

    fixture_ids = entry.get("fixture_ids")
    if not isinstance(fixture_ids, list) or any(
        not isinstance(item, str) or not _SAFE_FIXTURE_ID_RE.fullmatch(item)
        for item in fixture_ids
    ):
        errors.append("RC-WEB-004 local fixture ids must be bounded metadata")
    elif len(fixture_ids) != len(PRODUCT_FIXTURE_IDS) or len(set(fixture_ids)) != len(fixture_ids):
        errors.append("RC-WEB-004 requires four distinct product fixture ids")
    elif set(fixture_ids) != set(PRODUCT_FIXTURE_IDS):
        errors.append("RC-WEB-004 product fixture ids are incomplete")

    shared_test = entry.get("shared_report_surface_test")
    if shared_test != SHARED_REPORT_SURFACE_TEST.as_posix():
        errors.append("RC-WEB-004 shared report-surface test is not the Web contract test")
    return errors


def _fixture_field_names(value: Any, depth: int = 0) -> set[str]:
    """Collect bounded JSON object keys without retaining fixture values."""

    if depth > 32:
        return {_FIXTURE_DEPTH_LIMIT_MARKER}
    if isinstance(value, dict):
        names: set[str] = set()
        for key, child in value.items():
            if isinstance(key, str):
                names.add(key)
            names.update(_fixture_field_names(child, depth + 1))
        return names
    if isinstance(value, list):
        names: set[str] = set()
        for child in value:
            names.update(_fixture_field_names(child, depth + 1))
        return names
    return set()


def _load_fixture_json(root: Path, relative: Path, violations: list[str]) -> Any | None:
    text = _read_text(root, relative, violations)
    if text is None:
        return None
    try:
        return json.loads(text)
    except (RecursionError, TypeError, ValueError):
        violations.append("RC-WEB-004 product fixture JSON is malformed")
        return None


def _check_product_fixture(root: Path, fixture_id: str, violations: list[str]) -> None:
    payload = _load_fixture_json(root, PRODUCT_FIXTURE_PATHS[fixture_id], violations)
    if not isinstance(payload, dict):
        if payload is not None:
            violations.append("RC-WEB-004 product fixture must be an object")
        return

    if payload.get("agent") != PRODUCT_FIXTURE_AGENTS[fixture_id]:
        violations.append("RC-WEB-004 product fixture agent slug is not canonical")
    field_names = _fixture_field_names(payload)
    if _FIXTURE_DEPTH_LIMIT_MARKER in field_names:
        violations.append("RC-WEB-004 product fixture nesting exceeds scanner bound")
    if field_names & _PRIVATE_DELIVERY_FIELDS:
        violations.append("RC-WEB-004 product fixture contains private delivery fields")

    result = payload.get("result")
    if not isinstance(result, dict):
        violations.append("RC-WEB-004 product fixture result must be an object")
        return
    formatted = result.get("formatted")
    formatted_answer = formatted.get("answer") if isinstance(formatted, dict) else ""
    if not isinstance(formatted_answer, str) or not formatted_answer.strip():
        violations.append("RC-WEB-004 product fixture needs a formatted answer")
    if "artifacts" in result:
        violations.append("RC-WEB-004 product fixture contains legacy artifacts")
        return
    execution = result.get("execution")
    if not isinstance(execution, dict):
        violations.append("RC-WEB-004 product fixture execution must be an object")
        return
    delivery = execution.get("delivery")
    if not isinstance(delivery, dict):
        violations.append("RC-WEB-004 product fixture execution delivery must be an object")
        return
    if delivery.get("schema_version") != 1:
        violations.append("RC-WEB-004 product fixture delivery protocol_version must be 1")
    if delivery.get("required") is not True or delivery.get("status") != "ready":
        violations.append("RC-WEB-004 product fixture delivery must be required and ready")
    archive = delivery.get("archive")
    if not isinstance(archive, dict):
        violations.append("RC-WEB-004 product fixture delivery archive must be an object")
        return
    if archive.get("role") != "result_archive" or archive.get("name") != f"{fixture_id}-results.zip":
        violations.append("RC-WEB-004 product fixture delivery archive identity is invalid")
    if not isinstance(archive.get("size_bytes"), int) or archive["size_bytes"] <= 0:
        violations.append("RC-WEB-004 product fixture delivery archive size_bytes is invalid")
    download_ref = archive.get("download_ref")
    if not isinstance(download_ref, str) or not _RESULT_ARCHIVE_REF_RE.fullmatch(download_ref):
        violations.append("RC-WEB-004 product fixture delivery archive download_ref is unsafe")
    digest = delivery.get("inventory_digest")
    if not isinstance(digest, str) or not _RESULT_ARCHIVE_DIGEST_RE.fullmatch(digest):
        violations.append("RC-WEB-004 product fixture delivery digest is invalid")
    artifacts = execution.get("artifacts")
    if not isinstance(artifacts, list):
        violations.append("RC-WEB-004 product fixture execution artifacts must be a list")
    elif sum(isinstance(item, dict) and item.get("role") == "result_archive" for item in artifacts) != 0:
        violations.append("RC-WEB-004 product fixture must contain exactly one archive")


def _check_rc_web_004_local_readiness(
    root: Path, readiness: Any, rows: Any, violations: list[str]
) -> None:
    if not isinstance(readiness, dict):
        return
    entry = readiness.get("rc_web_004")
    if not isinstance(entry, dict):
        return
    fixture_ids = entry.get("fixture_ids")
    if isinstance(fixture_ids, list) and set(fixture_ids) == set(PRODUCT_FIXTURE_IDS):
        for fixture_id in PRODUCT_FIXTURE_IDS:
            _check_product_fixture(root, fixture_id, violations)

    if entry.get("shared_report_surface_test") == SHARED_REPORT_SURFACE_TEST.as_posix():
        source = _read_text(root, SHARED_REPORT_SURFACE_TEST, violations)
        if source is not None:
            if SHARED_REPORT_SURFACE_MARKER not in source:
                violations.append("RC-WEB-004 shared report-surface test is missing")
            for fixture_id in PRODUCT_FIXTURE_IDS:
                if fixture_id not in source:
                    violations.append("RC-WEB-004 shared report-surface test lacks product fixture coverage")

    if isinstance(rows, list):
        for row in rows:
            if isinstance(row, dict) and row.get("id") == "RC-WEB-004":
                if row.get("status") != "External Pending":
                    violations.append("RC-WEB-004 external status must remain External Pending")
                break


def _mask_javascript_non_code(text: str) -> str:
    """Mask JavaScript comments and literals while preserving line structure."""

    output = list(text)
    state = "code"
    index = 0
    while index < len(text):
        char = text[index]
        if state == "code":
            if text.startswith("//", index):
                output[index] = output[index + 1] = " "
                state = "line_comment"
                index += 2
                continue
            if text.startswith("/*", index):
                output[index] = output[index + 1] = " "
                state = "block_comment"
                index += 2
                continue
            if char in {'"', "'", "`"}:
                output[index] = " "
                state = char
            index += 1
            continue

        if state == "line_comment":
            if char in "\r\n":
                state = "code"
            else:
                output[index] = " "
            index += 1
            continue

        if state == "block_comment":
            if text.startswith("*/", index):
                output[index] = output[index + 1] = " "
                state = "code"
                index += 2
                continue
            if char not in "\r\n":
                output[index] = " "
            index += 1
            continue

        # A quoted or template literal.  The contents of a template
        # interpolation are deliberately masked too: the activation marker
        # must be an executable property in the source, not arbitrary template
        # text that happens to contain the same spelling.
        if char == "\\":
            output[index] = " "
            if index + 1 < len(text):
                if text[index + 1] not in "\r\n":
                    output[index + 1] = " "
                index += 2
                continue
        elif char == state:
            output[index] = " "
            state = "code"
        else:
            if char not in "\r\n":
                output[index] = " "
        index += 1
    return "".join(output)


def _mask_yaml_block_scalars(text: str) -> str:
    """Mask YAML literal/folded block scalar contents.

    The activation defaults are ordinary scalar keys.  A line that merely
    resembles one inside ``notes: |`` or ``notes: >`` is payload text and must
    not satisfy the exact-single-key check.
    """

    output: list[str] = []
    block_parent_indent: int | None = None
    block_content_indent: int | None = None
    for line in text.splitlines(keepends=True):
        body = line.rstrip("\r\n")
        if block_parent_indent is not None:
            if not body.strip():
                output.append("".join(char if char in "\r\n" else " " for char in line))
                continue
            indent = len(body) - len(body.lstrip(" \t"))
            required = block_content_indent
            if (required is None and indent > block_parent_indent) or (
                required is not None and indent >= required
            ):
                if required is None:
                    block_content_indent = indent
                output.append(
                    "".join(char if char in "\r\n" else " " for char in line)
                )
                continue
            block_parent_indent = None
            block_content_indent = None

        output.append(line)
        if body.lstrip(" \t").startswith("#"):
            continue
        match = _YAML_BLOCK_SCALAR_RE.fullmatch(body)
        if match is None:
            continue
        modifiers = match.group("modifiers")
        explicit = next((int(char) for char in modifiers if char.isdigit()), None)
        block_parent_indent = len(body) - len(body.lstrip(" \t"))
        block_content_indent = (
            block_parent_indent + explicit if explicit is not None else None
        )
    return "".join(output)


def _scan_go_source(text: str) -> _GoLexicalView | None:
    """Return a fail-closed lexical mask and brace depth for Go source."""

    output = list(text)
    brace_depths = [0] * (len(text) + 1)
    brace_depth = 0
    state = "code"
    index = 0
    while index < len(text):
        brace_depths[index] = brace_depth
        char = text[index]
        if state == "code":
            if text.startswith("//", index):
                output[index] = output[index + 1] = " "
                state = "line_comment"
                index += 2
                continue
            if text.startswith("/*", index):
                output[index] = output[index + 1] = " "
                state = "block_comment"
                index += 2
                continue
            if char in {'"', "'", "`"}:
                output[index] = " "
                state = char
            elif char == "{":
                brace_depth += 1
            elif char == "}":
                if brace_depth == 0:
                    return None
                brace_depth -= 1
            index += 1
            continue

        if state == "line_comment":
            if char in "\r\n":
                state = "code"
            else:
                output[index] = " "
            index += 1
            continue

        if state == "block_comment":
            if text.startswith("*/", index):
                output[index] = output[index + 1] = " "
                state = "code"
                index += 2
                continue
            if char not in "\r\n":
                output[index] = " "
            index += 1
            continue

        if state == "`":
            if char == "`":
                output[index] = " "
                state = "code"
            elif char not in "\r\n":
                output[index] = " "
            index += 1
            continue

        if char == "\\":
            output[index] = " "
            if index + 1 >= len(text) or text[index + 1] in "\r\n":
                return None
            brace_depths[index + 1] = brace_depth
            output[index + 1] = " "
            index += 2
            continue
        elif char == state:
            output[index] = " "
            state = "code"
        elif char in "\r\n":
            return None
        else:
            output[index] = " "
        index += 1

    if state not in {"code", "line_comment"} or brace_depth != 0:
        return None
    brace_depths[len(text)] = brace_depth
    return _GoLexicalView("".join(output), tuple(brace_depths))


def _mask_go_non_code(text: str) -> str | None:
    lexical = _scan_go_source(text)
    return lexical.masked if lexical is not None else None


def _strip_go_comments(text: str) -> str:
    """Remove Go comments while preserving strings and line structure."""

    output: list[str] = []
    state = "code"
    index = 0
    while index < len(text):
        char = text[index]
        if state == "code":
            if text.startswith("//", index):
                output.append(" ")
                index += 2
                while index < len(text) and text[index] != "\n":
                    index += 1
                continue
            if text.startswith("/*", index):
                output.append(" ")
                index += 2
                while index < len(text):
                    if text.startswith("*/", index):
                        index += 2
                        break
                    if text[index] == "\n":
                        output.append("\n")
                    index += 1
                continue
            output.append(char)
            if char in {'"', "'", "`"}:
                state = char
            index += 1
            continue

        output.append(char)
        if char == "\\" and state in {'"', "'"} and index + 1 < len(text):
            output.append(text[index + 1])
            index += 2
            continue
        if char == state:
            state = "code"
        index += 1
    return "".join(output)


def _history_function_body(source: str) -> str | None:
    masked = _mask_go_non_code(source)
    if masked is None:
        return None
    matches = list(_HISTORY_FUNCTION_RE.finditer(masked))
    if len(matches) != 1:
        return None
    opening = matches[0].end() - 1
    depth = 0
    for index in range(opening, len(masked)):
        char = masked[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return _strip_go_comments(source[opening + 1 : index])
    return None


def _history_default_is_legacy(source: str) -> bool:
    body = _history_function_body(source)
    if body is None:
        return False
    normalized = re.sub(r"\s+", " ", body).strip()
    return normalized == (
        'if viper.GetBool("bot.history_dual_read") { '
        "return HistoryReadModeDual } return HistoryReadModeLegacy"
    )


def _check_defaults(source: Mapping[Path, str], violations: list[str]) -> None:
    config = source.get(Path("apps/server/config/app.yml.example"), "")
    config = _mask_yaml_block_scalars(config)
    matches = list(_CONFIG_FLAG_RE.finditer(config))
    for key in (
        "expert_enabled",
        "stream_enabled",
        "a2ui_actions_enabled",
        "research_enabled",
        "design_enabled",
        "network_enabled",
    ):
        key_matches = [match for match in matches if match.group("key") == key]
        if len(key_matches) != 1 or key_matches[0].group("value") != "false":
            violations.append(f"{key} default must be false")

    user_store = source.get(Path("apps/web/src/stores/user.ts"), "")
    user_store = _mask_javascript_non_code(user_store)
    expert_matches = list(_EXPERT_DEFAULT_RE.finditer(user_store))
    if len(expert_matches) != 1 or expert_matches[0].group("value") != "false":
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
    if not _history_default_is_legacy(history_source):
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

    local_readiness = value.get("local_readiness")
    errors.extend(validate_local_readiness(local_readiness))

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
    if _has_forbidden_part(requested_root):
        return ["refusing to read out-of-scope activation root"]
    root = _resolve(requested_root)
    if root is None or _has_forbidden_part(root):
        return ["refusing to read out-of-scope activation root"]
    violations: list[str] = []
    matrix_text = _read_text(root, MATRIX_REL, violations)
    if matrix_text is None:
        return [_sanitize_failure(item) for item in violations[:MAX_FAILURE_LINES]]
    matrix_value = parse_matrix(matrix_text)
    if matrix_value is None:
        violations.append("activation matrix JSON block is missing or malformed")
    else:
        violations.extend(validate_matrix(matrix_value))

    _check_rc_web_004_local_readiness(
        root,
        matrix_value.get("local_readiness") if isinstance(matrix_value, dict) else None,
        matrix_value.get("rows") if isinstance(matrix_value, dict) else None,
        violations,
    )

    source: dict[Path, str] = {}
    for relative in DEFAULT_CHECK_FILES:
        text = _read_text(root, relative, violations)
        if text is not None:
            source[relative] = text
    format_source = _read_text(root, RESEARCH_FORMAT_SOURCE_REL, violations)
    limit_source = _read_text(root, RESEARCH_LIMIT_SOURCE_REL, violations)
    contract_source = _read_text(root, RESEARCH_CONTRACT_SOURCE_REL, violations)
    agent_canonical_source = _read_text(
        root, AGENT_CANONICAL_SOURCE_REL, violations
    )
    agent_map_source = _read_text(root, AGENT_MAP_SOURCE_REL, violations)
    upload_contract_source = _read_text(
        root, UPLOAD_CONTRACT_SOURCE_REL, violations
    )
    _check_research_input_contract(
        root,
        format_source,
        limit_source,
        contract_source,
        agent_canonical_source,
        agent_map_source,
        upload_contract_source,
        violations,
    )
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
