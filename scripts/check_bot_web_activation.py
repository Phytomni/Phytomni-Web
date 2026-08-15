#!/usr/bin/env python3
"""Check the local, fail-closed Bot/Web activation evidence matrix.

The checker is intentionally offline.  It reads one sanitized JSON block from
the versioned Web matrix, a fixed set of Web-owned default sources, and the
small RC-WEB-004 terminal fixture metadata needed for local readiness.  It does
not inspect a sibling checkout, handoff/evidence trees, or live endpoints.
"""

from __future__ import annotations

import argparse
import ast
import base64
import binascii
import hashlib
import json
import re
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, NamedTuple

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.bounded_input import (
    MAX_CONTRACT_MANIFEST_BYTES,
    InputChangedError,
    InputTooLargeError,
    RootedDirectory,
    UnsafeInputPathError,
)


ROOT = Path(__file__).resolve().parents[1]
ACTIVATION_SOURCE_BOT_COMMIT = "0ddeb22894c266b6af537ff0a1b28a42a213ae32"
RESEARCH_FIXTURE_BOT_COMMIT = "737ab4f386789cad0ea134c9248bb7c1d2cd454c"
MATRIX_REL = Path("docs/reference/bot-web-activation-matrix.md")
BOT_CONTRACT_MANIFEST_REL = Path(
    "apps/web/tests/fixtures/bot-head/contract-manifest.json"
)
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
MAX_BOT_CONTRACT_MANIFEST_BYTES = MAX_CONTRACT_MANIFEST_BYTES
MAX_BOT_SOURCE_BYTES = 512 * 1024

BOT_SOURCE_PATHS = {
    "agent_identities": "src/mcp_server_phytomni/api/app.py",
    "research_contract": ("docs/contracts/research-input-resolution/catalog.json"),
    "upload_capability": ("docs/contracts/resumable-upload/capability.json"),
    "resumable_upload_packet": ("docs/contracts/resumable-upload/manifest.json"),
}

RESEARCH_FIXTURE_SOURCE_PATHS = {
    "agent_identities": "src/mcp_server_phytomni/api/app.py",
    "agent_catalog_route": "src/mcp_server_phytomni/api/routes/agents.py",
    "agent_route_factory": "src/mcp_server_phytomni/api/factory.py",
    "agent_capability_serializer": (
        "src/mcp_server_phytomni/api/agent_capabilities.py"
    ),
    "upload_runtime": "src/mcp_server_phytomni/runtime/resumable_uploads.py",
    "upload_runtime_wrapper": "src/mcp_server_phytomni/api/upload_runtime.py",
    "advertised_protocols": (
        "src/mcp_server_phytomni/api/advertised_protocols.py"
    ),
    "conversation_context": (
        "src/mcp_server_phytomni/runtime/conversation_context/models.py"
    ),
    "api_config": "src/mcp_server_phytomni/config/models/api.py",
    "api_limits_config": "src/mcp_server_phytomni/config/api_limits.py",
    "config_defaults": "src/mcp_server_phytomni/config/defaults.py",
    "research_formats": (
        "src/mcp_server_phytomni/agents/research/scientific_formats.py"
    ),
    "research_readiness": "src/mcp_server_phytomni/api/research_input.py",
    "research_runtime_capability": (
        "src/mcp_server_phytomni/api/research_capabilities.py"
    ),
    "relay_mode": "src/mcp_server_phytomni/config/relay_mode.py",
}

_RESEARCH_RESPONSE_AST_SHA256 = (
    "c2205e1a2c54932b1dbaf002309d5276f7e93f35b2c0d071106385197d4f9e2b"
)


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


class _PinnedBotContract(NamedTuple):
    canonical_agent_tools: dict[str, str]
    research_protocol: str
    research_protocol_version: int
    research_limit_bounds: dict[str, tuple[int, int]]
    research_formats: tuple[str, ...]
    upload_protocol: str
    upload_protocol_version: int
    upload_route_family: str
    upload_routes: tuple[dict[str, str], ...]
    upload_ceiling_bytes: int


class _RuntimeUploadCapability(NamedTuple):
    protocol: str
    protocol_version: int
    descriptor: dict[str, Any]


class _BotSourceBinding(NamedTuple):
    contract: _PinnedBotContract
    fixture_sha256: str
    fixture_contract_sha256: str


class _AuthenticatedBotSources(NamedTuple):
    values: dict[str, bytes]
    digests: dict[str, str]


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
_PROTOCOL_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
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
_UNSUPPORTED_RUNTIME_NODE = object()
_RESULT_ARCHIVE_REF_RE = re.compile(r"^result-archive:sha256:[0-9a-f]{64}$")
_RESULT_ARCHIVE_DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")


def _has_forbidden_part(path: Path) -> bool:
    return any(part.casefold() in _FORBIDDEN_PARTS for part in path.parts)


def _read_bytes(
    root: RootedDirectory,
    relative: Path,
    violations: list[str],
    max_bytes: int = MAX_BOT_SOURCE_BYTES,
) -> bytes | None:
    if _has_forbidden_part(relative):
        violations.append("refusing to read out-of-scope activation path")
        return None
    try:
        return root.read_bytes(relative, max_bytes)
    except InputTooLargeError:
        violations.append("Web activation source is oversized")
    except (InputChangedError, UnsafeInputPathError):
        violations.append("refusing to read out-of-scope activation path")
    except FileNotFoundError:
        violations.append("missing Web activation source")
    except OSError:
        violations.append("cannot read Web activation source")

    return None


def _read_text(
    root: RootedDirectory,
    relative: Path,
    violations: list[str],
) -> str | None:
    raw = _read_bytes(root, relative, violations)
    if raw is None:
        return None
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        violations.append("Web activation source is not UTF-8")
        return None


