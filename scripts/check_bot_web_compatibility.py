#!/usr/bin/env python3
"""Check the committed Bot HEAD/Web compatibility contract offline.

The checker deliberately has no HTTP client and never leaves this checkout. It
reads the Web-owned canonical agent maps, a small committed manifest, the
synthetic response fixtures already checked into this repository, and the
dark-launch configuration examples. It is intended to be deterministic enough
for a local pre-commit gate.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_REL = Path("apps/web/tests/fixtures/bot-head/contract-manifest.json")

RELEASE_BOT_COMMIT = "38349aab1f6e2d65c286723beb3e5a426027e77a"
REQUIRED_AGENT_SLUGS = (
    "chat",
    "knowledge",
    "data",
    "review",
    "brief_gene",
    "analyst",
    "deep_genome",
    "research",
    "design",
    "network",
)
REQUIRED_FIXTURE_IDS = (
    "chat_completion_run_id",
    "degraded_tracking",
    "deep_genome_revision",
    "review_input_required",
    "conversation_context_v1",
)
RESULT_ARCHIVE_PROTOCOL_VERSION = 1
RESULT_ARCHIVE_AGENT_SLUGS = ("analyst", "research", "network", "design")
RESULT_ARCHIVE_FIXTURE_PATHS = {
    agent: Path(f"apps/server/external/bot/testdata/head/{agent}_terminal.json")
    for agent in RESULT_ARCHIVE_AGENT_SLUGS
}
RESULT_ARCHIVE_RELEASE_FIXTURE_SHA256 = {
    RELEASE_BOT_COMMIT: {
        "analyst": "b82b7809bdea88f023e90132a4a361386a3134f01b2b0766356209bdaf379ad8",
        "research": "9655b1e1b677b36b75a46ced3169456f2ef0db0a457205896803b1a9da5d8d26",
        "network": "ce1cda9d84b7f730715fb9f500c6bc71127ab1fc94aa34b03ed0c36340999f53",
        "design": "43c9628ec27920b52f416c0d6b6056417e28ef0a48910fb810bc18b7c0e1bda2",
    }
}
REQUIRED_AGENT_EXECUTIONS = {
    "chat": "chat",
    "knowledge": "chat",
    "data": "blocking",
    "review": "chat",
    "brief_gene": "agent_run",
    "analyst": "agent_run",
    "deep_genome": "agent_run",
    "research": "agent_run",
    "design": "agent_run",
    "network": "agent_run",
}
RESULT_ARCHIVE_DOWNLOAD_REF_RE = re.compile(r"^result-archive:sha256:[0-9a-f]{64}$")
RESULT_ARCHIVE_DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
RESULT_ARCHIVE_ARCHIVE_FIELDS = {
    "role",
    "name",
    "media_type",
    "size_bytes",
    "downloadable",
    "report_context_eligible",
    "download_ref",
}
RESULT_ARCHIVE_DELIVERY_FIELDS = {
    "schema_version",
    "required",
    "status",
    "revision",
    "inventory_digest",
    "archive",
    "error_code",
    "retryable",
}

# Keep this set intentionally small. These keys are provider/debug payload
# details and must not become part of a Web-facing compatibility fixture.
FORBIDDEN_RAW_FIELDS = {
    "payload",
    "raw_payload",
    "traceback",
    "stack_trace",
}

CONVERSATION_CONTEXT_FORBIDDEN_FIELDS = FORBIDDEN_RAW_FIELDS | {
    "answer",
    "report",
    "table",
    "tabular",
    "assistant_summary",
    "assistant_summaries",
    "summary",
    "full_output",
    "final_report",
    "full_answer",
    "full_report",
    "full_table",
    "raw_path",
    "path",
    "url",
    "token",
    "credential",
    "username",
    "user_id",
}

CONVERSATION_CONTEXT_RAW_TEXT_FIELDS = {
    "answer",
    "assistant_summary",
    "assistant_summaries",
    "content",
    "final_report",
    "full_output",
    "full_answer",
    "full_report",
    "full_table",
    "report",
    "summary",
    "table",
    "tabular",
}
CONVERSATION_CONTEXT_ARTIFACT_FIELDS = {"artifact_id", "display_name"}
CONVERSATION_CONTEXT_HISTORY_FIELDS = {"content", "role", "summary", "turn_id"}

SCOPED_FILES = {
    "web_agents": Path("apps/web/src/constants/agents.ts"),
    "go_agents": Path("apps/server/external/bot/agent_canonical.go"),
    "go_aliases": Path("apps/server/external/bot/agent_map.go"),
    "go_query_map": Path("apps/server/service/api_service/query.go"),
    "feature_config": Path("apps/server/config/app.yml.example"),
    "web_store": Path("apps/web/src/stores/user.ts"),
    "web_stream": Path("apps/web/src/views/chat/composables/useSendMessage.ts"),
}

FIXTURE_PATHS = {
    "chat_completion_run_id": (
        Path("apps/server/external/bot/testdata/head/chat_completion_run_id.json"),
    ),
    "degraded_tracking": (
        Path("apps/server/external/bot/testdata/head/agent_run_degraded.json"),
    ),
    "deep_genome_revision": (
        Path("apps/server/external/bot/testdata/head/deep_genome_intermediate.json"),
        Path("apps/server/external/bot/testdata/head/deep_genome_final.json"),
    ),
    "review_input_required": (
        Path("apps/server/external/bot/testdata/head/review_input_required.json"),
    ),
    "conversation_context_v1": (
        Path("apps/server/external/bot/testdata/head/conversation_context_v1.json"),
    ),
}

DEFAULT_OFF_FLAGS = (
    "expert_enabled",
    "stream_enabled",
    "a2ui_actions_enabled",
    "multiturn_v1_enabled",
)

PASS_LINE = "Bot/Web compatibility contract: PASS"
FAIL_LINE = "Bot/Web compatibility contract: FAIL"
MAX_FAILURE_LINES = 32
MAX_FAILURE_LENGTH = 240

_MANIFEST_FIELDS = {
    "schema_version",
    "bot_commit",
    "required_agents",
    "fixtures",
    "result_archive_v1",
}
_FLAG_RE_TEMPLATE = r"(?m)^\s*{key}\s*:\s*(?P<value>true|false)\b"
_SOURCE_TOKEN_RE = re.compile(
    r"""
    (?P<whitespace>\s+)
    |(?P<line_comment>//[^\r\n]*)
    |(?P<block_comment>/\*.*?\*/)
    |(?P<string>"[A-Za-z0-9_.-]+")
    |(?P<identifier>[A-Za-z][A-Za-z0-9_]*)
    |(?P<punctuation>[\[\]{}:,=;])
    |(?P<unsupported>.)
    """,
    re.DOTALL | re.VERBOSE,
)


def _unique(values: Iterable[str]) -> list[str]:
    """Return values in first-seen order without exposing fixture contents."""

    return list(dict.fromkeys(values))


def _manifest_list(
    manifest: dict[str, Any], key: str, violations: list[str]
) -> list[str] | None:
    value = manifest.get(key)
    if not isinstance(value, list):
        violations.append(f"manifest {key} must be a list")
        return None
    if any(not isinstance(item, str) or not item.strip() for item in value):
        if key == "fixtures":
            violations.append(
                "manifest fixtures entries must be string fixture ids; raw payload fields are not allowed"
            )
        else:
            violations.append(f"manifest {key} entries must be non-empty strings")
        return None
    return value


def _compare_exact_set(
    label: str, actual: list[str], expected: tuple[str, ...], violations: list[str]
) -> None:
    actual_set = set(actual)
    expected_set = set(expected)
    missing = sorted(expected_set - actual_set)
    extra = sorted(actual_set - expected_set)
    duplicate = sorted(value for value in _unique(actual) if actual.count(value) > 1)
    if missing:
        violations.append(f"{label} missing: {', '.join(missing)}")
    if extra:
        violations.append(f"{label} extra: {', '.join(extra)}")
    if duplicate:
        violations.append(f"{label} duplicate: {', '.join(duplicate)}")


def validate_manifest(manifest: Any) -> list[str]:
    """Validate release pins and fixture IDs without inspecting payload data."""

    violations: list[str] = []
    if not isinstance(manifest, dict):
        return ["manifest root must be an object"]

    unsupported = sorted(set(manifest) - _MANIFEST_FIELDS)
    if unsupported:
        violations.append(
            "manifest contains unsupported fields: " + ", ".join(unsupported)
        )

    if manifest.get("schema_version") != 2:
        violations.append("manifest schema_version must be 2")

    bot_commit = manifest.get("bot_commit")
    if bot_commit != RELEASE_BOT_COMMIT:
        violations.append("manifest bot_commit is not the pinned release SHA")

    agents = _manifest_list(manifest, "required_agents", violations)
    if agents is not None:
        _compare_exact_set("manifest required_agents", agents, REQUIRED_AGENT_SLUGS, violations)

    fixtures = _manifest_list(manifest, "fixtures", violations)
    if fixtures is not None:
        _compare_exact_set("manifest fixtures", fixtures, REQUIRED_FIXTURE_IDS, violations)

    archive_v1 = manifest.get("result_archive_v1")
    if not isinstance(archive_v1, dict):
        violations.append("manifest result_archive_v1 must be an object")
        return violations
    if set(archive_v1) != {"protocol_version", "fixtures"}:
        violations.append("manifest result_archive_v1 fields are invalid")
        return violations
    if archive_v1.get("protocol_version") != RESULT_ARCHIVE_PROTOCOL_VERSION:
        violations.append("manifest result_archive_v1 protocol_version must be 1")
    archive_fixtures = archive_v1.get("fixtures")
    if not isinstance(archive_fixtures, dict) or set(archive_fixtures) != set(
        RESULT_ARCHIVE_AGENT_SLUGS
    ):
        violations.append("manifest result_archive_v1 fixtures must cover all scoped agents")
        return violations
    for agent in RESULT_ARCHIVE_AGENT_SLUGS:
        entry = archive_fixtures.get(agent)
        if not isinstance(entry, dict) or set(entry) != {"path", "sha256"}:
            violations.append("manifest result_archive_v1 fixture metadata is invalid")
            continue
        if entry.get("path") != RESULT_ARCHIVE_FIXTURE_PATHS[agent].as_posix():
            violations.append("manifest result_archive_v1 fixture path is not canonical")
        digest = entry.get("sha256")
        if not isinstance(digest, str) or re.fullmatch(r"[0-9a-f]{64}", digest) is None:
            violations.append("manifest result_archive_v1 fixture sha256 is invalid")

    return violations


def _within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
    except ValueError:
        return False
    return True


def _read_bytes(root: Path, relative: Path, violations: list[str]) -> bytes | None:
    path = root / relative
    if not _within(path, root):
        violations.append(f"refusing to read out-of-scope path: {relative}")
        return None
    try:
        return path.read_bytes()
    except FileNotFoundError:
        violations.append(f"missing compatibility file: {relative}")
    except OSError:
        violations.append(f"cannot read compatibility file: {relative}")
    return None


def _read_text(root: Path, relative: Path, violations: list[str]) -> str | None:
    raw = _read_bytes(root, relative, violations)
    if raw is None:
        return None
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        violations.append(f"compatibility file is not UTF-8 text: {relative}")
        return None


def _load_json(root: Path, relative: Path, violations: list[str]) -> Any | None:
    raw = _read_bytes(root, relative, violations)
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        violations.append(f"invalid compatibility fixture JSON: {relative}")
        return None


SourceToken = tuple[str, str]


def _source_tokens(text: str) -> list[SourceToken]:
    tokens: list[SourceToken] = []
    for match in _SOURCE_TOKEN_RE.finditer(text):
        kind = match.lastgroup
        if kind in {"whitespace", "line_comment", "block_comment"}:
            continue
        value = match.group(0)
        tokens.append((kind or "unsupported", value.strip('"') if kind == "string" else value))
    return tokens


def _literal_tokens(
    text: str,
    prefix: tuple[SourceToken, ...],
    opening: str,
    closing: str,
    suffix: tuple[SourceToken, ...] = (),
) -> list[SourceToken] | None:
    tokens = _source_tokens(text)
    starts = [
        index
        for index in range(len(tokens) - len(prefix) + 1)
        if tuple(tokens[index : index + len(prefix)]) == prefix
    ]
    if len(starts) != 1:
        return None

    body_start = starts[0] + len(prefix)
    depth = 1
    for index in range(body_start, len(tokens)):
        if tokens[index] == ("punctuation", opening):
            depth += 1
        elif tokens[index] == ("punctuation", closing):
            depth -= 1
            if depth == 0:
                if tuple(tokens[index + 1 : index + 1 + len(suffix)]) != suffix:
                    return None
                return tokens[body_start:index]
    return None


def _comma_separated_strings(tokens: list[SourceToken]) -> list[str] | None:
    values: list[str] = []
    index = 0
    while index < len(tokens):
        kind, value = tokens[index]
        if kind != "string":
            return None
        values.append(value)
        index += 1
        if index == len(tokens):
            break
        if tokens[index] != ("punctuation", ","):
            return None
        index += 1
    return values


def _string_map(tokens: list[SourceToken]) -> dict[str, str] | None:
    values: dict[str, str] = {}
    index = 0
    while index < len(tokens):
        if index + 2 >= len(tokens):
            return None
        key_kind, key = tokens[index]
        value_kind, value = tokens[index + 2]
        if (
            key_kind != "string"
            or tokens[index + 1] != ("punctuation", ":")
            or value_kind != "string"
            or key in values
        ):
            return None
        values[key] = value
        index += 3
        if index == len(tokens):
            break
        if tokens[index] != ("punctuation", ","):
            return None
        index += 1
    return values


def _record_list(tokens: list[SourceToken]) -> list[dict[str, str]] | None:
    records: list[dict[str, str]] = []
    index = 0
    while index < len(tokens):
        if tokens[index] != ("punctuation", "{"):
            return None
        index += 1
        fields: dict[str, str] = {}
        while index < len(tokens) and tokens[index] != ("punctuation", "}"):
            if index + 2 >= len(tokens):
                return None
            field_kind, field = tokens[index]
            value_kind, value = tokens[index + 2]
            if (
                field_kind != "identifier"
                or tokens[index + 1] != ("punctuation", ":")
                or value_kind != "string"
                or field in fields
            ):
                return None
            fields[field] = value
            index += 3
            if index < len(tokens) and tokens[index] == ("punctuation", ","):
                index += 1
            elif index >= len(tokens) or tokens[index] != ("punctuation", "}"):
                return None
        if index >= len(tokens) or set(fields) != {"Tool", "Slug", "Execution"}:
            return None
        records.append(fields)
        index += 1
        if index == len(tokens):
            break
        if tokens[index] != ("punctuation", ","):
            return None
        index += 1
    return records


def _parse_go_map(text: str, marker: str) -> dict[str, str] | None:
    tokens = _literal_tokens(
        text,
        (
            ("identifier", "var"),
            ("identifier", marker),
            ("punctuation", "="),
            ("identifier", "map"),
            ("punctuation", "["),
            ("identifier", "string"),
            ("punctuation", "]"),
            ("identifier", "string"),
            ("punctuation", "{"),
        ),
        "{",
        "}",
    )
    if tokens is None:
        return None
    return _string_map(tokens)


def _parse_web_tools(text: str) -> list[str] | None:
    tokens = _literal_tokens(
        text,
        (
            ("identifier", "export"),
            ("identifier", "const"),
            ("identifier", "CANONICAL_AGENT_TOOLS"),
            ("punctuation", "="),
            ("punctuation", "["),
        ),
        "[",
        "]",
        (
            ("identifier", "as"),
            ("identifier", "const"),
            ("punctuation", ";"),
        ),
    )
    if tokens is None:
        return None
    return _comma_separated_strings(tokens)


def _parse_web_agent_definitions(text: str) -> list[dict[str, str]] | None:
    tokens = _literal_tokens(
        text,
        (
            ("identifier", "var"),
            ("identifier", "WebAgentDefinitions"),
            ("punctuation", "="),
            ("punctuation", "["),
            ("punctuation", "]"),
            ("identifier", "WebAgentDefinition"),
            ("punctuation", "{"),
        ),
        "{",
        "}",
    )
    if tokens is None:
        return None
    return _record_list(tokens)


def _check_agent_maps(source_text: dict[str, str], violations: list[str]) -> None:
    go_map = _parse_go_map(source_text.get("go_agents", ""), "CanonicalAgentTool")
    if go_map is None:
        violations.append("Go canonical agent map is missing or malformed")
    else:
        _compare_exact_set("Go canonical agent slugs", list(go_map), REQUIRED_AGENT_SLUGS, violations)

    web_tools = _parse_web_tools(source_text.get("web_agents", ""))
    if web_tools is None:
        violations.append("Web canonical agent list is missing or malformed")
    elif go_map is not None:
        _compare_exact_set("Web canonical agent tools", web_tools, tuple(go_map.values()), violations)

    definitions = _parse_web_agent_definitions(source_text.get("go_aliases", ""))
    if definitions is None:
        violations.append("Web agent definitions are missing or malformed")
    else:
        definition_slugs = [record["Slug"] for record in definitions]
        definition_check_start = len(violations)
        _compare_exact_set(
            "Web agent definition slugs",
            definition_slugs,
            REQUIRED_AGENT_SLUGS,
            violations,
        )
        if len(violations) == definition_check_start:
            if definition_slugs != list(REQUIRED_AGENT_SLUGS):
                violations.append("Web agent definition order drifts from the release contract")
            definition_tools = {
                record["Slug"]: record["Tool"] for record in definitions
            }
            if go_map is not None and definition_tools != go_map:
                violations.append("Web agent definitions drift from the canonical map")
            definition_executions = {
                record["Slug"]: record["Execution"] for record in definitions
            }
            if definition_executions != REQUIRED_AGENT_EXECUTIONS:
                violations.append(
                    "Web agent definition executions drift from the release contract"
                )

    aliases = _parse_go_map(source_text.get("go_aliases", ""), "aliasToSlug")
    if aliases is None:
        violations.append("Go alias-to-slug map is missing or malformed")
    elif go_map is not None:
        if set(aliases) != set(go_map.values()):
            missing = sorted(set(go_map.values()) - set(aliases))
            extra = sorted(set(aliases) - set(go_map.values()))
            if missing:
                violations.append("Go alias map missing tools: " + ", ".join(missing))
            if extra:
                violations.append("Go alias map extra tools: " + ", ".join(extra))
        if set(aliases.values()) != set(REQUIRED_AGENT_SLUGS):
            violations.append("Go alias map values do not cover the exact release slugs")
        expected_aliases = {tool: slug for slug, tool in go_map.items()}
        if aliases != expected_aliases:
            violations.append("Go alias-to-slug values drift from the canonical map")

    query_map = _parse_go_map(source_text.get("go_query_map", ""), "slugToToolName")
    if query_map is None:
        violations.append("Go query slug-to-tool map is missing or malformed")
    elif go_map is not None:
        if set(query_map) != set(go_map):
            missing = sorted(set(go_map) - set(query_map))
            extra = sorted(set(query_map) - set(go_map))
            if missing:
                violations.append("Go query map missing slugs: " + ", ".join(missing))
            if extra:
                violations.append("Go query map extra slugs: " + ", ".join(extra))
        if query_map != {slug: go_map[slug] for slug in query_map if slug in go_map}:
            violations.append("Go query slug-to-tool values drift from the canonical map")


def _check_default_off_flags(text: str, violations: list[str]) -> None:
    for key in DEFAULT_OFF_FLAGS:
        matches = re.findall(_FLAG_RE_TEMPLATE.format(key=re.escape(key)), text)
        if len(matches) != 1 or matches[0].lower() != "false":
            violations.append(f"feature gate {key} default must be false")


def _check_web_feature_defaults(source_text: dict[str, str], violations: list[str]) -> None:
    store = source_text.get("web_store", "")
    if not re.search(r"(?m)^\s*expertEnabled\s*:\s*false\b", store):
        violations.append("Web expertEnabled default must be false")

    stream = source_text.get("web_stream", "")
    stream_refs = re.findall(r"import\.meta\.env\.VITE_STREAM_ENABLED", stream)
    explicit_true = re.findall(
        r'import\.meta\.env\.VITE_STREAM_ENABLED\s*===\s*["\']true["\']', stream
    )
    if stream_refs and len(stream_refs) != len(explicit_true):
        violations.append("Web VITE_STREAM_ENABLED must use an explicit true opt-in")


def _iter_keys(value: Any) -> Iterable[str]:
    if isinstance(value, dict):
        for key, child in value.items():
            if isinstance(key, str):
                yield key
            yield from _iter_keys(child)
    elif isinstance(value, list):
        for child in value:
            yield from _iter_keys(child)


def _check_fixture(root: Path, fixture_id: str, relative: Path, violations: list[str]) -> None:
    payload = _load_json(root, relative, violations)
    if payload is None:
        return
    if not isinstance(payload, dict):
        violations.append(f"fixture {fixture_id} must contain a JSON object")
        return
    forbidden = sorted(set(_iter_keys(payload)) & FORBIDDEN_RAW_FIELDS)
    if forbidden:
        violations.append(
            f"fixture {fixture_id} contains raw payload field: {', '.join(forbidden)}"
        )
    if fixture_id == "conversation_context_v1":
        _check_conversation_context_fixture(payload, violations)


def _check_conversation_context_fixture(
    payload: dict[str, Any], violations: list[str]
) -> None:
    """Keep the V1 fixture to bounded metadata, never raw context/output."""

    requests = payload.get("requests")
    responses = payload.get("responses")
    if not isinstance(requests, dict) or not isinstance(responses, dict):
        violations.append("fixture conversation_context_v1 requires requests and responses objects")
        return

    allowed_user_content_paths: set[tuple[str | int, ...]] = set()

    request_names = (
        "instant_envelope",
        "expert_unforced_envelope",
        "expert_explicit_envelope",
    )
    for name in request_names:
        envelope = requests.get(name)
        if not isinstance(envelope, dict):
            violations.append(f"fixture conversation_context_v1 request {name} must be an object")
            continue
        allowed_user_content_paths.add(("requests", name, "current_message", "content"))
        history_delta = envelope.get("history_delta")
        if not isinstance(history_delta, list):
            violations.append(f"fixture conversation_context_v1 request {name} history_delta must be a list")
        else:
            for index, entry in enumerate(history_delta):
                if not isinstance(entry, dict):
                    violations.append(f"fixture conversation_context_v1 request {name} history_delta entry must be an object")
                    continue
                if entry.get("role") == "user" and "content" in entry:
                    allowed_user_content_paths.add(
                        ("requests", name, "history_delta", index, "content")
                    )
                unsupported = set(entry) - CONVERSATION_CONTEXT_HISTORY_FIELDS
                if unsupported:
                    violations.append(
                        "fixture conversation_context_v1 history_delta contains unsupported text field"
                    )
                forbidden = sorted(set(entry) & CONVERSATION_CONTEXT_FORBIDDEN_FIELDS)
                if forbidden:
                    violations.append(
                        "fixture conversation_context_v1 history_delta contains raw output field"
                    )
        artifact_refs = envelope.get("artifact_refs")
        if not isinstance(artifact_refs, list):
            violations.append(f"fixture conversation_context_v1 request {name} artifact_refs must be a list")
        else:
            for ref in artifact_refs:
                if not isinstance(ref, dict):
                    violations.append(f"fixture conversation_context_v1 request {name} artifact_ref must be an object")
                    continue
                if set(ref) - CONVERSATION_CONTEXT_ARTIFACT_FIELDS:
                    violations.append(
                        "fixture conversation_context_v1 artifact_refs contains unsupported raw field"
                    )
                forbidden = sorted(set(ref) & CONVERSATION_CONTEXT_FORBIDDEN_FIELDS)
                if forbidden:
                    violations.append(
                        "fixture conversation_context_v1 artifact_refs contains raw storage field"
                    )

    scoped_payload = {"requests": requests, "responses": responses}
    _check_conversation_text_fields(
        scoped_payload, allowed_user_content_paths, violations
    )
    forbidden = sorted(set(_iter_keys(scoped_payload)) & CONVERSATION_CONTEXT_FORBIDDEN_FIELDS)
    if forbidden:
        violations.append(
            "fixture conversation_context_v1 contains raw context/output field"
        )
    serialized = json.dumps(scoped_payload, ensure_ascii=True).lower()
    for marker in (
        "http://",
        "https://",
        "@",
        "password",
        "username",
        "signed",
        "token",
        "full answer",
        "full report",
        "full table",
    ):
        if marker in serialized:
            violations.append("fixture conversation_context_v1 contains sensitive content")
            break
    if "/" in serialized or "\\" in serialized:
        violations.append("fixture conversation_context_v1 contains a raw path")


def _check_conversation_text_fields(
    value: Any,
    allowed_user_content_paths: set[tuple[str | int, ...]],
    violations: list[str],
    path: tuple[str | int, ...] = (),
) -> None:
    """Reject text-bearing output fields outside the user-message contract."""

    if isinstance(value, dict):
        for key, child in value.items():
            child_path = path + (key,)
            if key in CONVERSATION_CONTEXT_RAW_TEXT_FIELDS:
                if child_path not in allowed_user_content_paths:
                    message = "fixture conversation_context_v1 contains unbounded conversation text"
                    if message not in violations:
                        violations.append(message)
            _check_conversation_text_fields(
                child, allowed_user_content_paths, violations, child_path
            )
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _check_conversation_text_fields(
                child, allowed_user_content_paths, violations, path + (index,)
            )


def _check_fixtures(root: Path, manifest: dict[str, Any] | None, violations: list[str]) -> None:
    if manifest is None:
        return
    fixtures = manifest.get("fixtures")
    if not isinstance(fixtures, list):
        return
    for fixture_id in fixtures:
        if not isinstance(fixture_id, str):
            # validate_manifest reports this without echoing the value.
            continue
        paths = FIXTURE_PATHS.get(fixture_id)
        if paths is None:
            continue
        for relative in paths:
            _check_fixture(root, fixture_id, relative, violations)
    _check_result_archive_fixtures(root, manifest, violations)


def _check_result_archive_fixtures(
    root: Path, manifest: dict[str, Any], violations: list[str]
) -> None:
    archive_v1 = manifest.get("result_archive_v1")
    if not isinstance(archive_v1, dict):
        return
    entries = archive_v1.get("fixtures")
    if not isinstance(entries, dict):
        return
    release_digests = RESULT_ARCHIVE_RELEASE_FIXTURE_SHA256.get(RELEASE_BOT_COMMIT)
    if release_digests is None:
        violations.append("result archive fixture release pins are missing")
        return
    for agent in RESULT_ARCHIVE_AGENT_SLUGS:
        entry = entries.get(agent)
        if not isinstance(entry, dict):
            continue
        relative = RESULT_ARCHIVE_FIXTURE_PATHS[agent]
        raw = _read_bytes(root, relative, violations)
        if raw is None:
            violations.append("missing result archive fixture")
            continue
        digest = entry.get("sha256")
        actual_digest = hashlib.sha256(raw).hexdigest()
        if not isinstance(digest, str) or actual_digest != digest:
            violations.append("result archive fixture sha256 does not match manifest")
        elif actual_digest != release_digests.get(agent):
            violations.append(
                "result archive fixture sha256 is not pinned to Bot release"
            )
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            violations.append("result archive fixture JSON is malformed")
            continue
        _check_result_archive_fixture(agent, payload, violations)


def _check_result_archive_fixture(
    agent: str, payload: Any, violations: list[str]
) -> None:
    if not isinstance(payload, dict):
        violations.append("result archive fixture must be an object")
        return
    if payload.get("agent") != agent:
        violations.append("result archive fixture agent is not canonical")
    if "artifacts" in payload:
        violations.append("result archive fixture contains top-level legacy artifacts")
    if "delivery_internal" in set(_iter_keys(payload)):
        violations.append("result archive fixture contains private delivery fields")

    result = payload.get("result")
    if not isinstance(result, dict):
        violations.append("result archive fixture result must be an object")
        return
    if "artifacts" in result:
        violations.append("result archive fixture contains legacy artifacts")
    execution = result.get("execution")
    if not isinstance(execution, dict):
        violations.append("result archive fixture execution must be an object")
        return
    delivery = execution.get("delivery")
    if not isinstance(delivery, dict):
        violations.append("result archive fixture execution delivery must be an object")
        return
    if set(delivery) != RESULT_ARCHIVE_DELIVERY_FIELDS:
        violations.append("result archive fixture delivery fields are invalid")
        return
    if delivery.get("schema_version") != RESULT_ARCHIVE_PROTOCOL_VERSION:
        violations.append("result archive fixture delivery protocol_version must be 1")
    if delivery.get("required") is not True or delivery.get("status") != "ready":
        violations.append("result archive fixture delivery must be required and ready")
    if type(delivery.get("revision")) is not int or delivery["revision"] < 1:
        violations.append("result archive fixture delivery revision is invalid")
    inventory_digest = delivery.get("inventory_digest")
    inventory_digest_valid = (
        isinstance(inventory_digest, str)
        and RESULT_ARCHIVE_DIGEST_RE.fullmatch(inventory_digest) is not None
    )
    if not inventory_digest_valid:
        violations.append("result archive fixture delivery digest is invalid")
    if delivery.get("error_code") is not None or delivery.get("retryable") is not False:
        violations.append("result archive fixture ready delivery state is invalid")
    archive = delivery.get("archive")
    if not isinstance(archive, dict):
        violations.append("result archive fixture delivery archive must be an object")
        return
    if set(archive) != RESULT_ARCHIVE_ARCHIVE_FIELDS:
        violations.append("result archive fixture delivery archive fields are invalid")
        return
    if archive.get("role") != "result_archive" or archive.get("name") != f"{agent}-results.zip":
        violations.append("result archive fixture delivery archive identity is invalid")
    if archive.get("media_type") != "application/zip" or archive.get("downloadable") is not True or archive.get("report_context_eligible") is not False:
        violations.append("result archive fixture delivery archive metadata is invalid")
    if type(archive.get("size_bytes")) is not int or archive["size_bytes"] <= 0:
        violations.append("result archive fixture delivery archive size_bytes is invalid")
    download_ref = archive.get("download_ref")
    if (
        not isinstance(download_ref, str)
        or RESULT_ARCHIVE_DOWNLOAD_REF_RE.fullmatch(download_ref) is None
    ):
        violations.append("result archive fixture delivery archive download_ref is unsafe")
    elif inventory_digest_valid and download_ref.removeprefix(
        "result-archive:"
    ) != inventory_digest:
        violations.append(
            "result archive fixture inventory_digest and download_ref do not match"
        )
    artifacts = execution.get("artifacts")
    if not isinstance(artifacts, list):
        violations.append("result archive fixture execution artifacts must be a list")
    elif sum(isinstance(item, dict) and item.get("role") == "result_archive" for item in artifacts) != 0:
        violations.append("result archive fixture must contain exactly one archive")


def _load_manifest(root: Path, violations: list[str]) -> dict[str, Any] | None:
    raw = _read_bytes(root, MANIFEST_REL, violations)
    if raw is None:
        return None
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        violations.append("invalid compatibility manifest JSON")
        return None
    violations.extend(validate_manifest(value))
    return value if isinstance(value, dict) else None


def _sanitize_failure(message: str) -> str:
    compact = " ".join(str(message).split())
    compact = "".join(
        character if 0x20 <= ord(character) <= 0x7E else "?"
        for character in compact
    )
    if len(compact) > MAX_FAILURE_LENGTH:
        return compact[: MAX_FAILURE_LENGTH - 1] + "…"
    return compact


def check(root: Path) -> list[str]:
    """Return bounded, deterministic violations for a checkout."""

    root = root.resolve()
    violations: list[str] = []
    manifest = _load_manifest(root, violations)
    _check_fixtures(root, manifest, violations)

    source_text: dict[str, str] = {}
    for name, relative in SCOPED_FILES.items():
        text = _read_text(root, relative, violations)
        if text is not None:
            source_text[name] = text

    _check_agent_maps(source_text, violations)
    if "feature_config" in source_text:
        _check_default_off_flags(source_text["feature_config"], violations)
    _check_web_feature_defaults(source_text, violations)

    # Keep output bounded even if a malformed checkout causes several related
    # checks to fail at once. The full payloads are never included.
    return [_sanitize_failure(item) for item in violations[:MAX_FAILURE_LINES]]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=ROOT,
        help="repository root (defaults to the checkout containing this script)",
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
