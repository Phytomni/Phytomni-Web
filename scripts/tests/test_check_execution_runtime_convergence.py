"""Tests for the zero-duplicate execution-runtime convergence gate."""

from __future__ import annotations

from pathlib import Path

import check_execution_runtime_convergence as checker


def _write(root: Path, relative: str, source: str) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(source, encoding="utf-8")


def test_request_or_read_owned_projection_is_always_rejected(
    tmp_path: Path,
) -> None:
    relative = "apps/server/service/api_service/execution_events.go"
    _write(
        tmp_path,
        relative,
        "package api_service\nfunc read() { persistExecutionState() }\n",
    )

    assert checker.violations(tmp_path) == [
        "legacy responsibility request_or_read_owned_projection: " + relative
    ]


def test_known_source_file_cannot_hide_a_legacy_selector(
    tmp_path: Path,
) -> None:
    relative = "apps/server/service/api_service/query.go"
    _write(
        tmp_path,
        relative,
        "package api_service\nfunc Query() { if WebAsyncAdmissionEnabled() { return } }\n",
    )

    assert checker.violations(tmp_path) == [
        "legacy responsibility legacy_execution_selector: " + relative
    ]


def test_superseded_frontend_execution_module_is_rejected(
    tmp_path: Path,
) -> None:
    relative = "apps/web/src/views/chat/composables/useStreamMessage.ts"
    _write(tmp_path, relative, "export const oldPath = true\n")

    assert checker.violations(tmp_path) == [
        "superseded file remains: " + relative
    ]


def test_superseded_frontend_progress_presenter_is_rejected(
    tmp_path: Path,
) -> None:
    relative = "apps/web/src/views/chat/components/SendProgress.vue"
    _write(tmp_path, relative, "<template><div>legacy progress</div></template>\n")

    assert checker.violations(tmp_path) == [
        "superseded file remains: " + relative
    ]


def test_canonical_activity_panel_is_required_for_chat_progress(
    tmp_path: Path,
) -> None:
    relative = "apps/web/src/views/chat/ChatView.vue"
    _write(tmp_path, relative, "<template><div>local progress</div></template>\n")

    assert checker.violations(tmp_path) == [
        "missing V2 progress ownership rule: " + relative
    ]


def test_legacy_run_addressed_live_stream_is_always_rejected(
    tmp_path: Path,
) -> None:
    relative = "apps/web/src/api/execution-events.ts"
    _write(
        tmp_path,
        relative,
        "export function openExecutionEventStream() { return fetch('/runs/x/events/stream') }\n",
    )

    assert checker.violations(tmp_path) == [
        "legacy responsibility legacy_run_live_stream: " + relative
    ]


def test_client_turn_identity_can_only_be_minted_at_admission_boundary(
    tmp_path: Path,
) -> None:
    relative = "apps/server/http/handler/api_handler/query.go"
    _write(
        tmp_path,
        relative,
        'package api_handler\nfunc query() { id := "turn-" + uuid.NewString() }\n',
    )

    assert checker.violations(tmp_path) == [
        "duplicate client-turn identity mint: " + relative
    ]


def test_execution_owned_chat_message_cannot_reenable_row_polling(
    tmp_path: Path,
) -> None:
    relative = (
        "apps/web/src/views/chat/composables/useChatAgentRunLifecycle.ts"
    )
    _write(tmp_path, relative, "export function synchronize() {}\n")

    assert checker.violations(tmp_path) == [
        "missing V2 progress ownership rule: " + relative
    ]


def test_v2_history_cannot_synthesize_from_legacy_aggregate(
    tmp_path: Path,
) -> None:
    relative = "apps/server/service/api_service/conversation_history_v2.go"
    _write(
        tmp_path,
        relative,
        "package api_service\nfunc history() { _ = model.QuestionAgentLog{} }\n",
    )

    assert checker.violations(tmp_path) == [
        "V2 aggregate history synthesis: " + relative
    ]