def _json_object(raw: bytes) -> dict[str, Any] | None:
    def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        value: dict[str, Any] = {}
        for key, item in pairs:
            if key in value:
                raise ValueError("duplicate key")
            value[key] = item
        return value

    try:
        value = json.loads(raw, object_pairs_hook=reject_duplicate_keys)
    except (RecursionError, TypeError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def _python_assignments(source: str) -> tuple[ast.Module, dict[str, ast.expr]] | None:
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return None
    assignments: dict[str, ast.expr] = {}
    for statement in tree.body:
        name: str | None = None
        value: ast.expr | None = None
        if (
            isinstance(statement, ast.Assign)
            and len(statement.targets) == 1
            and isinstance(statement.targets[0], ast.Name)
        ):
            name = statement.targets[0].id
            value = statement.value
        elif isinstance(statement, ast.AnnAssign) and isinstance(
            statement.target, ast.Name
        ):
            name = statement.target.id
            value = statement.value
        if name is None or value is None:
            continue
        if name in assignments:
            return None
        assignments[name] = value
    return tree, assignments


def _research_response_ast_sha256(sources: Mapping[str, str]) -> str | None:
    """Seal the executable syntax of every authenticated response authority."""

    payload = bytearray()
    for role in sorted(RESEARCH_FIXTURE_SOURCE_PATHS):
        source = sources.get(role)
        if source is None:
            return None
        try:
            tree = ast.parse(source)
        except (SyntaxError, ValueError):
            return None
        payload.extend(role.encode("ascii"))
        payload.append(0)
        payload.extend(
            ast.dump(
                tree,
                annotate_fields=True,
                include_attributes=False,
            ).encode("utf-8")
        )
        payload.append(0)
    return hashlib.sha256(payload).hexdigest()


def _parse_bot_agent_tools(source: str) -> dict[str, str] | None:
    parsed = _python_assignments(source)
    if parsed is None:
        return None
    node = parsed[1].get("_AGENT_SLUG_TO_TOOL")
    if node is None:
        return None
    try:
        value = ast.literal_eval(node)
    except (TypeError, ValueError):
        return None
    if (
        not isinstance(value, dict)
        or not value
        or any(
            not isinstance(key, str) or not key or not isinstance(item, str) or not item
            for key, item in value.items()
        )
    ):
        return None
    return value


def _parse_bot_research_catalog(
    raw: bytes,
) -> tuple[str, int, dict[str, tuple[int, int]], tuple[str, ...]] | None:
    value = _json_object(raw)
    if value is None or set(value) != {
        "descriptor",
        "formats",
        "grammars",
        "limits",
        "protocol",
        "stages",
        "version",
    }:
        return None
    protocol = value.get("protocol")
    version = value.get("version")
    descriptor = value.get("descriptor")
    formats = value.get("formats")
    limits = value.get("limits")
    if (
        not isinstance(protocol, str)
        or _PROTOCOL_NAME_RE.fullmatch(protocol) is None
        or not isinstance(version, int)
        or isinstance(version, bool)
        or version < 1
        or not isinstance(descriptor, dict)
        or set(descriptor)
        != {
            "dataset_formats",
            "max_attachments_per_request",
            "max_research_dataset_paths",
            "max_research_input_references",
            "max_user_query_chars",
        }
        or not isinstance(formats, list)
        or not formats
        or len(formats) > 512
        or any(
            not isinstance(item, str) or _RESEARCH_FORMAT_RE.fullmatch(item) is None
            for item in formats
        )
        or formats != sorted(set(formats))
        or descriptor.get("dataset_formats") != formats
        or not isinstance(limits, dict)
        or set(limits)
        != {
            "combined_references",
            "document_conversion",
            "managed_references",
            "pasted_references",
            "user_query_chars",
        }
    ):
        return None
    limit_sources = {
        "max_user_query_chars": "user_query_chars",
        "max_attachments_per_request": "managed_references",
        "max_research_dataset_paths": "pasted_references",
        "max_research_input_references": "combined_references",
    }
    bounds: dict[str, tuple[int, int]] = {}
    for field, source_name in limit_sources.items():
        source = limits.get(source_name)
        if not isinstance(source, dict) or set(source) != {"default", "hard"}:
            return None
        default = source.get("default")
        hard = source.get("hard")
        if (
            not isinstance(default, int)
            or isinstance(default, bool)
            or not isinstance(hard, int)
            or isinstance(hard, bool)
            or default < 1
            or hard < default
            or descriptor.get(field) != default
        ):
            return None
        bounds[field] = (default, hard)
    document_limits = limits.get("document_conversion")
    if (
        not isinstance(document_limits, dict)
        or set(document_limits) != {"max_file_bytes", "max_total_bytes"}
        or any(
            not isinstance(item, int) or isinstance(item, bool) or item < 1
            for item in document_limits.values()
        )
    ):
        return None
    return protocol, version, bounds, tuple(formats)


def _parse_bot_upload_capability(
    raw: bytes,
) -> tuple[str, tuple[dict[str, str], ...], int] | None:
    value = _json_object(raw)
    if value is None or set(value) != {"route_family", "routes", "limits"}:
        return None
    routes = value.get("routes")
    limits = value.get("limits")
    if (
        not isinstance(value.get("route_family"), str)
        or re.fullmatch(r"[a-z][a-z0-9_]{0,63}", value["route_family"]) is None
        or not isinstance(routes, list)
        or not routes
        or len(routes) > 16
        or any(
            not isinstance(route, dict)
            or set(route) != {"method", "path", "plane", "auth"}
            or any(not isinstance(item, str) or not item for item in route.values())
            or re.fullmatch(r"[A-Z]{3,8}", route["method"]) is None
            or not route["path"].startswith("/")
            or len(route["path"]) > 256
            or re.fullmatch(r"[a-z][a-z0-9_]{0,63}", route["plane"]) is None
            or re.fullmatch(r"[a-z][a-z0-9_]{0,63}", route["auth"]) is None
            for route in routes
        )
        or not isinstance(limits, dict)
        or set(limits)
        != {
            "max_file_bytes",
            "part_size_bytes",
            "max_parallel_parts",
            "max_active_assets",
            "capability_ttl_seconds",
            "session_ttl_seconds",
        }
        or any(
            not isinstance(item, int) or isinstance(item, bool) or item < 1
            for item in limits.values()
        )
    ):
        return None
    route_pairs = [(route["method"], route["path"]) for route in routes]
    if len(route_pairs) != len(set(route_pairs)):
        return None
    return value["route_family"], tuple(routes), limits["max_file_bytes"]


def _pinned_bot_contract_value(contract: _PinnedBotContract) -> dict[str, Any]:
    return {
        "canonical_agent_tools": contract.canonical_agent_tools,
        "research_input": {
            "protocol": contract.research_protocol,
            "protocol_version": contract.research_protocol_version,
            "limits": {
                field: {"default": bounds[0], "hard": bounds[1]}
                for field, bounds in contract.research_limit_bounds.items()
            },
            "formats": list(contract.research_formats),
        },
        "resumable_upload": {
            "protocol": contract.upload_protocol,
            "protocol_version": contract.upload_protocol_version,
            "route_family": contract.upload_route_family,
            "routes": list(contract.upload_routes),
            "max_file_bytes": contract.upload_ceiling_bytes,
        },
    }


def _parse_pinned_bot_contract(
    sources: Mapping[str, bytes],
) -> _PinnedBotContract | None:
    try:
        agent_source = sources["agent_identities"].decode("utf-8")
    except UnicodeDecodeError:
        return None
    except KeyError:
        return None
    agent_tools = _parse_bot_agent_tools(agent_source)
    research = _parse_bot_research_catalog(sources.get("research_contract", b""))
    upload_ceiling = _parse_bot_upload_capability(sources.get("upload_capability", b""))
    packet = _json_object(sources.get("resumable_upload_packet", b""))
    protocol = packet.get("protocol") if packet is not None else None
    files = packet.get("files") if packet is not None else None
    version_match = (
        re.search(r"-v(?P<version>[1-9][0-9]*)$", protocol)
        if isinstance(protocol, str)
        else None
    )
    if (
        agent_tools is None
        or research is None
        or upload_ceiling is None
        or not isinstance(files, dict)
        or files.get("capability.json")
        != hashlib.sha256(sources.get("upload_capability", b"")).hexdigest()
        or version_match is None
    ):
        return None
    assert agent_tools is not None
    assert research is not None
    assert isinstance(protocol, str)
    assert version_match is not None
    return _PinnedBotContract(
        canonical_agent_tools=agent_tools,
        research_protocol=research[0],
        research_protocol_version=research[1],
        research_limit_bounds=research[2],
        research_formats=research[3],
        upload_protocol=protocol,
        upload_protocol_version=int(version_match.group("version")),
        upload_route_family=upload_ceiling[0],
        upload_routes=upload_ceiling[1],
        upload_ceiling_bytes=upload_ceiling[2],
    )


def _canonical_json_sha256(value: object) -> str:
    payload = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _expected_fixture_contract(contract: _PinnedBotContract) -> dict[str, Any]:
    return {
        "canonical_agent_tools": contract.canonical_agent_tools,
        "protocols": {
            contract.research_protocol: [contract.research_protocol_version],
            contract.upload_protocol: [contract.upload_protocol_version],
        },
        "research_input_resolution": {
            **{
                field: bounds[0]
                for field, bounds in contract.research_limit_bounds.items()
            },
            "dataset_formats": list(contract.research_formats),
        },
        "research_agent_dataset_formats": list(contract.research_formats),
        "upload_capability": {
            "route_family": contract.upload_route_family,
            "routes": list(contract.upload_routes),
            "max_file_bytes": contract.upload_ceiling_bytes,
        },
    }


def _parse_fixture_agent_metadata(
    source: str,
) -> tuple[dict[str, str], frozenset[str], dict[str, list[str]]] | None:
    parsed = _python_assignments(source)
    if parsed is None:
        return None
    assignments = parsed[1]
    tools = _parse_bot_agent_tools(source)
    aliases_node = assignments.get("_LEGACY_ALIASES")
    remote_node = assignments.get("_REMOTE_AGENT_SLUGS")
    if tools is None or aliases_node is None or remote_node is None:
        return None
    try:
        aliases = ast.literal_eval(aliases_node)
    except (TypeError, ValueError):
        return None
    if not (
        isinstance(remote_node, ast.Call)
        and isinstance(remote_node.func, ast.Name)
        and remote_node.func.id == "frozenset"
        and len(remote_node.args) == 1
        and not remote_node.keywords
    ):
        return None
    try:
        remote_slugs = ast.literal_eval(remote_node.args[0])
    except (TypeError, ValueError):
        return None
    if (
        not isinstance(aliases, dict)
        or set(aliases) != set(tools.values())
        or any(
            not isinstance(tool, str)
            or not isinstance(values, list)
            or any(not isinstance(value, str) or not value for value in values)
            or len(values) != len(set(values))
            for tool, values in aliases.items()
        )
        or not isinstance(remote_slugs, set)
        or any(not isinstance(slug, str) for slug in remote_slugs)
        or not remote_slugs.issubset(tools)
        or len(tools.values()) != len(set(tools.values()))
    ):
        return None
    return tools, frozenset(remote_slugs), aliases


def _dict_string_keys(node: ast.expr) -> tuple[str, ...] | None:
    if not isinstance(node, ast.Dict) or any(key is None for key in node.keys):
        return None
    keys: list[str] = []
    for key in node.keys:
        if not isinstance(key, ast.Constant) or not isinstance(key.value, str):
            return None
        keys.append(key.value)
    return tuple(keys) if len(keys) == len(set(keys)) else None


def _has_python_import(
    tree: ast.Module,
    *,
    module: str,
    level: int,
    names: frozenset[str],
) -> bool:
    imported = {
        alias.name
        for statement in tree.body
        if isinstance(statement, ast.ImportFrom)
        and statement.module == module
        and statement.level == level
        for alias in statement.names
    }
    return names.issubset(imported)


def _integer_expression(
    node: ast.expr,
    assignments: Mapping[str, ast.expr],
    seen: frozenset[str] = frozenset(),
) -> int | None:
    limit = 2**63
    if (
        isinstance(node, ast.Constant)
        and isinstance(node.value, int)
        and not isinstance(node.value, bool)
    ):
        return node.value if abs(node.value) <= limit else None
    if isinstance(node, ast.Name):
        if node.id in seen or node.id not in assignments:
            return None
        return _integer_expression(
            assignments[node.id], assignments, seen | {node.id}
        )
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
        operand = _integer_expression(node.operand, assignments, seen)
        if operand is None:
            return None
        result = operand if isinstance(node.op, ast.UAdd) else -operand
        return result if abs(result) <= limit else None
    if not isinstance(node, ast.BinOp):
        return None
    left = _integer_expression(node.left, assignments, seen)
    right = _integer_expression(node.right, assignments, seen)
    if left is None or right is None:
        return None
    if isinstance(node.op, ast.Add):
        result = left + right
    elif isinstance(node.op, ast.Sub):
        result = left - right
    elif isinstance(node.op, ast.Mult):
        result = left * right
    elif isinstance(node.op, ast.Pow) and 0 <= right <= 12:
        result = left**right
    else:
        return None
    return result if abs(result) <= limit else None


def _class_assignments(
    source: str,
    class_name: str,
) -> tuple[ast.Module, dict[str, ast.expr]] | None:
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return None
    classes = [
        node
        for node in tree.body
        if isinstance(node, ast.ClassDef) and node.name == class_name
    ]
    if len(classes) != 1:
        return None
    assignments: dict[str, ast.expr] = {}
    for statement in classes[0].body:
        if not (
            isinstance(statement, ast.AnnAssign)
            and isinstance(statement.target, ast.Name)
            and statement.value is not None
        ):
            continue
        name = statement.target.id
        if name in assignments:
            return None
        assignments[name] = statement.value
    return tree, assignments


def _field_default_expression(node: ast.expr) -> ast.expr | None:
    if not (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "Field"
        and not node.args
    ):
        return None
    defaults = [keyword.value for keyword in node.keywords if keyword.arg == "default"]
    return defaults[0] if len(defaults) == 1 else None


def _parse_api_upload_defaults(source: str) -> dict[str, int] | None:
    parsed = _class_assignments(source, "ApiConfig")
    if parsed is None:
        return None
    _, assignments = parsed
    module_assignments = _python_assignments(source)
    if module_assignments is None:
        return None
    fields = {
        "max_file_bytes": "API_UPLOAD_V2_MAX_BYTES",
        "part_size_bytes": "API_UPLOAD_V2_PART_SIZE_BYTES",
        "max_parallel_parts": "API_UPLOAD_V2_MAX_PARALLEL_PARTS",
        "capability_ttl_seconds": "API_UPLOAD_V2_CAPABILITY_TTL_SECONDS",
        "session_ttl_seconds": "API_UPLOAD_V2_SESSION_TTL_SECONDS",
    }
    values: dict[str, int] = {}
    for output_name, config_name in fields.items():
        node = assignments.get(config_name)
        default = _field_default_expression(node) if node is not None else None
        value = (
            _integer_expression(default, module_assignments[1])
            if default is not None
            else None
        )
        if value is None or value < 1:
            return None
        values[output_name] = value
    return values


def _parse_api_research_defaults(source: str) -> dict[str, int] | None:
    parsed = _class_assignments(source, "ApiLimitsConfig")
    module = _python_assignments(source)
    if parsed is None or module is None:
        return None
    fields = {
        "max_user_query_chars": "API_MAX_USER_QUERY_CHARS",
        "max_attachments_per_request": "API_MAX_ATTACHMENTS_PER_REQUEST",
        "max_research_dataset_paths": "API_MAX_RESEARCH_DATASET_PATHS",
        "max_research_input_references": "API_MAX_RESEARCH_INPUT_REFERENCES",
    }
    values: dict[str, int] = {}
    for output_name, config_name in fields.items():
        node = parsed[1].get(config_name)
        if not (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "_api_bounded_int"
            and len(node.args) == 1
        ):
            return None
        value = _integer_expression(node.args[0], module[1])
        if value is None or value < 1:
            return None
        values[output_name] = value
    return values


def _parse_upload_runtime_wrapper(source: str) -> dict[str, str] | None:
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return None
    classes = [
        node
        for node in tree.body
        if isinstance(node, ast.ClassDef) and node.name == "UploadRuntime"
    ]
    if len(classes) != 1:
        return None
    methods = [
        node
        for node in classes[0].body
        if isinstance(node, ast.FunctionDef)
        and node.name == "serialize_file_upload_capability"
    ]
    if len(methods) != 1:
        return None
    returns = [
        statement
        for statement in methods[0].body
        if isinstance(statement, ast.Return)
    ]
    if len(returns) != 1:
        return None
    call = returns[0].value
    if not (
        isinstance(call, ast.Call)
        and isinstance(call.func, ast.Name)
        and call.func.id == "_serialize_file_upload_capability"
        and len(call.args) == 1
        and not call.keywords
        and isinstance(call.args[0], ast.Dict)
    ):
        return None
    keys = _dict_string_keys(call.args[0])
    if keys is None:
        return None
    mapping: dict[str, str] = {}
    for key, value in zip(keys, call.args[0].values, strict=True):
        if not (
            isinstance(value, ast.Attribute)
            and isinstance(value.value, ast.Name)
            and value.value.id == "config"
        ):
            return None
        mapping[key] = value.attr
    expected = {
        "max_file_bytes": "API_UPLOAD_V2_MAX_BYTES",
        "part_size_bytes": "API_UPLOAD_V2_PART_SIZE_BYTES",
        "max_parallel_parts": "API_UPLOAD_V2_MAX_PARALLEL_PARTS",
        "capability_ttl_seconds": "API_UPLOAD_V2_CAPABILITY_TTL_SECONDS",
        "session_ttl_seconds": "API_UPLOAD_V2_SESSION_TTL_SECONDS",
    }
    return mapping if mapping == expected else None


def _timedelta_seconds(
    node: ast.expr,
    assignments: Mapping[str, ast.expr],
) -> int | None:
    if isinstance(node, ast.Name):
        target = assignments.get(node.id)
        return (
            _timedelta_seconds(target, assignments)
            if target is not None
            else None
        )
    if not (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "timedelta"
        and not node.args
        and all(keyword.arg is not None for keyword in node.keywords)
    ):
        return None
    keyword_names = [keyword.arg for keyword in node.keywords]
    if len(keyword_names) != len(set(keyword_names)) or any(
        name
        not in {
            "weeks",
            "days",
            "hours",
            "minutes",
            "seconds",
            "milliseconds",
            "microseconds",
        }
        for name in keyword_names
    ):
        return None
    total_microseconds = 0
    for keyword in node.keywords:
        assert keyword.arg is not None
        value = _integer_expression(keyword.value, assignments)
        if value is None:
            return None
        if keyword.arg == "weeks":
            total_microseconds += value * 7 * 24 * 60 * 60 * 1_000_000
        elif keyword.arg == "days":
            total_microseconds += value * 24 * 60 * 60 * 1_000_000
        elif keyword.arg == "hours":
            total_microseconds += value * 60 * 60 * 1_000_000
        elif keyword.arg == "minutes":
            total_microseconds += value * 60 * 1_000_000
        elif keyword.arg == "seconds":
            total_microseconds += value * 1_000_000
        elif keyword.arg == "milliseconds":
            total_microseconds += value * 1_000
        else:
            total_microseconds += value
    if total_microseconds <= 0 or total_microseconds % 1_000_000 != 0:
        return None
    return total_microseconds // 1_000_000


def _upload_limit_value(
    node: ast.expr,
    assignments: Mapping[str, ast.expr],
) -> int | None:
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "int"
        and len(node.args) == 1
        and not node.keywords
    ):
        return _upload_limit_value(node.args[0], assignments)
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "total_seconds"
        and not node.args
        and not node.keywords
    ):
        return _timedelta_seconds(node.func.value, assignments)
    return _integer_expression(node, assignments)


