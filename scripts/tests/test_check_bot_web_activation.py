"""Tests for the fail-closed Bot/Web activation evidence gate."""

from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path
from typing import Any, NotRequired, TypedDict

import pytest

from scripts import check_bot_web_activation as checker


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
RESEARCH_INPUT_FIXTURE_PATH = Path(
    "apps/server/external/bot/testdata/head/research_input_resolution_v1.json"
)
RESEARCH_FORMAT_SOURCE_PATH = Path(
    "apps/server/service/api_service/attachment_classifier.go"
)
RESEARCH_LIMIT_SOURCE_PATH = Path("apps/server/external/bot/input_limits.go")
RESEARCH_CONTRACT_SOURCE_PATH = Path(
    "apps/server/external/bot/research_input_contract.go"
)


class MatrixValue(TypedDict):
    schema_version: int
    feature_flags: dict[str, bool]
    rows: list[dict[str, str]]
    rollback: list[str]
    local_readiness: NotRequired[dict[str, object]]


def row_rows(status: str = "External Pending") -> list[dict[str, str]]:
    return [
        {
            "id": row_id,
            "status": status,
            "fixture_id": "",
            "fixture_sha256": "",
        }
        for row_id in ROW_IDS
    ]


def matrix_value(
    *,
    rows: list[dict[str, str]] | None = None,
    flags: dict[str, bool] | None = None,
    rollback: list[str] | None = None,
    schema_version: int = 1,
) -> MatrixValue:
    return {
        "schema_version": schema_version,
        "feature_flags": {
            "expert": False,
            "stream": False,
            "a2ui": False,
            "history_dual_read": False,
            **(flags or {}),
        },
        "rows": row_rows() if rows is None else rows,
        "rollback": checker.ROLLBACK_MARKERS.copy() if rollback is None else rollback,
    }


def matrix_text(value: MatrixValue) -> str:
    return "\n".join(
        (
            "# Bot/Web activation matrix",
            checker.MATRIX_JSON_START,
            "```json",
            json.dumps(value, indent=2),
            "```",
            checker.MATRIX_JSON_END,
        )
    )


def write(root: Path, relative: str, value: object) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(value, str):
        path.write_text(value, encoding="utf-8")
    else:
        path.write_text(json.dumps(value), encoding="utf-8")


def research_input_fixture_payload() -> dict[str, object]:
    return json.loads(
        (checker.ROOT / RESEARCH_INPUT_FIXTURE_PATH).read_text(encoding="utf-8")
    )


def research_row(payload: dict[str, Any]) -> dict[str, Any]:
    return next(row for row in payload["data"] if row.get("slug") == "research")


def research_datasets(payload: dict[str, Any]) -> dict[str, Any]:
    return research_row(payload)["capabilities"]["attachments"]["datasets"]


def write_accepted_research_contract(root: Path) -> None:
    fixture = root / RESEARCH_INPUT_FIXTURE_PATH
    fixture.parent.mkdir(parents=True, exist_ok=True)
    fixture.write_bytes((checker.ROOT / RESEARCH_INPUT_FIXTURE_PATH).read_bytes())
    for relative in (RESEARCH_LIMIT_SOURCE_PATH, RESEARCH_CONTRACT_SOURCE_PATH):
        write(
            root,
            relative.as_posix(),
            (checker.ROOT / relative).read_text(encoding="utf-8"),
        )


def research_format_source() -> str:
    return """
var archiveAttachmentSuffixes = map[string]struct{}{
    ".zip": {}, ".tar": {}, ".tgz": {}, ".gz": {}, ".bgzf": {},
    ".bz2": {}, ".xz": {}, ".zst": {}, ".7z": {}, ".rar": {},
}
var datasetAttachmentSuffixes = map[string]struct{}{
    ".csv": {}, ".mtx": {},
}
"""


def minimal_tree(tmp_path: Path, value: MatrixValue | None = None) -> Path:
    root = tmp_path
    write(
        root,
        checker.MATRIX_REL.as_posix(),
        matrix_text(matrix_value() if value is None else value),
    )
    for relative, content in checker.DEFAULT_CHECK_FILES.items():
        write(root, relative.as_posix(), content)
    write_accepted_research_contract(root)
    write(root, RESEARCH_FORMAT_SOURCE_PATH.as_posix(), research_format_source())
    return root