def test_execution_output_must_project_into_the_visible_message(
    tmp_path: Path,
) -> None:
    relative = "apps/web/src/views/chat/composables/useExecutionEvents.ts"
    _write(
        tmp_path,
        relative,
        "export function useExecutionEvents() { return run.outputText }\n",
    )

    assert checker.violations(tmp_path) == [
        "execution output is not connected to message rendering: " + relative
    ]


def test_execution_output_bridge_allows_typed_table_projection_fallback(
    tmp_path: Path,
) -> None:
    relative = "apps/web/src/views/chat/composables/useExecutionEvents.ts"
    _write(
        tmp_path,
        relative,
        "function projectRunToAssistantMessage(run: ExecutionRunState) {\n"
        "  const table = decodeTableMessagePresentation(run.outputText);\n"
        "  return { content: table?.content ?? run.outputText };\n"
        "}\n",
    )

    assert checker.violations(tmp_path) == []


def test_only_one_application_execution_subscription_registry_is_allowed(
    tmp_path: Path,
) -> None:
    first = "apps/web/src/views/chat/composables/useExecutionEvents.ts"
    second = "apps/web/src/views/chat/composables/useOtherEvents.ts"
    source = "const subscriptions = new Map<string, ExecutionSubscription>();\n"
    _write(tmp_path, first, source)
    _write(tmp_path, second, source)

    assert checker.violations(tmp_path) == [
        "execution output is not connected to message rendering: " + first,
        "multiple execution subscription registries: " + first,
        "multiple execution subscription registries: " + second,
    ]


def test_secondary_bot_derived_timeline_writer_is_rejected(
    tmp_path: Path,
) -> None:
    relative = "apps/server/service/api_service/another_projector.go"
    _write(
        tmp_path,
        relative,
        "package api_service\nfunc write() { _ = model.ConversationMessageV2{} }\n",
    )

    assert checker.violations(tmp_path) == [
        "secondary conversation timeline writer: " + relative
    ]


def test_lifecycle_read_adapter_cannot_mutate_ordered_messages(
    tmp_path: Path,
) -> None:
    relative = (
        "apps/server/service/api_service/agent_task_lifecycle.go"
    )
    _write(
        tmp_path,
        relative,
        "package api_service\n"
        "func read() { db.Model(&model.ConversationMessageV2{})."
        "Updates(map[string]any{\"status\": \"succeeded\"}).Error }\n",
    )

    assert checker.violations(tmp_path) == [
        relative + ": read-only adapter mutates ordered messages"
    ]


def test_user_metadata_adapter_cannot_write_bot_derived_message_fields(
    tmp_path: Path,
) -> None:
    relative = "apps/server/service/api_service/agent_task.go"
    _write(
        tmp_path,
        relative,
        "package api_service\n"
        "func mutate() { db.Model(&model.ConversationMessageV2{})."
        "Updates(map[string]any{\"content\": \"shadow answer\"}).Error }\n",
    )

    assert checker.violations(tmp_path) == [
        relative + ": metadata adapter writes Bot-derived message fields"
    ]


def test_v2_bot_derived_writer_cannot_update_legacy_history(
    tmp_path: Path,
) -> None:
    relative = "apps/server/service/api_service/execution_workers_v2.go"
    _write(
        tmp_path,
        relative,
        "package api_service\nfunc project() { _ = model.QuestionAgentLog{} }\n",
    )

    assert checker.violations(tmp_path) == [
        "V2 Bot-derived fact writes legacy history: " + relative
    ]


def test_v2_admission_cannot_allocate_a_legacy_aggregate_row(
    tmp_path: Path,
) -> None:
    relative = "apps/server/service/api_service/execution_runtime_v2.go"
    _write(
        tmp_path,
        relative,
        "package api_service\n"
        "func admitExecutionCommand() { allocateOwnerSubmissionWithDB() }\n",
    )

    assert checker.violations(tmp_path) == [
        "V2 admission writes legacy history: " + relative
    ]


def test_current_tree_has_zero_duplicate_execution_responsibilities() -> None:
    assert checker.violations() == []