def _parse_runtime_upload_capability(
    serializer_source: str,
    runtime_source: str,
    wrapper_source: str,
    api_config_source: str,
) -> _RuntimeUploadCapability | None:
    serializer = _python_assignments(serializer_source)
    runtime = _python_assignments(runtime_source)
    configured_limits = _parse_api_upload_defaults(api_config_source)
    wrapper_fields = _parse_upload_runtime_wrapper(wrapper_source)
    if (
        serializer is None
        or runtime is None
        or configured_limits is None
        or wrapper_fields is None
    ):
        return None
    serializer_tree, serializer_assignments = serializer
    runtime_tree, runtime_assignments = runtime
    runtime_names = frozenset(
        {
            "CAPABILITY_TTL",
            "MAX_ACTIVE_ASSETS",
            "MAX_UPLOAD_BYTES",
            "PART_SIZE_BYTES",
            "SESSION_TTL",
        }
    )
    if not _has_python_import(
        serializer_tree,
        module="runtime.resumable_uploads",
        level=2,
        names=runtime_names,
    ) or not _has_python_import(
        runtime_tree,
        module="datetime",
        level=0,
        names=frozenset({"timedelta"}),
    ):
        return None
    functions = [
        node
        for node in serializer_tree.body
        if isinstance(node, ast.FunctionDef)
        and node.name == "serialize_file_upload_capability"
    ]
    if len(functions) != 1:
        return None
    function = functions[0]
    arguments = function.args
    if not (
        not arguments.posonlyargs
        and [argument.arg for argument in arguments.args] == ["limits"]
        and len(arguments.defaults) == 1
        and isinstance(arguments.defaults[0], ast.Constant)
        and arguments.defaults[0].value is None
        and arguments.vararg is None
        and not arguments.kwonlyargs
        and arguments.kwarg is None
    ):
        return None
    resolved_assignments = [
        statement.value
        for statement in function.body
        if isinstance(statement, ast.Assign)
        and len(statement.targets) == 1
        and isinstance(statement.targets[0], ast.Name)
        and statement.targets[0].id == "resolved"
    ]
    returns = [
        node for node in ast.walk(function) if isinstance(node, ast.Return)
    ]
    if len(resolved_assignments) != 1 or len(returns) != 1:
        return None
    resolved_node = resolved_assignments[0]
    limit_fields = _dict_string_keys(resolved_node)
    expected_limit_fields = (
        "max_file_bytes",
        "part_size_bytes",
        "max_parallel_parts",
        "max_active_assets",
        "capability_ttl_seconds",
        "session_ttl_seconds",
    )
    if not isinstance(resolved_node, ast.Dict) or limit_fields != expected_limit_fields:
        return None
    assignments = {**runtime_assignments, **serializer_assignments}
    limits: dict[str, int] = {}
    for field, value_node in zip(
        limit_fields, resolved_node.values, strict=True
    ):
        value = _upload_limit_value(value_node, assignments)
        if value is None or value < 1:
            return None
        limits[field] = value
    limits.update(configured_limits)

    return_node = returns[0].value
    return_fields = _dict_string_keys(return_node) if return_node is not None else None
    if not isinstance(return_node, ast.Dict) or return_fields != (
        "route_family",
        "routes",
        "limits",
    ):
        return None
    return_values = dict(zip(return_fields, return_node.values, strict=True))
    route_family_node = return_values["route_family"]
    routes_node = return_values["routes"]
    limits_node = return_values["limits"]
    route_family = (
        route_family_node.value
        if isinstance(route_family_node, ast.Constant)
        and isinstance(route_family_node.value, str)
        else None
    )
    if not (
        isinstance(routes_node, ast.ListComp)
        and isinstance(routes_node.elt, ast.Call)
        and isinstance(routes_node.elt.func, ast.Name)
        and routes_node.elt.func.id == "dict"
        and len(routes_node.elt.args) == 1
        and isinstance(routes_node.elt.args[0], ast.Name)
        and routes_node.elt.args[0].id == "route"
        and not routes_node.elt.keywords
        and len(routes_node.generators) == 1
        and isinstance(routes_node.generators[0].target, ast.Name)
        and routes_node.generators[0].target.id == "route"
        and isinstance(routes_node.generators[0].iter, ast.Name)
        and routes_node.generators[0].iter.id == "_UPLOAD_ROUTES"
        and not routes_node.generators[0].ifs
        and not routes_node.generators[0].is_async
        and isinstance(limits_node, ast.Name)
        and limits_node.id == "resolved"
    ):
        return None
    routes_assignment = serializer_assignments.get("_UPLOAD_ROUTES")
    try:
        routes = (
            ast.literal_eval(routes_assignment)
            if routes_assignment is not None
            else None
        )
    except (TypeError, ValueError):
        return None
    if not isinstance(routes, tuple):
        return None
    descriptor = {
        "route_family": route_family,
        "routes": list(routes),
        "limits": limits,
    }
    parsed_descriptor = _parse_bot_upload_capability(
        json.dumps(descriptor, separators=(",", ":")).encode("utf-8")
    )
    protocol_node = runtime_assignments.get("UPLOAD_PROTOCOL")
    version_node = runtime_assignments.get("UPLOAD_PROTOCOL_VERSION")
    try:
        protocol = (
            ast.literal_eval(protocol_node) if protocol_node is not None else None
        )
    except (TypeError, ValueError):
        return None
    version = (
        _integer_expression(version_node, runtime_assignments)
        if version_node is not None
        else None
    )
    if (
        parsed_descriptor is None
        or parsed_descriptor[2] != limits["max_file_bytes"]
        or not isinstance(protocol, str)
        or _PROTOCOL_NAME_RE.fullmatch(protocol) is None
        or version is None
        or version < 1
    ):
        return None
    return _RuntimeUploadCapability(
        protocol=protocol,
        protocol_version=version,
        descriptor=descriptor,
    )