def local_readiness_matrix_value() -> MatrixValue:
    value = matrix_value()
    value["local_readiness"] = {
        "rc_web_004": {
            "fixture_ids": list(checker.PRODUCT_FIXTURE_IDS),
            "shared_report_surface_test": checker.SHARED_REPORT_SURFACE_TEST.as_posix(),
        }
    }
    return value


def product_fixture_payload(fixture_id: str) -> dict[str, object]:
    agent = checker.PRODUCT_FIXTURE_AGENTS[fixture_id]
    return {
        "fixture_id": fixture_id,
        "agent": agent,
        "result": {
            "formatted": {"answer": "synthetic terminal report"},
            "execution": {
                "artifacts": [],
                "delivery": {
                    "schema_version": 1,
                    "required": True,
                    "status": "ready",
                    "revision": 1,
                    "inventory_digest": "sha256:" + "a" * 64,
                    "archive": {
                        "role": "result_archive",
                        "name": f"{agent}-results.zip",
                        "media_type": "application/zip",
                        "size_bytes": 1,
                        "downloadable": True,
                        "report_context_eligible": False,
                        "download_ref": "result-archive:sha256:" + "a" * 64,
                    },
                    "error_code": None,
                    "retryable": False,
                },
                "output_dirs": ["/obs/synthetic/run"],
            },
        },
    }


def local_readiness_tree(tmp_path: Path) -> Path:
    write(
        tmp_path,
        checker.MATRIX_REL.as_posix(),
        matrix_text(local_readiness_matrix_value()),
    )
    for relative, content in checker.DEFAULT_CHECK_FILES.items():
        write(tmp_path, relative.as_posix(), content)
    write_accepted_research_contract(tmp_path)
    write(tmp_path, RESEARCH_FORMAT_SOURCE_PATH.as_posix(), research_format_source())
    for fixture_id, relative in checker.PRODUCT_FIXTURE_PATHS.items():
        write(tmp_path, relative.as_posix(), product_fixture_payload(fixture_id))
    write(
        tmp_path,
        checker.SHARED_REPORT_SURFACE_TEST.as_posix(),
        "\n".join(
            [
                checker.SHARED_REPORT_SURFACE_MARKER,
                *checker.PRODUCT_FIXTURE_IDS,
            ]
        ),
    )
    return tmp_path


def test_activation_requires_external_rows_to_be_reviewed() -> None:
    rows = {"RC-WEB-001": "External Pending", "RC-WEB-002": "Reviewed"}
    assert checker.activation_errors(rows, requested_flags={"stream": True}) == [
        "stream requires RC-WEB-001 through RC-WEB-006 reviewed"
    ]


@pytest.mark.parametrize("flag", ("stream", "expert", "a2ui", "history_dual_read"))
def test_exact_reviewed_evidence_set_allows_requested_flag(flag: str) -> None:
    rows = {row["id"]: "External Pending" for row in row_rows()}
    for row_id in checker.FEATURE_REQUIREMENTS[flag]:
        rows[row_id] = "Reviewed"
    assert checker.activation_errors(rows, requested_flags={flag: True}) == []


@pytest.mark.parametrize("flag", ("a2ui", "history_dual_read"))
def test_a2ui_and_history_require_reviewed_not_only_passed(flag: str) -> None:
    rows = {row["id"]: "External Pending" for row in row_rows()}
    for row_id in checker.FEATURE_REQUIREMENTS[flag]:
        rows[row_id] = "Passed"
    assert checker.activation_errors(rows, requested_flags={flag: True}) == [
        f"{flag} requires {_requirement_label_for_test(flag)} reviewed"
    ]


def _requirement_label_for_test(flag: str) -> str:
    if flag == "a2ui":
        return "RC-WEB-001, RC-WEB-005, and RC-WEB-006"
    return "RC-WEB-001, RC-WEB-002, RC-WEB-003, and RC-WEB-007"


def test_activation_fails_closed_for_missing_duplicate_and_unknown_rows() -> None:
    rows = row_rows()
    rows.pop()
    rows.append({"id": "RC-WEB-001", "status": "Reviewed"})
    assert checker.validate_rows(rows)
    assert checker.validate_rows(
        [*row_rows(), {"id": "RC-WEB-999", "status": "Reviewed"}]
    )


