"""Tests for the offline Bot HEAD/Web compatibility contract gate."""

from __future__ import annotations

import contextlib
import copy
import io
import json
import shutil
from pathlib import Path
from typing import Any

import pytest

import check_bot_web_compatibility as checker


RELEASE_SHA = "c58ccdbc69048ca30398fb57008646ff4e51e11e"
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
ARCHIVE_FIXTURE_HASHES = {
    "analyst": "b82b7809bdea88f023e90132a4a361386a3134f01b2b0766356209bdaf379ad8",
    "research": "80199a81f713589511301052ba3f1f78f0529c460a80cc703dae2e7a98150052",
    "network": "ce1cda9d84b7f730715fb9f500c6bc71127ab1fc94aa34b03ed0c36340999f53",
    "design": "43c9628ec27920b52f416c0d6b6056417e28ef0a48910fb810bc18b7c0e1bda2",
}
ADVERSARIAL_PROSE = (
    "Routine assistant prose contains a sensitive finding without provider markers."
    + " x" * 1000
)


def release_manifest() -> dict[str, object]:
    return {
        "schema_version": 2,
        "bot_commit": RELEASE_SHA,
        "required_agents": RELEASE_AGENTS.copy(),
        "fixtures": REQUIRED_FIXTURES.copy(),
        "result_archive_v1": {
            "protocol_version": 1,
            "fixtures": {
                agent: {
                    "path": f"apps/server/external/bot/testdata/head/{agent}_terminal.json",
                    "sha256": digest,
                }
                for agent, digest in ARCHIVE_FIXTURE_HASHES.items()
            },
        },
    }


def test_manifest_has_release_pins_and_required_cases():
    assert checker.validate_manifest(release_manifest()) == []


@pytest.mark.parametrize(
    ("field", "value", "marker"),
    [
        ("bot_commit", "not-a-release", "bot_commit"),
        ("required_agents", RELEASE_AGENTS[:-1], "required_agents"),
        ("required_agents", RELEASE_AGENTS + ["extra"], "required_agents"),
        ("fixtures", REQUIRED_FIXTURES[:-1], "fixtures"),
        ("fixtures", REQUIRED_FIXTURES + ["unknown"], "fixtures"),
        ("result_archive_v1", {}, "result_archive_v1"),
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


def contract_tree(root: Path) -> Path:
    manifest_path = root / checker.MANIFEST_REL
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(release_manifest()), encoding="utf-8")
    for relative in checker.SCOPED_FILES.values():
        destination = root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(checker.ROOT / relative, destination)
    for relative in checker.RESULT_ARCHIVE_FIXTURE_PATHS.values():
        destination = root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(checker.ROOT / relative, destination)
    return root


@pytest.mark.parametrize(
    ("name", "mutate", "marker"),
    [
        ("missing analyst", lambda root: (root / checker.RESULT_ARCHIVE_FIXTURE_PATHS["analyst"]).unlink(), "missing result archive fixture"),
        ("wrong protocol", lambda root: mutate_delivery(root, "analyst", lambda delivery: delivery.__setitem__("schema_version", 2)), "protocol_version"),
        ("legacy artifacts", lambda root: mutate_result(root, "research", lambda result: result.__setitem__("artifacts", [])), "legacy artifacts"),
        ("empty archive", lambda root: mutate_delivery(root, "design", lambda delivery: delivery.__setitem__("archive", None)), "archive"),
        ("second archive", lambda root: mutate_execution(root, "network", add_second_archive), "exactly one archive"),
        ("unsafe reference", lambda root: mutate_archive(root, "research", lambda archive: archive.__setitem__("download_ref", "obs://private/archive.zip")), "download_ref"),
        ("changed hash", lambda root: mutate_manifest_hash(root, "analyst"), "sha256"),
        ("private delivery", lambda root: mutate_delivery(root, "network", lambda delivery: delivery.__setitem__("delivery_internal", {"secret": "not-for-output"})), "private delivery"),
        ("zero size", lambda root: mutate_archive(root, "analyst", lambda archive: archive.__setitem__("size_bytes", 0)), "size_bytes"),
    ],
)
def test_result_archive_contract_rejects_one_mutation_at_a_time(
    tmp_path: Path, name: str, mutate, marker: str
):
    root = contract_tree(tmp_path)
    mutate(root)
    violations = checker.check(root)
    assert any(marker in violation for violation in violations), name
    assert all("not-for-output" not in violation for violation in violations)
    assert all(len(violation) <= checker.MAX_FAILURE_LENGTH for violation in violations)


def archive_fixture(root: Path, agent: str) -> tuple[Path, dict[str, Any]]:
    path = root / checker.RESULT_ARCHIVE_FIXTURE_PATHS[agent]
    return path, json.loads(path.read_text(encoding="utf-8"))


def write_archive_fixture(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload), encoding="utf-8")


def archive_delivery(payload: dict[str, Any]) -> dict[str, Any]:
    result = payload["result"]
    assert isinstance(result, dict)
    execution = result["execution"]
    assert isinstance(execution, dict)
    delivery = execution["delivery"]
    assert isinstance(delivery, dict)
    return delivery


def mutate_delivery(root: Path, agent: str, mutate) -> None:
    path, payload = archive_fixture(root, agent)
    mutate(archive_delivery(payload))
    write_archive_fixture(path, payload)


def mutate_archive(root: Path, agent: str, mutate) -> None:
    def mutate_delivery_archive(delivery: dict[str, Any]) -> None:
        archive = delivery["archive"]
        assert isinstance(archive, dict)
        mutate(archive)

    mutate_delivery(root, agent, mutate_delivery_archive)


def mutate_result(root: Path, agent: str, mutate) -> None:
    path, payload = archive_fixture(root, agent)
    result = payload["result"]
    assert isinstance(result, dict)
    mutate(result)
    write_archive_fixture(path, payload)


def add_second_archive(execution: dict[str, Any]) -> None:
    delivery = execution["delivery"]
    artifacts = execution["artifacts"]
    assert isinstance(delivery, dict)
    assert isinstance(artifacts, list)
    artifacts.append(copy.deepcopy(delivery["archive"]))


def mutate_execution(root: Path, agent: str, mutate) -> None:
    path, payload = archive_fixture(root, agent)
    result = payload["result"]
    assert isinstance(result, dict)
    execution = result["execution"]
    assert isinstance(execution, dict)
    mutate(execution)
    write_archive_fixture(path, payload)


def mutate_manifest_hash(root: Path, agent: str) -> None:
    path = root / checker.MANIFEST_REL
    manifest = json.loads(path.read_text(encoding="utf-8"))
    manifest["result_archive_v1"]["fixtures"][agent]["sha256"] = "0" * 64
    path.write_text(json.dumps(manifest), encoding="utf-8")


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


def test_multiturn_v1_default_off_gate_rejects_enabled(tmp_path: Path):
    root = tmp_path
    manifest_path = root / checker.MANIFEST_REL
    manifest_path.parent.mkdir(parents=True)
    manifest_path.write_text(json.dumps(release_manifest()), encoding="utf-8")

    for name, relative in checker.SCOPED_FILES.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        source = (checker.ROOT / relative).read_text(encoding="utf-8")
        if name == "feature_config":
            source = source.replace(
                "multiturn_v1_enabled: false", "multiturn_v1_enabled: true"
            )
        path.write_text(source, encoding="utf-8")

    violations = checker.check(root)
    assert any("multiturn_v1_enabled" in violation for violation in violations)


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