def _parse_agent_catalog_shape(
    source: str,
) -> tuple[tuple[str, ...], tuple[str, ...]] | None:
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return None
    functions = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "list_agents"
    ]
    if len(functions) != 1:
        return None
    function = functions[0]
    route_decorators = [
        decorator
        for decorator in function.decorator_list
        if isinstance(decorator, ast.Call)
        and isinstance(decorator.func, ast.Attribute)
        and decorator.func.attr == "get"
        and len(decorator.args) == 1
        and isinstance(decorator.args[0], ast.Constant)
        and decorator.args[0].value == "/v1/agents"
    ]
    payload_assignments = [
        statement
        for statement in function.body
        if isinstance(statement, ast.AnnAssign)
        and isinstance(statement.target, ast.Name)
        and statement.target.id == "payload"
    ]
    if len(route_decorators) != 1 or len(payload_assignments) != 1:
        return None
    payload_node = payload_assignments[0].value
    top_fields = _dict_string_keys(payload_node) if payload_node is not None else None
    if not isinstance(payload_node, ast.Dict) or top_fields is None:
        return None
    direct_returns = [
        statement.value
        for statement in function.body
        if isinstance(statement, ast.Return)
    ]
    if not (
        len(direct_returns) == 1
        and isinstance(direct_returns[0], ast.Call)
        and isinstance(direct_returns[0].func, ast.Name)
        and direct_returns[0].func.id == "JSONResponse"
        and len(direct_returns[0].args) == 1
        and isinstance(direct_returns[0].args[0], ast.Name)
        and direct_returns[0].args[0].id == "payload"
        and not direct_returns[0].keywords
    ):
        return None
    field_values = dict(zip(top_fields, payload_node.values, strict=True))
    data_node = field_values.get("data")
    row_fields = (
        _dict_string_keys(data_node.elt)
        if isinstance(data_node, ast.ListComp)
        else None
    )
    appended: list[tuple[int, str]] = []
    for node in ast.walk(function):
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        if not (
            isinstance(target, ast.Subscript)
            and isinstance(target.value, ast.Name)
            and target.value.id == "payload"
            and isinstance(target.slice, ast.Constant)
            and isinstance(target.slice.value, str)
        ):
            continue
        appended.append((node.lineno, target.slice.value))
    appended_fields = tuple(value for _, value in sorted(appended))
    if (
        top_fields != ("object", "file_upload", "data")
        or appended_fields != ("protocols", "research_input_resolution")
        or row_fields
        != ("slug", "tool", "origin", "legacy_aliases", "capabilities")
    ):
        return None
    return top_fields + appended_fields, row_fields