def test_passed_row_requires_fixture_metadata_but_does_not_read_payload() -> None:
    rows = row_rows()
    rows[0] = {
        "id": "RC-WEB-001",
        "status": "Passed",
        "fixture_id": "synthetic-run-identity",
        "fixture_sha256": "a" * 64,
    }
    assert checker.validate_rows(rows) == []
    rows[0]["fixture_sha256"] = "not-a-checksum"
    assert checker.validate_rows(rows)


def test_matrix_schema_status_flags_and_rollback_are_fail_closed(tmp_path: Path) -> None:
    value = matrix_value(schema_version=2)
    root = minimal_tree(tmp_path, value)
    assert any("schema_version" in error for error in checker.check(root))

    value = matrix_value()
    value["feature_flags"]["unknown"] = False
    assert any("feature flag" in error for error in checker.check(minimal_tree(tmp_path, value)))

    value = matrix_value()
    value["rows"][0]["status"] = "Accepted"
    assert any("status" in error for error in checker.check(minimal_tree(tmp_path, value)))

    value = matrix_value(rollback=checker.ROLLBACK_MARKERS[:-1])
    assert any("rollback" in error for error in checker.check(minimal_tree(tmp_path, value)))


def test_committed_matrix_is_dark_and_cli_has_one_stable_pass_line() -> None:
    assert checker.check(checker.ROOT) == []
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        assert checker.main([]) == 0
    assert output.getvalue().strip() == checker.PASS_LINE


@pytest.mark.parametrize(
    ("mutate", "marker"),
    [
        (
            lambda payload: payload["protocols"].pop(
                "research_input_resolution_v1"
            ),
            "research input protocol",
        ),
        (
            lambda payload: payload["protocols"].__setitem__(
                "research_input_resolution_v1", [1, 2]
            ),
            "research input protocol",
        ),
        (
            lambda payload: payload["research_input_resolution"].__setitem__(
                "max_user_query_chars", 131_071
            ),
            "max_user_query_chars",
        ),
        (
            lambda payload: payload["research_input_resolution"].__setitem__(
                "max_attachments_per_request", 63
            ),
            "max_attachments_per_request",
        ),
        (
            lambda payload: payload["research_input_resolution"].__setitem__(
                "max_research_dataset_paths", 63
            ),
            "max_research_dataset_paths",
        ),
        (
            lambda payload: payload["research_input_resolution"].__setitem__(
                "max_research_input_references", 127
            ),
            "max_research_input_references",
        ),
        (
            lambda payload: payload["research_input_resolution"].__setitem__(
                "max_user_query_chars", 1_048_577
            ),
            "max_user_query_chars",
        ),
        (
            lambda payload: payload["research_input_resolution"].__setitem__(
                "max_attachments_per_request", 257
            ),
            "max_attachments_per_request",
        ),
        (
            lambda payload: payload["research_input_resolution"].__setitem__(
                "max_research_dataset_paths", 257
            ),
            "max_research_dataset_paths",
        ),
        (
            lambda payload: payload["research_input_resolution"].__setitem__(
                "max_research_input_references", 257
            ),
            "max_research_input_references",
        ),
        (
            lambda payload: (
                payload["research_input_resolution"].__setitem__(
                    "max_attachments_per_request", 129
                ),
                payload["research_input_resolution"].__setitem__(
                    "max_research_input_references", 128
                ),
            ),
            "reference limit",
        ),
        (
            lambda payload: (
                payload["research_input_resolution"].__setitem__(
                    "max_research_dataset_paths", 129
                ),
                payload["research_input_resolution"].__setitem__(
                    "max_research_input_references", 128
                ),
            ),
            "reference limit",
        ),
        (
            lambda payload: payload["data"][0].__setitem__(
                "tool", "AnalystAgent"
            ),
            "agent descriptor",
        ),
        (
            lambda payload: payload["data"].append(
                {"slug": "future", "tool": "FutureAgent"}
            ),
            "agent descriptor",
        ),
        (
            lambda payload: research_row(payload)["capabilities"]["attachments"][
                "document_context"
            ].__setitem__("max_files", 10),
            "document_context.max_files",
        ),
        (
            lambda payload: research_datasets(payload).__setitem__("max_files", 10),
            "datasets.max_files",
        ),
        (
            lambda payload: research_datasets(payload).__setitem__("max_files", 257),
            "datasets.max_files",
        ),
        (
            lambda payload: research_datasets(payload).__setitem__(
                "max_file_bytes", 0
            ),
            "datasets.max_file_bytes",
        ),
        (
            lambda payload: research_datasets(payload).__setitem__(
                "max_file_bytes", (10 << 30) + 1
            ),
            "datasets.max_file_bytes",
        ),
        (
            lambda payload: research_datasets(payload).__setitem__(
                "max_total_bytes", 26_214_399
            ),
            "datasets.max_total_bytes",
        ),
        (
            lambda payload: (
                research_datasets(payload).__setitem__("max_file_bytes", 1),
                research_datasets(payload).__setitem__("max_total_bytes", 65),
            ),
            "datasets.max_total_bytes",
        ),
        (
            lambda payload: research_datasets(payload)["formats"].remove("mtx"),
            "datasets.formats",
        ),
        (
            lambda payload: research_datasets(payload).__setitem__(
                "formats", ["csv", "mtx"]
            ),
            "datasets.formats",
        ),
    ],
)
def test_checker_rejects_research_input_contract_drift(
    tmp_path: Path, mutate, marker: str
) -> None:
    root = minimal_tree(tmp_path)
    path = root / RESEARCH_INPUT_FIXTURE_PATH
    payload = json.loads(path.read_text(encoding="utf-8"))
    mutate(payload)
    write(root, RESEARCH_INPUT_FIXTURE_PATH.as_posix(), payload)

    errors = checker.check(root)
    assert any(marker in error for error in errors)


