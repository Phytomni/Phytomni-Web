#!/usr/bin/env python3
"""Fail while any superseded execution responsibility remains reachable."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]

# These names belong to the request-owned/V1 write stack. Historical DTOs and
# read decoders may remain, but no production source may call or define these
# responsibilities after V2 convergence.
_LEGACY_RESPONSIBILITIES: dict[str, re.Pattern[str]] = {
    "request_or_read_owned_projection": re.compile(
        r"\b(?:SaveBotRunProjection|saveBotRunProjectionForRun|"
        r"applyBotRunProjection|persistExecutionAdmissionState|"
        r"persistExecutionState|QueryAnalystUpdateLog)\b"
    ),
    "read_driven_reconciliation": re.compile(r"\bSyncBotRuns\b"),
    "legacy_execution_selector": re.compile(
        r"\b(?:WebAsyncAdmissionEnabled|asyncAdmission)\b"
    ),
    "legacy_run_live_stream": re.compile(
        r"\b(?:openExecutionEventStream|attachLive)\b|"
        r"/runs/[^\"'`\s]+/events/stream"
    ),
}

_SUPERSEDED_FILES = (
    "apps/server/service/api_service/agent_task_bot.go",
    "apps/web/src/views/chat/composables/useStreamMessage.ts",
    "apps/web/src/views/chat/streaming/sendBranch.ts",
    "apps/web/src/views/chat/components/PendingExecutionActivity.vue",
    "apps/web/src/views/chat/components/PendingExecutionRail.vue",
    "apps/web/src/views/chat/components/SendProgress.vue",
    "apps/web/src/views/chat/utils/agentProgress.ts",
)

_CLIENT_TURN_MINT = re.compile(
    r'["\']turn-["\']\s*\+\s*uuid\.NewString\(\)'
)
_CANONICAL_CLIENT_TURN_MINT = "apps/server/service/api_service/query.go"

_REQUIRED_V2_OWNERSHIP: dict[str, re.Pattern[str]] = {
    "apps/web/src/views/chat/ChatView.vue": re.compile(
        r"<ExecutionActivityPanel\b"
    ),
    "apps/web/src/views/chat/composables/useChatAgentRunLifecycle.ts": re.compile(
        r"if\s*\(message\.executionId\)\s*return null"
    ),
    "apps/web/src/views/chat/composables/useRemoteAgentLifecycle.ts": re.compile(
        r"executionEvents\.attachExecution\(dialogueId, executionId\)"
    ),
    "apps/web/src/views/chat/composables/useBotRemoteAgentRun.ts": re.compile(
        r'formData\.append\("client_turn_id", clientTurnId\)'
    ),
}

_V2_HISTORY_PATH = (
    "apps/server/service/api_service/conversation_history_v2.go"
)
_V2_HISTORY_AGGREGATE = re.compile(
    r"\b(?:QuestionAgentLog|query_agent_logs)\b"
)
_EXECUTION_EVENTS_PATH = (
    "apps/web/src/views/chat/composables/useExecutionEvents.ts"
)
_EXECUTION_OUTPUT_BRIDGE = re.compile(
    r"projectRunToAssistantMessage[\s\S]+content:\s*"
    r"(?:[\w$]+\?\.content\s*\?\?\s*)?run\.outputText"
)
_EXECUTION_SUBSCRIPTION_REGISTRY = re.compile(
    r"new\s+Map\s*<\s*string\s*,\s*ExecutionSubscription\s*>"
)
_TIMELINE_REFERENCE = re.compile(r"\bConversationMessageV2\b")
_TIMELINE_ALLOWED_PATHS = {
    "apps/server/service/api_service/execution_runtime_v2.go",
    # Owns only the Web-side replacement boundary: a refresh retires the prior
    # visible shell before execution_runtime_v2 creates the new ordered pair.
    "apps/server/service/api_service/conversation_turn_v2.go",
    "apps/server/service/api_service/execution_workers_v2.go",
    # These two write only Web-owned pre-dispatch/operator terminal outcomes;
    # Bot-derived message/activity facts remain projector-owned.
    "apps/server/service/api_service/execution_gateway_v2.go",
    "apps/server/service/api_service/execution_operator_v2.go",
    # Owns user-authorized conversation retention only: a conversation delete
    # soft-deletes its ordered V2 items. It never projects Bot-derived facts.
    "apps/server/service/api_service/agent_task.go",
    # Pure compatibility read: counts already-projected assistant items when
    # formatting the legacy numeric lifecycle DTO; it performs no mutation.
    "apps/server/service/api_service/agent_task_lifecycle.go",
    _V2_HISTORY_PATH,
}
_TIMELINE_RESTRICTED_PATHS = {
    "apps/server/service/api_service/agent_task.go": "metadata_only",
    "apps/server/service/api_service/agent_task_lifecycle.go": "read_only",
}
_TIMELINE_MODEL_CHAIN = re.compile(
    r"Model\(\s*&model\.ConversationMessageV2\{\}\s*\)"
    r"(?P<body>[\s\S]{0,1200}?)(?:\.Error|;\s*err)"
)
_TIMELINE_MUTATION = re.compile(
    r"\.(?:Create|Save|Update|Updates|Delete)\s*\("
)
_BOT_DERIVED_MESSAGE_FIELD = re.compile(
    r'["\'](?:content|content_revision|content_offset|content_length|'
    r'content_sha256|source_event_id|target_json|message_type|role|status)["\']'
)
_V2_BOT_DERIVED_PATHS = {
    "apps/server/service/api_service/execution_workers_v2.go",
    "apps/server/service/api_service/execution_gateway_v2.go",
    "apps/server/service/api_service/execution_operator_v2.go",
}
_LEGACY_HISTORY_REFERENCE = re.compile(r"\bQuestionAgentLog\b")
_V2_ADMISSION_PATH = (
    "apps/server/service/api_service/execution_runtime_v2.go"
)
_LEGACY_ADMISSION_WRITE = re.compile(
    r"\ballocateOwnerSubmissionWithDB\b|"
    r"\b(?:Create|Save)\s*\(\s*&?(?:model\.)?QuestionAgentLog\b"
)


def inventory(root: Path = ROOT) -> dict[str, Any]:
    occurrences: dict[str, list[str]] = {
        name: [] for name in _LEGACY_RESPONSIBILITIES
    }
    client_turn_mints: list[str] = []
    aggregate_history_references: list[str] = []
    timeline_writer_references: list[str] = []
    restricted_timeline_violations: list[str] = []
    legacy_bot_derived_references: list[str] = []
    legacy_admission_writes: list[str] = []
    subscription_registries: list[str] = []
    execution_output_bridge: bool | None = None
    for source_root, suffix in (
        (root / "apps/server", "*.go"),
        (root / "apps/web/src", "*.ts"),
        (root / "apps/web/src", "*.vue"),
    ):
        if not source_root.exists():
            continue
        for path in sorted(source_root.rglob(suffix)):
            if path.name.endswith(("_test.go", ".spec.ts")):
                continue
            relative = path.relative_to(root).as_posix()
            source = path.read_text(encoding="utf-8")
            if relative == _V2_HISTORY_PATH and _V2_HISTORY_AGGREGATE.search(
                source
            ):
                aggregate_history_references.append(relative)
            if (
                relative.startswith("apps/server/service/api_service/")
                and _TIMELINE_REFERENCE.search(source)
                and relative not in _TIMELINE_ALLOWED_PATHS
            ):
                timeline_writer_references.append(relative)
            restriction = _TIMELINE_RESTRICTED_PATHS.get(relative)
            if restriction:
                for match in _TIMELINE_MODEL_CHAIN.finditer(source):
                    chain = match.group("body")
                    if restriction == "read_only" and _TIMELINE_MUTATION.search(chain):
                        restricted_timeline_violations.append(
                            f"{relative}: read-only adapter mutates ordered messages"
                        )
                    if (
                        restriction == "metadata_only"
                        and _TIMELINE_MUTATION.search(chain)
                        and _BOT_DERIVED_MESSAGE_FIELD.search(chain)
                    ):
                        restricted_timeline_violations.append(
                            f"{relative}: metadata adapter writes Bot-derived message fields"
                        )
            if (
                relative in _V2_BOT_DERIVED_PATHS
                and _LEGACY_HISTORY_REFERENCE.search(source)
            ):
                legacy_bot_derived_references.append(relative)
            if (
                relative == _V2_ADMISSION_PATH
                and _LEGACY_ADMISSION_WRITE.search(source)
            ):
                legacy_admission_writes.append(relative)
            subscription_registries.extend(
                relative
                for _ in _EXECUTION_SUBSCRIPTION_REGISTRY.finditer(source)
            )
            if relative == _EXECUTION_EVENTS_PATH:
                execution_output_bridge = bool(
                    _EXECUTION_OUTPUT_BRIDGE.search(source)
                )
            client_turn_mints.extend(
                relative for _ in _CLIENT_TURN_MINT.finditer(source)
            )
            for name, pattern in _LEGACY_RESPONSIBILITIES.items():
                if name == "legacy_run_live_stream" and not relative.startswith(
                    "apps/web/src/"
                ):
                    continue
                if pattern.search(source):
                    occurrences[name].append(relative)
    required_v2_ownership = {}
    for relative, pattern in _REQUIRED_V2_OWNERSHIP.items():
        path = root / relative
        if path.exists():
            required_v2_ownership[relative] = bool(
                pattern.search(path.read_text(encoding="utf-8"))
            )
    return {
        "schema_version": 2,
        "legacy_responsibilities": occurrences,
        "superseded_files": [
            relative
            for relative in _SUPERSEDED_FILES
            if (root / relative).exists()
        ],
        "client_turn_identity_mints": client_turn_mints,
        "required_v2_ownership": required_v2_ownership,
        "aggregate_history_references": aggregate_history_references,
        "timeline_writer_references": timeline_writer_references,
        "restricted_timeline_violations": restricted_timeline_violations,
        "legacy_bot_derived_references": legacy_bot_derived_references,
        "legacy_admission_writes": legacy_admission_writes,
        "subscription_registries": subscription_registries,
        "execution_output_bridge": execution_output_bridge,
    }


def violations(root: Path = ROOT) -> list[str]:
    observed = inventory(root)
    found: list[str] = []
    for responsibility, paths in observed["legacy_responsibilities"].items():
        for path in paths:
            found.append(f"legacy responsibility {responsibility}: {path}")
    for path in observed["superseded_files"]:
        found.append(f"superseded file remains: {path}")
    for path in observed["client_turn_identity_mints"]:
        if path != _CANONICAL_CLIENT_TURN_MINT:
            found.append(f"duplicate client-turn identity mint: {path}")
    if observed["client_turn_identity_mints"].count(
        _CANONICAL_CLIENT_TURN_MINT
    ) > 1:
        found.append(
            "duplicate client-turn identity mint: "
            + _CANONICAL_CLIENT_TURN_MINT
        )
    for path, present in observed["required_v2_ownership"].items():
        if not present:
            found.append(f"missing V2 progress ownership rule: {path}")
    for path in observed["aggregate_history_references"]:
        found.append(f"V2 aggregate history synthesis: {path}")
    if observed["execution_output_bridge"] is False:
        found.append(
            "execution output is not connected to message rendering: "
            + _EXECUTION_EVENTS_PATH
        )
    if len(observed["subscription_registries"]) > 1:
        for path in observed["subscription_registries"]:
            found.append(f"multiple execution subscription registries: {path}")
    for path in observed["timeline_writer_references"]:
        found.append(f"secondary conversation timeline writer: {path}")
    found.extend(observed["restricted_timeline_violations"])
    for path in observed["legacy_bot_derived_references"]:
        found.append(f"V2 Bot-derived fact writes legacy history: {path}")
    for path in observed["legacy_admission_writes"]:
        found.append(f"V2 admission writes legacy history: {path}")
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    payload = inventory(args.root.resolve())
    payload["violations"] = violations(args.root.resolve())
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 1 if payload["violations"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