def _parse_research_descriptor_fields(source: str) -> tuple[str, ...] | None:
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return None
    classes = [
        node
        for node in tree.body
        if isinstance(node, ast.ClassDef)
        and node.name == "ResearchInputResolutionDescriptor"
    ]
    if len(classes) != 1:
        return None
    fields = tuple(
        statement.target.id
        for statement in classes[0].body
        if isinstance(statement, ast.AnnAssign)
        and isinstance(statement.target, ast.Name)
    )
    expected = (
        "max_user_query_chars",
        "max_attachments_per_request",
        "max_research_dataset_paths",
        "max_research_input_references",
        "dataset_formats",
    )
    return fields if fields == expected else None


def _parse_runtime_research_formats(source: str) -> tuple[str, ...] | None:
    parsed = _python_assignments(source)
    if parsed is None:
        return None
    expression = parsed[1].get("_SCIENTIFIC_FORMATS")

    def suffixes(node: ast.expr) -> tuple[str, ...] | None:
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            left = suffixes(node.left)
            right = suffixes(node.right)
            return None if left is None or right is None else left + right
        if not (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "_formats"
            and len(node.args) == 3
            and isinstance(node.args[0], ast.Tuple)
            and all(
                isinstance(item, ast.Constant)
                and isinstance(item.value, str)
                and item.value.startswith(".")
                for item in node.args[0].elts
            )
            and all(
                isinstance(item, ast.Constant) and isinstance(item.value, str)
                for item in node.args[1:]
            )
            and all(
                keyword.arg == "archive"
                and isinstance(keyword.value, ast.Constant)
                and keyword.value.value is True
                for keyword in node.keywords
            )
            and len(node.keywords) <= 1
        ):
            return None
        return tuple(item.value for item in node.args[0].elts)

    values = suffixes(expression) if expression is not None else None
    if values is None or not values or len(values) != len(set(values)):
        return None
    advertised = tuple(sorted(value.removeprefix(".") for value in values))
    return advertised if all(advertised) else None


def _parse_runtime_agent_capabilities(
    source: str,
    research_formats: tuple[str, ...],
    research_defaults: Mapping[str, int],
) -> dict[str, dict[str, Any]] | None:
    parsed = _python_assignments(source)
    if parsed is None:
        return None
    assignments = parsed[1]
    limits: dict[str, int] = {}
    for name in ("MAX_FILE_BYTES", "MAX_FILES", "MAX_TOTAL_BYTES"):
        node = assignments.get(name)
        value = (
            _integer_expression(node, assignments) if node is not None else None
        )
        if value is None or value < 1:
            return None
        limits[name] = value

    def document(max_files: int) -> dict[str, Any]:
        return {
            "argument": "obs_file_list",
            "max_file_bytes": limits["MAX_FILE_BYTES"],
            "max_files": max_files,
            "max_total_bytes": limits["MAX_TOTAL_BYTES"],
        }

    def dataset(max_files: int, *, research: bool) -> dict[str, Any]:
        value: dict[str, Any] = {
            "argument": "data_list",
            "max_file_bytes": limits["MAX_FILE_BYTES"],
            "max_files": max_files,
            "max_total_bytes": limits["MAX_TOTAL_BYTES"],
        }
        if research:
            value["formats"] = list(research_formats)
        return value

    def channel(node: ast.expr, slug: str) -> dict[str, Any] | None | object:
        if isinstance(node, ast.Constant) and node.value is None:
            return None
        if not isinstance(node, ast.Name):
            return _UNSUPPORTED_RUNTIME_NODE
        if node.id == "_DOCUMENTS":
            max_files = (
                research_defaults["max_attachments_per_request"]
                if slug == "research"
                else limits["MAX_FILES"]
            )
            return document(max_files)
        if node.id == "_DATASETS" and slug != "research":
            return dataset(limits["MAX_FILES"], research=False)
        if node.id == "_RESEARCH_DATASETS" and slug == "research":
            return dataset(
                min(
                    research_defaults["max_attachments_per_request"],
                    research_defaults["max_research_dataset_paths"],
                ),
                research=True,
            )
        return _UNSUPPORTED_RUNTIME_NODE

    def attachments(node: ast.expr, slug: str) -> dict[str, Any] | None:
        if not (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "AttachmentCapability"
            and len(node.args) == 3
            and not node.keywords
            and isinstance(node.args[2], ast.Constant)
            and isinstance(node.args[2].value, bool)
        ):
            return None
        documents = channel(node.args[0], slug)
        datasets = channel(node.args[1], slug)
        if (
            documents is _UNSUPPORTED_RUNTIME_NODE
            or datasets is _UNSUPPORTED_RUNTIME_NODE
        ):
            return None
        return {
            "document_context": documents,
            "datasets": datasets,
            "expert_forwarding": node.args[2].value,
        }

    def capability(node: ast.expr, slug: str) -> dict[str, Any] | None:
        if not (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "AgentCapability"
            and not node.args
            and all(keyword.arg is not None for keyword in node.keywords)
        ):
            return None
        keywords = {keyword.arg: keyword.value for keyword in node.keywords}
        allowed = {
            "streaming",
            "interactive",
            "report_states",
            "artifacts",
            "degraded_outcomes",
            "attachments",
        }
        if len(keywords) != len(node.keywords) or set(keywords) - allowed:
            return None
        result: dict[str, Any] = {
            "streaming": False,
            "interactive": False,
            "report_states": [],
            "artifacts": False,
            "degraded_outcomes": False,
            "attachments": {
                "document_context": None,
                "datasets": None,
                "expert_forwarding": False,
            },
        }
        for field in (
            "streaming",
            "interactive",
            "artifacts",
            "degraded_outcomes",
        ):
            value_node = keywords.get(field)
            if value_node is None:
                continue
            if not (
                isinstance(value_node, ast.Constant)
                and isinstance(value_node.value, bool)
            ):
                return None
            result[field] = value_node.value
        report_node = keywords.get("report_states")
        if report_node is not None:
            try:
                reports = ast.literal_eval(report_node)
            except (TypeError, ValueError):
                return None
            if not (
                isinstance(reports, tuple)
                and all(isinstance(item, str) and item for item in reports)
            ):
                return None
            result["report_states"] = list(reports)
        attachment_node = keywords.get("attachments")
        if attachment_node is not None:
            serialized = attachments(attachment_node, slug)
            if serialized is None:
                return None
            result["attachments"] = serialized
        return result

    capabilities_node = assignments.get("_CAPABILITIES")
    keys = (
        _dict_string_keys(capabilities_node)
        if isinstance(capabilities_node, ast.Dict)
        else None
    )
    if keys is None or not isinstance(capabilities_node, ast.Dict):
        return None
    result: dict[str, dict[str, Any]] = {}
    for slug, node in zip(keys, capabilities_node.values, strict=True):
        serialized = capability(node, slug)
        if serialized is None:
            return None
        result[slug] = serialized
    return result