def test_checker_compares_fixture_formats_with_web_source(tmp_path: Path) -> None:
    root = minimal_tree(tmp_path)
    write(
        root,
        RESEARCH_FORMAT_SOURCE_PATH.as_posix(),
        research_format_source().replace(
            '".mtx": {},', '".mtx": {}, ".notadvertised": {},'
        ),
    )

    errors = checker.check(root)
    assert any("datasets.formats" in error for error in errors)


def test_checker_does_not_accept_commented_go_format(tmp_path: Path) -> None:
    root = minimal_tree(tmp_path)
    write(
        root,
        RESEARCH_FORMAT_SOURCE_PATH.as_posix(),
        research_format_source().replace(
            '".csv": {}, ".mtx": {},',
            '".csv": {}, // ".mtx": {},',
        ),
    )

    errors = checker.check(root)
    assert any("Research format maps" in error for error in errors)


@pytest.mark.parametrize(
    ("relative", "accepted", "drifted"),
    [
        (
            RESEARCH_LIMIT_SOURCE_PATH,
            "DefaultMaxUserQueryChars          = 131_072",
            "DefaultMaxUserQueryChars = 131_073",
        ),
        (
            RESEARCH_LIMIT_SOURCE_PATH,
            "HardMaxUserQueryChars             = 1_048_576",
            "HardMaxUserQueryChars = 1_048_577",
        ),
        (
            RESEARCH_LIMIT_SOURCE_PATH,
            "DefaultMaxAssetAttachmentRefs     = 64",
            "DefaultMaxAssetAttachmentRefs = 65",
        ),
        (
            RESEARCH_LIMIT_SOURCE_PATH,
            "HardMaxAssetAttachmentRefs        = 256",
            "HardMaxAssetAttachmentRefs = 257",
        ),
        (
            RESEARCH_LIMIT_SOURCE_PATH,
            "DefaultMaxResearchDatasetPaths    = 64",
            "DefaultMaxResearchDatasetPaths = 65",
        ),
        (
            RESEARCH_LIMIT_SOURCE_PATH,
            "HardMaxResearchDatasetPaths       = 256",
            "HardMaxResearchDatasetPaths = 257",
        ),
        (
            RESEARCH_LIMIT_SOURCE_PATH,
            "DefaultMaxResearchInputReferences = 128",
            "DefaultMaxResearchInputReferences = 129",
        ),
        (
            RESEARCH_LIMIT_SOURCE_PATH,
            "HardMaxResearchInputReferences    = 256",
            "HardMaxResearchInputReferences = 257",
        ),
        (
            RESEARCH_CONTRACT_SOURCE_PATH,
            'ResearchInputProtocol        = "research_input_resolution_v1"',
            'ResearchInputProtocol = "research_input_resolution_v2"',
        ),
        (
            RESEARCH_CONTRACT_SOURCE_PATH,
            "ResearchInputProtocolVersion = 1",
            "ResearchInputProtocolVersion = 2",
        ),
        (
            RESEARCH_CONTRACT_SOURCE_PATH,
            "maxResearchDatasetFormats    = 256",
            "maxResearchDatasetFormats = 257",
        ),
        (
            RESEARCH_CONTRACT_SOURCE_PATH,
            "maxResearchDatasetFormatSize = 64",
            "maxResearchDatasetFormatSize = 65",
        ),
        (
            RESEARCH_CONTRACT_SOURCE_PATH,
            '"rar": {},',
            '// "rar": {},',
        ),
    ],
)
def test_checker_rejects_web_research_go_contract_source_drift(
    tmp_path: Path, relative: Path, accepted: str, drifted: str
) -> None:
    root = minimal_tree(tmp_path)
    path = root / relative
    source = path.read_text(encoding="utf-8")
    assert source.count(accepted) == 1
    replacement = f"// accepted spelling: {accepted}\n\t{drifted}"
    path.write_text(source.replace(accepted, replacement), encoding="utf-8")

    errors = checker.check(root)
    assert any("Research Go contract" in error for error in errors)


