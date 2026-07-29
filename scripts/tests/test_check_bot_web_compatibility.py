"""Tests for the offline Bot HEAD/Web compatibility contract gate."""

from __future__ import annotations

import contextlib
import copy
import io
import json
from pathlib import Path

import pytest

import check_bot_web_compatibility as checker


RELEASE_SHA = "7bb00c67155044d6cb83c44c7f8c426c8b968bbd"
RELEASE_AGENTS = [
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
]
REQUIRED_FIXTURES = [
    "chat_completion_run_id",
    "degraded_tracking",
    "deep_genome_revision",
    "review_input_required",
    "conversation_context_v1",
]
ADVERSARIAL_PROSE = (
    "Routine assistant prose contains a sensitive finding without provider markers."
    + " x" * 1000
)


def release_manifest() -> dict[str, object]:
    return {
        "schema_version": 1,
        "bot_commit": RELEASE_SHA,
        "required_agents": RELEASE_AGENTS.copy(),
        "fixtures": REQUIRED_FIXTURES.copy(),
    }


def test_manifest_has_release_pins_and_required_cases():
    manifest = {
        "schema_version": 1,
        "bot_commit": "7bb00c67155044d6cb83c44c7f8c426c8b968bbd",
        "required_agents": [
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
        ],
        "fixtures": [
            "chat_completion_run_id",
            "degraded_tracking",
            "deep_genome_revision",
            "review_input_required",
            "conversation_context_v1",
        ],
    }
    assert checker.validate_manifest(manifest) == []


@pytest.mark.parametrize(
    ("field", "value", "marker"),
    [
        ("bot_commit", "not-a-release", "bot_commit"),
        ("required_agents", RELEASE_AGENTS[:-1], "required_agents"),
        ("required_agents", RELEASE_AGENTS + ["extra"], "required_agents"),
        ("fixtures", REQUIRED_FIXTURES[:-1], "fixtures"),
        ("fixtures", REQUIRED_FIXTURES + ["unknown"], "fixtures"),
    ],
)
def test_manifest_rejects_release_drift(field, value, marker):
    manifest = release_manifest()
    manifest[field] = value
    violations = checker.validate_manifest(manifest)
    assert violations
    assert any(marker in violation for violation in violations)


def test_manifest_rejects_raw_fixture_payloads():
    manifest = release_manifest()
    manifest["fixtures"] = [
        {"id": "chat_completion_run_id", "payload": {"answer": "secret"}},
        *REQUIRED_FIXTURES[1:],
    ]
    violations = checker.validate_manifest(manifest)
    assert any("fixture" in violation and "id" in violation for violation in violations)
    assert all("secret" not in violation for violation in violations)


def test_current_checkout_passes_without_printing_fixture_payloads():
    violations = checker.check(checker.ROOT)
    assert violations == []

    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        assert checker.main([]) == 0
    assert output.getvalue().strip() == checker.PASS_LINE
    assert "Synthetic" not in output.getvalue()
    assert "secret" not in output.getvalue()