def _parse_fixture_protocols(
    advertised_source: str,
    conversation_source: str,
    upload_protocol: str,
    upload_version: int,
    research_protocol: str,
    research_version: int,
) -> dict[str, list[int]] | None:
    advertised = _python_assignments(advertised_source)
    conversation = _python_assignments(conversation_source)
    if advertised is None or conversation is None:
        return None
    if not _has_python_import(
        advertised[0],
        module="runtime.resumable_uploads",
        level=2,
        names=frozenset({"UPLOAD_PROTOCOL", "UPLOAD_PROTOCOL_VERSION"}),
    ):
        return None
    upload_predicates = [
        node
        for node in advertised[0].body
        if isinstance(node, ast.FunctionDef) and node.name == "_upload_enabled"
    ]
    if not (
        len(upload_predicates) == 1
        and len(upload_predicates[0].body) == 2
        and isinstance(upload_predicates[0].body[-1], ast.Return)
        and isinstance(upload_predicates[0].body[-1].value, ast.Constant)
        and upload_predicates[0].body[-1].value.value is True
    ):
        return None
    names = {
        "RESULT_ARCHIVE_PROTOCOL",
        "RESULT_ARCHIVE_PROTOCOL_VERSION",
        "RESEARCH_INPUT_PROTOCOL",
        "RESEARCH_INPUT_PROTOCOL_VERSION",
    }
    values: dict[str, str | int] = {
        "UPLOAD_PROTOCOL": upload_protocol,
        "UPLOAD_PROTOCOL_VERSION": upload_version,
    }
    for name in names:
        node = advertised[1].get(name)
        try:
            value = ast.literal_eval(node) if node is not None else None
        except (TypeError, ValueError):
            return None
        if not isinstance(value, (str, int)) or isinstance(value, bool):
            return None
        values[name] = value
    conversation_node = conversation[1].get(
        "CONVERSATION_CONTEXT_PROTOCOL_VERSION"
    )
    try:
        conversation_version = (
            ast.literal_eval(conversation_node)
            if conversation_node is not None
            else None
        )
    except (TypeError, ValueError):
        return None
    if not isinstance(conversation_version, int) or isinstance(
        conversation_version, bool
    ):
        return None
    values["CONVERSATION_CONTEXT_PROTOCOL_VERSION"] = conversation_version

    functions = [
        node
        for node in advertised[0].body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name == "advertised_protocols"
    ]
    if len(functions) != 1:
        return None
    calls = sorted(
        (
            node
            for node in ast.walk(functions[0])
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "AdvertisedProtocol"
        ),
        key=lambda node: (node.lineno, node.col_offset),
    )
    protocols: dict[str, list[int]] = {}
    for call in calls:
        keywords = {keyword.arg: keyword.value for keyword in call.keywords}
        name_node = keywords.get("name")
        version_node = keywords.get("version")
        name = (
            name_node.value
            if isinstance(name_node, ast.Constant)
            and isinstance(name_node.value, str)
            else values.get(name_node.id)
            if isinstance(name_node, ast.Name)
            else None
        )
        version = (
            version_node.value
            if isinstance(version_node, ast.Constant)
            and isinstance(version_node.value, int)
            and not isinstance(version_node.value, bool)
            else values.get(version_node.id)
            if isinstance(version_node, ast.Name)
            else None
        )
        if (
            not isinstance(name, str)
            or not isinstance(version, int)
            or isinstance(version, bool)
            or name in protocols
        ):
            return None
        protocols[name] = [version]
    if (
        values.get("RESEARCH_INPUT_PROTOCOL") != research_protocol
        or values.get("RESEARCH_INPUT_PROTOCOL_VERSION") != research_version
        or len(protocols) != 4
    ):
        return None
    return protocols


def _research_fixture_bytes(sources: Mapping[str, bytes]) -> bytes | None:
    decoded: dict[str, str] = {}
    try:
        for role in RESEARCH_FIXTURE_SOURCE_PATHS:
            decoded[role] = sources[role].decode("utf-8")
    except (KeyError, UnicodeDecodeError):
        return None
    if (
        _research_response_ast_sha256(decoded)
        != _RESEARCH_RESPONSE_AST_SHA256
    ):
        return None
    metadata = _parse_fixture_agent_metadata(decoded["agent_identities"])
    shape = _parse_agent_catalog_shape(decoded["agent_catalog_route"])
    descriptor_fields = _parse_research_descriptor_fields(
        decoded["agent_capability_serializer"]
    )
    research_defaults = _parse_api_research_defaults(
        decoded["api_limits_config"]
    )
    research_formats = _parse_runtime_research_formats(
        decoded["research_formats"]
    )
    capabilities = (
        _parse_runtime_agent_capabilities(
            decoded["agent_capability_serializer"],
            research_formats,
            research_defaults,
        )
        if research_formats is not None and research_defaults is not None
        else None
    )
    upload = _parse_runtime_upload_capability(
        decoded["agent_capability_serializer"],
        decoded["upload_runtime"],
        decoded["upload_runtime_wrapper"],
        decoded["api_config"],
    )
    protocol_source = _python_assignments(decoded["advertised_protocols"])
    protocol_values: dict[str, str | int] = {}
    if protocol_source is not None:
        for name in (
            "RESEARCH_INPUT_PROTOCOL",
            "RESEARCH_INPUT_PROTOCOL_VERSION",
        ):
            node = protocol_source[1].get(name)
            try:
                value = ast.literal_eval(node) if node is not None else None
            except (TypeError, ValueError):
                value = None
            if isinstance(value, (str, int)) and not isinstance(value, bool):
                protocol_values[name] = value
    research_protocol = protocol_values.get("RESEARCH_INPUT_PROTOCOL")
    research_version = protocol_values.get("RESEARCH_INPUT_PROTOCOL_VERSION")
    if (
        metadata is None
        or shape is None
        or descriptor_fields is None
        or capabilities is None
        or research_defaults is None
        or research_formats is None
        or upload is None
        or not isinstance(research_protocol, str)
        or not isinstance(research_version, int)
    ):
        return None
    tools, remote_slugs, aliases = metadata
    top_fields, row_fields = shape
    if (
        set(capabilities) != set(tools)
        or any(not isinstance(value, dict) for value in capabilities.values())
        or set(research_defaults) != set(descriptor_fields) - {"dataset_formats"}
    ):
        return None
    protocols = _parse_fixture_protocols(
        decoded["advertised_protocols"],
        decoded["conversation_context"],
        upload.protocol,
        upload.protocol_version,
        research_protocol,
        research_version,
    )
    if protocols is None:
        return None
    rows: list[dict[str, Any]] = []
    for slug, tool in tools.items():
        values = {
            "slug": slug,
            "tool": tool,
            "origin": "remote" if slug in remote_slugs else "local",
            "legacy_aliases": aliases[tool],
            "capabilities": capabilities[slug],
        }
        rows.append({field: values[field] for field in row_fields})
    values = {
        "object": "list",
        "file_upload": upload.descriptor,
        "data": rows,
        "protocols": protocols,
        "research_input_resolution": {
            **research_defaults,
            "dataset_formats": list(research_formats),
        },
    }
    payload = {field: values[field] for field in top_fields}
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode(
        "utf-8"
    )
    return raw if len(raw) <= MAX_RESEARCH_INPUT_FIXTURE_BYTES else None


def _fixture_contract_value(
    value: Mapping[str, Any], contract: _PinnedBotContract
) -> dict[str, Any] | None:
    data = value.get("data")
    if not isinstance(data, list):
        return None
    tools: dict[str, str] = {}
    research_rows: list[Mapping[str, Any]] = []
    for row in data:
        if not isinstance(row, Mapping):
            return None
        slug = row.get("slug")
        tool = row.get("tool")
        if not isinstance(slug, str) or not isinstance(tool, str) or slug in tools:
            return None
        tools[slug] = tool
        if slug == "research":
            research_rows.append(row)
    if len(research_rows) != 1:
        return None
    protocols = value.get("protocols")
    descriptor = value.get("research_input_resolution")
    file_upload = value.get("file_upload")
    if not (
        isinstance(protocols, Mapping)
        and isinstance(descriptor, Mapping)
        and isinstance(file_upload, Mapping)
    ):
        return None
    attachments = research_rows[0].get("capabilities")
    attachments = (
        attachments.get("attachments") if isinstance(attachments, Mapping) else None
    )
    datasets = attachments.get("datasets") if isinstance(attachments, Mapping) else None
    limits = file_upload.get("limits")
    upload_routes = file_upload.get("routes")
    if (
        not isinstance(datasets, Mapping)
        or not isinstance(limits, Mapping)
        or not isinstance(upload_routes, list)
    ):
        return None
    descriptor_fields = tuple(_RESEARCH_INPUT_LIMIT_DECLARATIONS)
    descriptor_formats = descriptor.get("dataset_formats")
    research_formats = datasets.get("formats")
    if not isinstance(descriptor_formats, list) or not isinstance(
        research_formats, list
    ):
        return None
    return {
        "canonical_agent_tools": tools,
        "protocols": {
            key: protocols.get(key)
            for key in protocols
            if key in {contract.research_protocol, contract.upload_protocol}
        },
        "research_input_resolution": {
            **{field: descriptor.get(field) for field in descriptor_fields},
            "dataset_formats": descriptor_formats,
        },
        "research_agent_dataset_formats": research_formats,
        "upload_capability": {
            "route_family": file_upload.get("route_family"),
            "routes": upload_routes,
            "max_file_bytes": limits.get("max_file_bytes"),
        },
    }