def test_checker_rejects_semantically_equivalent_research_fixture_bytes(
    tmp_path: Path,
) -> None:
    root = minimal_tree(tmp_path)
    path = root / RESEARCH_INPUT_FIXTURE_PATH
    before = path.read_bytes()
    after = before + b"\n"
    assert json.loads(before) == json.loads(after)
    path.write_bytes(after)

    errors = checker.check(root)
    assert any("Research fixture SHA-256" in error for error in errors)


@pytest.mark.parametrize(
    ("mutate", "marker"),
    [
        (
            lambda payload: payload["result"].__setitem__("artifacts", []),
            "legacy artifacts",
        ),
        (
            lambda payload: payload["result"]["execution"]["delivery"].__setitem__(
                "delivery_internal", {"secret": "not-for-output"}
            ),
            "private delivery",
        ),
        (
            lambda payload: payload["result"]["execution"]["delivery"]["archive"].__setitem__(
                "size_bytes", 0
            ),
            "size_bytes",
        ),
    ],
)
def test_local_readiness_rejects_legacy_or_private_delivery_shapes(
    tmp_path: Path, mutate, marker: str
) -> None:
    root = local_readiness_tree(tmp_path)
    fixture_id = checker.PRODUCT_FIXTURE_IDS[0]
    path = root / checker.PRODUCT_FIXTURE_PATHS[fixture_id]
    payload = json.loads(path.read_text(encoding="utf-8"))
    mutate(payload)
    write(root, checker.PRODUCT_FIXTURE_PATHS[fixture_id].as_posix(), payload)

    errors = checker.check(root)
    assert any(marker in error for error in errors)
    assert all("not-for-output" not in error for error in errors)


def test_cli_failure_is_bounded_and_does_not_echo_raw_content(tmp_path: Path) -> None:
    value = matrix_value()
    value["rows"][0]["fixture_id"] = "raw answer body"
    root = minimal_tree(tmp_path, value)
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        assert checker.main(["--root", str(root)]) != 0
    text = output.getvalue()
    assert "raw-answer-body-not-allowed" not in text
    assert all(len(line) <= checker.MAX_FAILURE_LENGTH for line in text.splitlines())


def test_checker_rejects_out_of_scope_matrix_symlink(tmp_path: Path) -> None:
    outside = tmp_path.parent / "activation-matrix-outside.md"
    outside.write_text(matrix_text(matrix_value()), encoding="utf-8")
    try:
        matrix_path = tmp_path / checker.MATRIX_REL
        matrix_path.parent.mkdir(parents=True, exist_ok=True)
        matrix_path.symlink_to(outside)
        for relative, content in checker.DEFAULT_CHECK_FILES.items():
            write(tmp_path, relative.as_posix(), content)
        assert any("out-of-scope" in error for error in checker.check(tmp_path))
    finally:
        outside.unlink(missing_ok=True)