def test_conversation_context_fixture_rejects_raw_context_fields(tmp_path: Path):
    source = checker.ROOT / checker.FIXTURE_PATHS["conversation_context_v1"][0]
    payload = json.loads(source.read_text(encoding="utf-8"))
    payload["requests"]["expert_unforced_envelope"]["history_delta"][0][
        "assistant_summary"
    ] = "private"
    fixture_path = tmp_path / checker.FIXTURE_PATHS["conversation_context_v1"][0]
    fixture_path.parent.mkdir(parents=True)
    fixture_path.write_text(json.dumps(payload), encoding="utf-8")

    violations: list[str] = []
    checker._check_fixture(
        tmp_path,
        "conversation_context_v1",
        checker.FIXTURE_PATHS["conversation_context_v1"][0],
        violations,
    )
    assert any("conversation_context_v1" in violation for violation in violations)
    assert all("private" not in violation for violation in violations)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda payload: payload["requests"]["expert_unforced_envelope"]["history_delta"].append(
            {
                "turn_id": "3",
                "role": "assistant",
                "content": ADVERSARIAL_PROSE,
            }
        ),
        lambda payload: payload["requests"]["expert_unforced_envelope"]["history_delta"].append(
            {
                "turn_id": "3",
                "role": "assistant",
                "summary": ADVERSARIAL_PROSE,
            }
        ),
        lambda payload: payload["requests"]["expert_explicit_envelope"].update(
            {"assistant_summary": ADVERSARIAL_PROSE}
        ),
        lambda payload: payload["requests"]["expert_explicit_envelope"].update(
            {"assistant_summaries": [ADVERSARIAL_PROSE]}
        ),
        lambda payload: payload["responses"]["staged_metadata_response"].update(
            {"full_output": ADVERSARIAL_PROSE}
        ),
        lambda payload: payload["responses"]["staged_metadata_response"].update(
            {"answer": ADVERSARIAL_PROSE}
        ),
        lambda payload: payload["responses"]["staged_metadata_response"].update(
            {"final_report": ADVERSARIAL_PROSE}
        ),
        lambda payload: payload["requests"]["expert_unforced_envelope"]["artifact_refs"][0].update(
            {"metadata": {"content": ADVERSARIAL_PROSE}}
        ),
        lambda payload: payload["responses"]["staged_metadata_response"].update(
            {"summary": ADVERSARIAL_PROSE}
        ),
    ],
)
def test_conversation_context_fixture_rejects_valid_shaped_ordinary_raw_text(
    tmp_path: Path, mutate
):
    source = checker.ROOT / checker.FIXTURE_PATHS["conversation_context_v1"][0]
    payload = copy.deepcopy(json.loads(source.read_text(encoding="utf-8")))
    mutate(payload)
    fixture_path = tmp_path / checker.FIXTURE_PATHS["conversation_context_v1"][0]
    fixture_path.parent.mkdir(parents=True)
    fixture_path.write_text(json.dumps(payload), encoding="utf-8")

    violations: list[str] = []
    checker._check_fixture(
        tmp_path,
        "conversation_context_v1",
        checker.FIXTURE_PATHS["conversation_context_v1"][0],
        violations,
    )
    assert violations
    assert all(ADVERSARIAL_PROSE not in violation for violation in violations)
    assert len(violations) <= checker.MAX_FAILURE_LINES
    assert all(len(violation) <= checker.MAX_FAILURE_LENGTH for violation in violations)

    manifest_path = tmp_path / checker.MANIFEST_REL
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(release_manifest()), encoding="utf-8")
    for relative in checker.SCOPED_FILES.values():
        destination = tmp_path / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes((checker.ROOT / relative).read_bytes())
    gate_violations = checker.check(tmp_path)
    assert gate_violations
    assert len(gate_violations) <= checker.MAX_FAILURE_LINES
    assert all(len(violation) <= checker.MAX_FAILURE_LENGTH for violation in gate_violations)
    assert all(ADVERSARIAL_PROSE not in violation for violation in gate_violations)


@pytest.mark.parametrize("fixture_id", ["chat_completion_run_id", "deep_genome_revision"])
def test_legacy_response_fixtures_allow_documented_output_fields(fixture_id: str):
    for relative in checker.FIXTURE_PATHS[fixture_id]:
        violations: list[str] = []
        checker._check_fixture(checker.ROOT, fixture_id, relative, violations)
        assert violations == []


def test_default_off_gate_is_required(tmp_path: Path):
    root = tmp_path
    manifest_path = root / checker.MANIFEST_REL
    manifest_path.parent.mkdir(parents=True)
    manifest_path.write_text(json.dumps(release_manifest()), encoding="utf-8")

    for relative in checker.SCOPED_FILES.values():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        if relative == checker.SCOPED_FILES["web_agents"]:
            path.write_text(
                'export const CANONICAL_AGENT_TOOLS = ["ChatAgent"] as const;\n',
                encoding="utf-8",
            )
        elif relative == checker.SCOPED_FILES["go_agents"]:
            path.write_text('var CanonicalAgentTool = map[string]string{}\n', encoding="utf-8")
        else:
            path.write_text("stream_enabled: true\n", encoding="utf-8")

    violations = checker.check(root)
    assert any("default" in violation and "false" in violation for violation in violations)


def test_current_go_alias_and_query_maps_are_checked(tmp_path: Path):
    root = tmp_path
    manifest_path = root / checker.MANIFEST_REL
    manifest_path.parent.mkdir(parents=True)
    manifest_path.write_text(json.dumps(release_manifest()), encoding="utf-8")

    for name, relative in checker.SCOPED_FILES.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        source = (checker.ROOT / relative).read_text(encoding="utf-8")
        if name == "go_aliases":
            source = source.replace('"ChatAgent":             "chat"', '"ChatAgent":             "knowledge"')
        elif name == "go_query_map":
            source = source.replace('"chat":        "ChatAgent"', '"chat":        "KnowledgeAgent"')
        path.write_text(source, encoding="utf-8")

    violations = checker.check(root)
    assert any("alias-to-slug" in violation for violation in violations)
    assert any("slug-to-tool" in violation for violation in violations)


def test_main_bounds_each_failure_to_one_line(tmp_path: Path):
    root = tmp_path
    manifest_path = root / checker.MANIFEST_REL
    manifest_path.parent.mkdir(parents=True)
    manifest_path.write_text("{}", encoding="utf-8")
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        assert checker.main(["--root", str(root)]) != 0
    lines = output.getvalue().splitlines()
    assert lines[0] == "Bot/Web compatibility contract: FAIL"
    assert all("\n" not in line for line in lines)
    assert len(lines) <= checker.MAX_FAILURE_LINES + 1