def _safe_git_path(value: str) -> bool:
    parts = value.split("/")
    return (
        bool(value)
        and not value.startswith("/")
        and "\\" not in value
        and all(part not in {"", ".", ".."} for part in parts)
    )


def _decode_object_payload(value: Any, limit: int) -> bytes | None:
    if not isinstance(value, str) or len(value) > (limit * 4 // 3) + 8:
        return None
    try:
        payload = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError):
        return None
    return payload if len(payload) <= limit else None


def _git_object_oid(kind: str, payload: bytes) -> str:
    framed = f"{kind} {len(payload)}\0".encode("ascii") + payload
    return hashlib.sha1(framed, usedforsecurity=False).hexdigest()


def _parse_git_tree(payload: bytes) -> dict[str, tuple[str, str]] | None:
    entries: dict[str, tuple[str, str]] = {}
    position = 0
    while position < len(payload):
        space = payload.find(b" ", position)
        nul = payload.find(b"\0", space + 1)
        if space <= position or nul <= space or nul + 21 > len(payload):
            return None
        try:
            mode = payload[position:space].decode("ascii")
            name = payload[space + 1 : nul].decode("utf-8")
        except UnicodeDecodeError:
            return None
        if (
            not re.fullmatch(r"[0-7]{5,6}", mode)
            or not name
            or "/" in name
            or name in entries
        ):
            return None
        oid = payload[nul + 1 : nul + 21].hex()
        entries[name] = (mode, oid)
        position = nul + 21
    return entries if entries else None


def _resolve_git_blob(
    root_tree: str,
    path: str,
    trees: Mapping[str, bytes],
) -> tuple[str, set[str]] | None:
    current = root_tree
    used: set[str] = set()
    parts = path.split("/")
    for index, part in enumerate(parts):
        payload = trees.get(current)
        parsed = _parse_git_tree(payload) if payload is not None else None
        if parsed is None or part not in parsed:
            return None
        used.add(current)
        mode, oid = parsed[part]
        if index == len(parts) - 1:
            if mode not in {"100644", "100755"}:
                return None
            return oid, used
        if mode not in {"40000", "040000"}:
            return None
        current = oid
    return None


def _resumable_packet_metadata(raw: bytes, source_sha256: str) -> dict[str, Any] | None:
    value = _json_object(raw)
    if value is None or set(value) != {"protocol", "fixture_version", "files"}:
        return None
    protocol = value.get("protocol")
    fixture_version = value.get("fixture_version")
    files = value.get("files")
    if (
        not isinstance(protocol, str)
        or _PROTOCOL_NAME_RE.fullmatch(protocol) is None
        or not isinstance(fixture_version, str)
        or not fixture_version
        or not isinstance(files, dict)
        or not files
    ):
        return None
    entries: list[dict[str, str]] = []
    for path, digest in sorted(files.items()):
        if (
            not isinstance(path, str)
            or not re.fullmatch(r"[a-z][a-z0-9_]{0,126}\.json", path)
            or not isinstance(digest, str)
            or re.fullmatch(r"[0-9a-f]{64}", digest) is None
        ):
            return None
        entries.append({"path": path, "sha256": digest})
    required_prefixes = (
        "capability",
        "create_",
        "renew_",
        "head_",
        "part_",
        "complete_",
        "abort_",
    )
    if any(
        not any(item["path"].startswith(prefix) for item in entries)
        for prefix in required_prefixes
    ):
        return None
    return {
        "manifest_path": BOT_SOURCE_PATHS["resumable_upload_packet"],
        "manifest_sha256": source_sha256,
        "protocol": protocol,
        "fixture_version": fixture_version,
        "files": entries,
    }


def _authenticate_bot_sources(
    bot_commit: Any,
    proof: Any,
    source_entries: Any,
    expected_commit: str,
    source_paths: Mapping[str, str],
    violations: list[str],
    label: str,
) -> _AuthenticatedBotSources | None:
    if (
        not isinstance(bot_commit, str)
        or re.fullmatch(r"[0-9a-f]{40}", bot_commit) is None
    ):
        violations.append(f"{label} manifest is malformed or drifted")
        return None
    if bot_commit != expected_commit:
        violations.append(f"{label} does not use the accepted Bot commit")
        return None
    if not isinstance(proof, dict) or set(proof) != {"commit", "trees"}:
        violations.append(f"{label} manifest is malformed or drifted")
        return None
    commit_entry = proof.get("commit")
    tree_entries = proof.get("trees")
    if (
        not isinstance(commit_entry, dict)
        or set(commit_entry) != {"oid", "content_base64"}
        or commit_entry.get("oid") != bot_commit
        or not isinstance(tree_entries, list)
    ):
        violations.append(f"{label} manifest is malformed or drifted")
        return None
    commit_payload = _decode_object_payload(
        commit_entry.get("content_base64"), 64 * 1024
    )
    if (
        commit_payload is None
        or _git_object_oid("commit", commit_payload) != bot_commit
    ):
        violations.append(f"{label} Git commit proof is invalid")
        return None
    tree_headers = [
        line
        for line in commit_payload.split(b"\n\n", 1)[0].splitlines()
        if line.startswith(b"tree ")
    ]
    if (
        len(tree_headers) != 1
        or re.fullmatch(rb"tree [0-9a-f]{40}", tree_headers[0]) is None
    ):
        violations.append(f"{label} Git commit proof is invalid")
        return None
    root_tree = tree_headers[0][5:].decode("ascii")

    trees: dict[str, bytes] = {}
    for entry in tree_entries:
        if not isinstance(entry, dict) or set(entry) != {"oid", "content_base64"}:
            violations.append(f"{label} Git tree proof is invalid")
            return None
        oid = entry.get("oid")
        payload = _decode_object_payload(entry.get("content_base64"), 512 * 1024)
        if (
            not isinstance(oid, str)
            or re.fullmatch(r"[0-9a-f]{40}", oid) is None
            or payload is None
            or _git_object_oid("tree", payload) != oid
            or oid in trees
        ):
            violations.append(f"{label} Git tree proof is invalid")
            return None
        trees[oid] = payload

    if not isinstance(source_entries, list) or len(source_entries) != len(
        source_paths
    ):
        violations.append(f"{label} source inventory is incomplete")
        return None
    sources: dict[str, bytes] = {}
    source_digests: dict[str, str] = {}
    used_trees: set[str] = set()
    for entry in source_entries:
        if not isinstance(entry, dict) or set(entry) != {
            "role",
            "path",
            "git_blob_oid",
            "sha256",
            "content_base64",
        }:
            violations.append(f"{label} source inventory is malformed")
            return None
        role = entry.get("role")
        path = entry.get("path")
        blob_oid = entry.get("git_blob_oid")
        digest = entry.get("sha256")
        payload = _decode_object_payload(
            entry.get("content_base64"), MAX_BOT_SOURCE_BYTES
        )
        if (
            not isinstance(role, str)
            or role not in source_paths
            or role in sources
            or path != source_paths[role]
            or not isinstance(path, str)
            or not _safe_git_path(path)
            or not isinstance(blob_oid, str)
            or re.fullmatch(r"[0-9a-f]{40}", blob_oid) is None
            or not isinstance(digest, str)
            or re.fullmatch(r"[0-9a-f]{64}", digest) is None
            or payload is None
            or _git_object_oid("blob", payload) != blob_oid
            or hashlib.sha256(payload).hexdigest() != digest
        ):
            violations.append(f"{label} source inventory is malformed or drifted")
            return None
        resolved = _resolve_git_blob(root_tree, path, trees)
        if resolved is None or resolved[0] != blob_oid:
            violations.append(f"{label} source is not in the pinned Git commit")
            return None
        used_trees.update(resolved[1])
        sources[role] = payload
        source_digests[role] = digest
    if set(sources) != set(source_paths) or used_trees != set(trees):
        violations.append(f"{label} source inventory is incomplete")
        return None
    return _AuthenticatedBotSources(sources, source_digests)