def test_cli_rejects_reversed_matrix_markers_without_traceback(tmp_path: Path) -> None:
    write(
        tmp_path,
        checker.MATRIX_REL.as_posix(),
        f"{checker.MATRIX_JSON_END}\n{checker.MATRIX_JSON_START}\n{{}}",
    )
    for relative, content in checker.DEFAULT_CHECK_FILES.items():
        write(tmp_path, relative.as_posix(), content)

    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        assert checker.main(["--root", str(tmp_path)]) != 0
    text = output.getvalue()
    assert text.startswith(f"{checker.FAIL_LINE}\n")
    assert "Traceback" not in text
    assert all(len(line) <= checker.MAX_FAILURE_LENGTH for line in text.splitlines())


def test_cli_rejects_deeply_nested_matrix_without_traceback(tmp_path: Path) -> None:
    nested_json = "[" * 10_000 + "0" + "]" * 10_000
    write(
        tmp_path,
        checker.MATRIX_REL.as_posix(),
        "\n".join(
            (
                checker.MATRIX_JSON_START,
                "```json",
                nested_json,
                "```",
                checker.MATRIX_JSON_END,
            )
        ),
    )
    for relative, content in checker.DEFAULT_CHECK_FILES.items():
        write(tmp_path, relative.as_posix(), content)

    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        assert checker.main(["--root", str(tmp_path)]) != 0
    text = output.getvalue()
    assert text.startswith(f"{checker.FAIL_LINE}\n")
    assert "Traceback" not in text
    assert len(text.splitlines()) <= checker.MAX_FAILURE_LINES + 1
    assert all(len(line) <= checker.MAX_FAILURE_LENGTH for line in text.splitlines())


def test_checker_rejects_root_symlink_into_forbidden_checkout(tmp_path: Path) -> None:
    target = tmp_path / "Phytomni-Bot"
    minimal_tree(target)
    alias = tmp_path / "web-alias"
    alias.symlink_to(target, target_is_directory=True)

    errors = checker.check(alias)
    assert errors == ["refusing to read out-of-scope activation root"]


def test_history_default_check_ignores_comments_and_dead_markers() -> None:
    source = dict(checker.DEFAULT_CHECK_FILES)
    source[Path("apps/server/service/api_service/bot_capabilities.go")] = """
func HistoryReadModeFromConfig() HistoryReadMode {
    // if viper.GetBool("bot.history_dual_read") {
    //     return HistoryReadModeDual
    // }
    if false {
        return HistoryReadModeLegacy
    }
    return HistoryReadModeDual
}
"""

    violations: list[str] = []
    checker._check_defaults(source, violations)
    assert "history_dual_read default must remain legacy/off" in violations


def test_default_check_rejects_duplicate_yaml_and_web_defaults() -> None:
    source = dict(checker.DEFAULT_CHECK_FILES)
    source[Path("apps/server/config/app.yml.example")] = """
bot:
  expert_enabled: false
  expert_enabled: true
  stream_enabled: false
  a2ui_actions_enabled: false
  research_enabled: false
  design_enabled: false
  network_enabled: false
"""
    source[Path("apps/web/src/stores/user.ts")] = """
const state = {
  expertEnabled: false,
  expertEnabled: true,
}
"""

    violations: list[str] = []
    checker._check_defaults(source, violations)
    assert "expert_enabled default must be false" in violations
    assert "Web expertEnabled default must be false" in violations


def test_default_check_rejects_true_or_duplicate_product_flags() -> None:
    source = dict(checker.DEFAULT_CHECK_FILES)
    source[Path("apps/server/config/app.yml.example")] = """
bot:
  expert_enabled: false
  stream_enabled: false
  a2ui_actions_enabled: false
  research_enabled: true
  design_enabled: false
  network_enabled: false
  network_enabled: false
"""

    violations: list[str] = []
    checker._check_defaults(source, violations)
    assert "research_enabled default must be false" in violations
    assert "network_enabled default must be false" in violations