def _load_bot_source_binding(
    root: RootedDirectory, violations: list[str]
) -> _BotSourceBinding | None:
    try:
        raw = root.read_bytes(
            BOT_CONTRACT_MANIFEST_REL,
            MAX_BOT_CONTRACT_MANIFEST_BYTES,
        )
    except InputTooLargeError:
        violations.append("Bot source binding manifest is oversized")
        return None
    except (InputChangedError, UnsafeInputPathError):
        violations.append("refusing to read out-of-scope activation path")
        return None
    except FileNotFoundError:
        violations.append("missing Web activation source")
        return None
    except OSError:
        violations.append("cannot read Web activation source")
        return None
    manifest = _json_object(raw)
    binding = (
        manifest.get("activation_source_binding") if manifest is not None else None
    )
    if (
        not isinstance(binding, dict)
        or set(binding)
        != {
            "schema_version",
            "bot_commit",
            "object_format",
            "git_object_proof",
            "sources",
            "contract",
            "research_fixture",
            "resumable_upload_packet",
        }
        or binding.get("schema_version") != 1
        or binding.get("object_format") != "sha1"
    ):
        violations.append("Bot source binding manifest is malformed or drifted")
        return None
    authenticated = _authenticate_bot_sources(
        binding.get("bot_commit"),
        binding.get("git_object_proof"),
        binding.get("sources"),
        ACTIVATION_SOURCE_BOT_COMMIT,
        BOT_SOURCE_PATHS,
        violations,
        "Bot source binding",
    )
    if authenticated is None:
        return None
    sources = authenticated.values
    source_digests = authenticated.digests

    contract = _parse_pinned_bot_contract(sources)
    if contract is None or binding.get("contract") != _pinned_bot_contract_value(
        contract
    ):
        violations.append("Bot source binding contract does not match pinned sources")
        return None
    packet = _resumable_packet_metadata(
        sources["resumable_upload_packet"],
        source_digests["resumable_upload_packet"],
    )
    if (
        packet is None
        or packet.get("protocol") != contract.upload_protocol
        or binding.get("resumable_upload_packet") != packet
    ):
        violations.append("Bot source binding resumable packet is malformed or drifted")
        return None

    fixture = binding.get("research_fixture")
    expected_contract_sha256 = _canonical_json_sha256(
        _expected_fixture_contract(contract)
    )
    if (
        not isinstance(fixture, dict)
        or set(fixture) != {"path", "sha256", "contract_sha256", "authority"}
        or fixture.get("path") != RESEARCH_INPUT_FIXTURE_REL.as_posix()
        or not isinstance(fixture.get("sha256"), str)
        or re.fullmatch(r"[0-9a-f]{64}", fixture["sha256"]) is None
        or fixture.get("contract_sha256") != expected_contract_sha256
    ):
        violations.append("Bot source binding Research fixture is malformed or drifted")
        return None
    authority = fixture.get("authority")
    if (
        not isinstance(authority, dict)
        or set(authority)
        != {
            "schema_version",
            "bot_commit",
            "object_format",
            "git_object_proof",
            "sources",
        }
        or authority.get("schema_version") != 1
        or authority.get("object_format") != "sha1"
    ):
        violations.append("Research fixture authority is malformed or drifted")
        return None
    fixture_sources = _authenticate_bot_sources(
        authority.get("bot_commit"),
        authority.get("git_object_proof"),
        authority.get("sources"),
        RESEARCH_FIXTURE_BOT_COMMIT,
        RESEARCH_FIXTURE_SOURCE_PATHS,
        violations,
        "Research fixture authority",
    )
    if fixture_sources is None:
        return None
    expected_fixture_raw = _research_fixture_bytes(fixture_sources.values)
    expected_fixture = (
        _parse_research_input_fixture(expected_fixture_raw.decode("utf-8"))
        if expected_fixture_raw is not None
        else None
    )
    expected_fixture_value = (
        _fixture_contract_value(expected_fixture, contract)
        if expected_fixture is not None
        else None
    )
    if (
        expected_fixture_raw is None
        or expected_fixture_value != _expected_fixture_contract(contract)
        or fixture["sha256"] != hashlib.sha256(expected_fixture_raw).hexdigest()
    ):
        violations.append("Research fixture authority does not reproduce exact bytes")
        return None
    return _BotSourceBinding(
        contract=contract,
        fixture_sha256=fixture["sha256"],
        fixture_contract_sha256=expected_contract_sha256,
    )


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
    root: RootedDirectory,
    source_binding: _BotSourceBinding | None,
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
    fixture_raw = _read_bytes(
        root,
        RESEARCH_INPUT_FIXTURE_REL,
        violations,
        MAX_RESEARCH_INPUT_FIXTURE_BYTES,
    )
    if fixture_raw is None:
        violations.append("research_input_resolution_v1.json is missing")
        return
    fixture_digest = hashlib.sha256(fixture_raw).hexdigest()
    if (
        go_contract is not None
        and fixture_digest != go_contract.accepted_fixture_sha256
    ):
        violations.append("Research fixture SHA-256 differs from accepted bytes")
    if source_binding is not None and fixture_digest != source_binding.fixture_sha256:
        violations.append("Research fixture SHA-256 differs from pinned Bot evidence")
    try:
        fixture_text = fixture_raw.decode("utf-8")
    except UnicodeDecodeError:
        violations.append("research_input_resolution_v1.json is not UTF-8")
        return
    fixture = _parse_research_input_fixture(fixture_text)
    if fixture is None:
        violations.append("research_input_resolution_v1.json is malformed")
        return
    if source_binding is not None:
        pinned = source_binding.contract
        fixture_contract = _fixture_contract_value(fixture, pinned)
        if (
            fixture_contract is None
            or _canonical_json_sha256(fixture_contract)
            != source_binding.fixture_contract_sha256
        ):
            violations.append(
                "Research fixture contract differs from pinned Bot sources"
            )
    if go_contract is None:
        return
    if source_binding is not None:
        pinned = source_binding.contract
        if go_contract.canonical_agent_tools != pinned.canonical_agent_tools:
            violations.append(
                "Web agent identities differ from pinned Bot agent identities"
            )
        if (
            go_contract.protocol != pinned.research_protocol
            or go_contract.protocol_version != pinned.research_protocol_version
            or go_contract.limit_bounds != pinned.research_limit_bounds
            or not go_contract.archive_formats.issubset(pinned.research_formats)
            or go_contract.max_dataset_file_bytes != pinned.upload_ceiling_bytes
        ):
            violations.append("Web Research contract differs from pinned Bot sources")
        if go_contract.accepted_fixture_sha256 != source_binding.fixture_sha256:
            violations.append(
                "Web Research fixture digest differs from pinned Bot evidence"
            )

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
        archive_formats is None
        or not archive_formats
        or not archive_formats.issubset(go_contract.archive_formats)
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


def _load_fixture_json(
    root: RootedDirectory,
    relative: Path,
    violations: list[str],
) -> Any | None:
    text = _read_text(root, relative, violations)
    if text is None:
        return None
    try:
        return json.loads(text)
    except (RecursionError, TypeError, ValueError):
        violations.append("RC-WEB-004 product fixture JSON is malformed")
        return None


def _check_product_fixture(
    root: RootedDirectory,
    fixture_id: str,
    violations: list[str],
) -> None:
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
    root: RootedDirectory,
    readiness: Any,
    rows: Any,
    violations: list[str],
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


def _check_open_root(root: RootedDirectory) -> list[str]:
    violations: list[str] = []
    source_binding = _load_bot_source_binding(root, violations)
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
        source_binding,
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


def check(root: Path) -> list[str]:
    """Return deterministic, bounded activation violations for ``root``."""

    requested_root = Path(root)
    if _has_forbidden_part(requested_root):
        return ["refusing to read out-of-scope activation root"]
    try:
        opened_root = RootedDirectory(requested_root)
    except OSError:
        return ["refusing to read out-of-scope activation root"]
    with opened_root:
        if _has_forbidden_part(opened_root.path):
            return ["refusing to read out-of-scope activation root"]
        return _check_open_root(opened_root)


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