def test_checker_rejects_true_or_duplicate_product_flags_in_temp_root(tmp_path: Path) -> None:
    root = local_readiness_tree(tmp_path)
    config_path = root / "apps/server/config/app.yml.example"
    config_path.write_text(
        config_path.read_text(encoding="utf-8")
        + "  design_enabled: true\n"
        + "  design_enabled: false\n",
        encoding="utf-8",
    )

    errors = checker.check(root)
    assert "design_enabled default must be false" in errors


def test_checker_rejects_deep_forbidden_fixture_field_in_temp_root(tmp_path: Path) -> None:
    root = local_readiness_tree(tmp_path)
    fixture_id = checker.PRODUCT_FIXTURE_IDS[0]
    payload = product_fixture_payload(fixture_id)
    cursor: dict[str, object] = payload
    for _ in range(40):
        nested: dict[str, object] = {}
        cursor["nested"] = nested
        cursor = nested
    cursor["raw"] = "must not be echoed"
    write(root, checker.PRODUCT_FIXTURE_PATHS[fixture_id].as_posix(), payload)

    errors = checker.check(root)
    assert "RC-WEB-004 product fixture nesting exceeds scanner bound" in errors
    assert all("must not be echoed" not in error for error in errors)


def test_web_expert_default_ignores_comments_and_string_literals() -> None:
    source = dict(checker.DEFAULT_CHECK_FILES)
    source[Path("apps/web/src/stores/user.ts")] = """
/*
expertEnabled: false
*/
const quoted = "expertEnabled: false"
const template = `
expertEnabled: false
`
"""

    violations: list[str] = []
    checker._check_defaults(source, violations)
    assert "Web expertEnabled default must be false" in violations


def test_web_expert_default_ignores_regex_literal_marker() -> None:
    source = dict(checker.DEFAULT_CHECK_FILES)
    source[Path("apps/web/src/stores/user.ts")] = (
        "const marker = /expertEnabled: false/;\n"
    )

    violations: list[str] = []
    checker._check_defaults(source, violations)
    assert "Web expertEnabled default must be false" in violations

    violations = []
    checker._check_defaults(dict(checker.DEFAULT_CHECK_FILES), violations)
    assert "Web expertEnabled default must be false" not in violations


def test_history_default_ignores_fake_function_inside_go_raw_string() -> None:
    source = dict(checker.DEFAULT_CHECK_FILES)
    source[Path("apps/server/service/api_service/bot_capabilities.go")] = r'''
var fake = `
func HistoryReadModeFromConfig() HistoryReadMode {
    if viper.GetBool("bot.history_dual_read") {
        return HistoryReadModeDual
    }
    return HistoryReadModeLegacy
}
`
'''

    violations: list[str] = []
    checker._check_defaults(source, violations)
    assert "history_dual_read default must remain legacy/off" in violations


def test_history_default_accepts_real_safe_function_with_comments() -> None:
    source = dict(checker.DEFAULT_CHECK_FILES)
    source[Path("apps/server/service/api_service/bot_capabilities.go")] = r'''
// This comment must not affect the executable declaration.
func HistoryReadModeFromConfig() HistoryReadMode {
    // Preserve the explicit Web-owned Viper switch.
    if viper.GetBool("bot.history_dual_read") {
        return HistoryReadModeDual
    }
    return HistoryReadModeLegacy
}
'''

    violations: list[str] = []
    checker._check_defaults(source, violations)
    assert "history_dual_read default must remain legacy/off" not in violations


def test_yaml_block_scalar_does_not_count_as_executable_default() -> None:
    source = dict(checker.DEFAULT_CHECK_FILES)
    source[Path("apps/server/config/app.yml.example")] = """
bot:
  notes: |
    expert_enabled: false
  stream_enabled: false
  a2ui_actions_enabled: false
  research_enabled: false
  design_enabled: false
  network_enabled: false
"""

    violations: list[str] = []
    checker._check_defaults(source, violations)
    assert "expert_enabled default must be false" in violations


def test_requested_unknown_flag_is_rejected_without_echoing_value() -> None:
    errors = checker.activation_errors({}, requested_flags={"private_payload": True})
    assert errors == ["unknown feature flag"]
