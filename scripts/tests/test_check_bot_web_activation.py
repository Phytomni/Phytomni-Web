"""Tests for the fail-closed Bot/Web activation evidence gate."""

from __future__ import annotations

import ast
import base64
import contextlib
import hashlib
import io
import json
import re
import subprocess
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
AGENT_CANONICAL_SOURCE_PATH = Path(
    "apps/server/external/bot/agent_canonical.go"
)
AGENT_MAP_SOURCE_PATH = Path("apps/server/external/bot/agent_map.go")
UPLOAD_CONTRACT_SOURCE_PATH = Path(
    "apps/server/external/bot/upload_contract.go"
)
SOURCE_BINDING_MANIFEST_PATH = Path(
    "apps/web/tests/fixtures/bot-head/contract-manifest.json"
)
PINNED_ACTIVATION_BOT_COMMIT = "0ddeb22894c266b6af537ff0a1b28a42a213ae32"
PINNED_RESEARCH_FIXTURE_BOT_COMMIT = (
    "737ab4f386789cad0ea134c9248bb7c1d2cd454c"
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
    for relative in (
        RESEARCH_LIMIT_SOURCE_PATH,
        RESEARCH_CONTRACT_SOURCE_PATH,
        AGENT_CANONICAL_SOURCE_PATH,
        AGENT_MAP_SOURCE_PATH,
        UPLOAD_CONTRACT_SOURCE_PATH,
    ):
        write(
            root,
            relative.as_posix(),
            (checker.ROOT / relative).read_text(encoding="utf-8"),
        )
    write(
        root,
        SOURCE_BINDING_MANIFEST_PATH.as_posix(),
        json.loads(
            (checker.ROOT / SOURCE_BINDING_MANIFEST_PATH).read_text(encoding="utf-8")
        ),
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


def replace_source_once(
    root: Path, relative: Path, accepted: str, replacement: str
) -> None:
    path = root / relative
    source = path.read_text(encoding="utf-8")
    assert source.count(accepted) == 1
    path.write_text(source.replace(accepted, replacement), encoding="utf-8")


def replace_go_const_value(
    root: Path, relative: Path, name: str, value: str | int
) -> None:
    path = root / relative
    source = path.read_text(encoding="utf-8")
    pattern = re.compile(
        rf"(?m)^(?P<prefix>[ \t]*{re.escape(name)}"
        r"(?:[ \t]+[A-Za-z_][A-Za-z0-9_]*)?[ \t]*=[ \t]*)"
        r"(?P<value>[^\r\n]+?)"
        r"(?P<suffix>[ \t]*)$"
    )
    matches = list(pattern.finditer(source))
    assert len(matches) == 1
    rendered = json.dumps(value) if isinstance(value, str) else str(value)
    match = matches[0]
    path.write_text(
        source[: match.start("value")]
        + rendered
        + source[match.end("value") :],
        encoding="utf-8",
    )


def accepted_go_contract_values(
    root: Path,
) -> tuple[dict[str, int], dict[str, str | int], set[str]]:
    limit_names = tuple(
        name
        for names in checker._RESEARCH_INPUT_LIMIT_DECLARATIONS.values()
        for name in names
    )
    limit_values = checker._parse_go_named_const_literals(
        (root / RESEARCH_LIMIT_SOURCE_PATH).read_text(encoding="utf-8"),
        limit_names,
    )
    contract_values = checker._parse_go_named_const_literals(
        (root / RESEARCH_CONTRACT_SOURCE_PATH).read_text(encoding="utf-8"),
        (
            "ResearchInputProtocol",
            "ResearchInputProtocolVersion",
            "maxResearchDatasetFormats",
            "maxResearchDatasetFormatSize",
        ),
    )
    archive_formats = checker._parse_go_string_set_map(
        (root / RESEARCH_CONTRACT_SOURCE_PATH).read_text(encoding="utf-8"),
        "acceptedResearchArchiveFormats",
    )
    assert limit_values is not None
    assert contract_values is not None
    assert archive_formats is not None
    assert all(isinstance(value, int) for value in limit_values.values())
    return (
        {name: int(value) for name, value in limit_values.items()},
        contract_values,
        archive_formats,
    )


_UNSUPPORTED_AST_VALUE = object()


def _static_ast_value(node: ast.AST) -> object:
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, (ast.List, ast.Set, ast.Tuple)):
        values = [_static_ast_value(item) for item in node.elts]
        if _UNSUPPORTED_AST_VALUE in values:
            return _UNSUPPORTED_AST_VALUE
        if isinstance(node, ast.List):
            return values
        if isinstance(node, ast.Set):
            return set(values)
        return tuple(values)
    if isinstance(node, ast.Dict):
        keys = [_static_ast_value(item) for item in node.keys]
        values = [_static_ast_value(item) for item in node.values]
        if _UNSUPPORTED_AST_VALUE in (*keys, *values):
            return _UNSUPPORTED_AST_VALUE
        return dict(zip(keys, values, strict=True))
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "frozenset"
        and len(node.args) == 1
        and not node.keywords
    ):
        value = _static_ast_value(node.args[0])
        if isinstance(value, (list, set, tuple)):
            return frozenset(value)
    if isinstance(node, ast.BinOp):
        left = _static_ast_value(node.left)
        right = _static_ast_value(node.right)
        if isinstance(left, int) and isinstance(right, int):
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, ast.LShift):
                return left << right
    return _UNSUPPORTED_AST_VALUE


def _static_scalar_values(value: object) -> set[str | int]:
    if isinstance(value, bool):
        return set()
    if isinstance(value, (str, int)):
        return {value}
    if isinstance(value, dict):
        scalars: set[str | int] = set()
        for key, item in value.items():
            scalars.update(_static_scalar_values(key))
            scalars.update(_static_scalar_values(item))
        return scalars
    if isinstance(value, (list, set, tuple, frozenset)):
        scalars = set()
        for item in value:
            scalars.update(_static_scalar_values(item))
        return scalars
    return set()


def _authoritative_assignment_mirrors(
    source: str, authoritative_values: set[str | int]
) -> set[str]:
    allowed_web_collisions = {"MAX_MATRIX_JSON_DEPTH"}
    prohibited_names = {
        "RESEARCH_INPUT_PROTOCOL",
        "RESEARCH_INPUT_PROTOCOL_VERSION",
        "_RESEARCH_INPUT_LIMIT_SOURCES",
        "RESEARCH_ARCHIVE_FORMATS",
        "MAX_RESEARCH_DATASET_FORMATS",
        "MAX_RESEARCH_DATASET_FORMAT_SIZE",
        "RESEARCH_INPUT_FIXTURE_SHA256",
        "CANONICAL_AGENT_TOOLS",
        "MAX_BOT_AGENT_DESCRIPTORS",
        "MAX_RESEARCH_DATASET_FILE_BYTES",
    }
    tree = ast.parse(source)
    mirrors = {
        node.id
        for node in ast.walk(tree)
        if isinstance(node, ast.Name) and node.id in prohibited_names
    }
    for statement in ast.walk(tree):
        if isinstance(statement, ast.Assign):
            names = [
                target.id
                for target in statement.targets
                if isinstance(target, ast.Name)
            ]
            value_node = statement.value
        elif isinstance(statement, ast.AnnAssign) and isinstance(
            statement.target, ast.Name
        ):
            names = [statement.target.id]
            value_node = statement.value
        else:
            continue
        if value_node is None:
            continue
        value = _static_ast_value(value_node)
        if value is _UNSUPPORTED_AST_VALUE:
            continue
        if _static_scalar_values(value) & authoritative_values:
            mirrors.update(name for name in names if name not in allowed_web_collisions)
    return mirrors


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


def test_checker_rejects_coordinated_research_drift_from_web_go(
    tmp_path: Path,
) -> None:
    root = local_readiness_tree(tmp_path)
    limit_values, contract_values, _ = accepted_go_contract_values(root)

    for _, hard_name in checker._RESEARCH_INPUT_LIMIT_DECLARATIONS.values():
        replace_go_const_value(
            root,
            RESEARCH_LIMIT_SOURCE_PATH,
            hard_name,
            limit_values[hard_name] + 1,
        )

    protocol = contract_values["ResearchInputProtocol"]
    protocol_version = contract_values["ResearchInputProtocolVersion"]
    max_formats = contract_values["maxResearchDatasetFormats"]
    max_format_size = contract_values["maxResearchDatasetFormatSize"]
    assert isinstance(protocol, str)
    assert isinstance(protocol_version, int)
    assert isinstance(max_formats, int)
    assert isinstance(max_format_size, int)
    next_protocol = f"{protocol}_next"
    replace_go_const_value(
        root, RESEARCH_CONTRACT_SOURCE_PATH, "ResearchInputProtocol", next_protocol
    )
    replace_go_const_value(
        root,
        RESEARCH_CONTRACT_SOURCE_PATH,
        "ResearchInputProtocolVersion",
        protocol_version + 1,
    )
    replace_go_const_value(
        root,
        RESEARCH_CONTRACT_SOURCE_PATH,
        "maxResearchDatasetFormats",
        max_formats + 1,
    )
    replace_go_const_value(
        root,
        RESEARCH_CONTRACT_SOURCE_PATH,
        "maxResearchDatasetFormatSize",
        max_format_size + 1,
    )

    future_archive = "futurearchive"
    contract_path = root / RESEARCH_CONTRACT_SOURCE_PATH
    contract_source = contract_path.read_text(encoding="utf-8")
    archive_opening = (
        "var acceptedResearchArchiveFormats = map[string]struct{}{\n"
    )
    assert contract_source.count(archive_opening) == 1
    contract_path.write_text(
        contract_source.replace(
            archive_opening,
            archive_opening + f'\t"{future_archive}": {{}},\n',
        ),
        encoding="utf-8",
    )
    format_path = root / RESEARCH_FORMAT_SOURCE_PATH
    format_source = format_path.read_text(encoding="utf-8")
    format_opening = "var archiveAttachmentSuffixes = map[string]struct{}{\n"
    assert format_source.count(format_opening) == 1
    format_path.write_text(
        format_source.replace(
            format_opening,
            format_opening + f'    ".{future_archive}": {{}},\n',
        ),
        encoding="utf-8",
    )

    fixture_path = root / RESEARCH_INPUT_FIXTURE_PATH
    payload = json.loads(fixture_path.read_text(encoding="utf-8"))
    payload["protocols"][next_protocol] = [protocol_version + 1]
    del payload["protocols"][protocol]
    research_datasets(payload)["formats"].append(future_archive)
    write(root, RESEARCH_INPUT_FIXTURE_PATH.as_posix(), payload)
    replace_go_const_value(
        root,
        RESEARCH_CONTRACT_SOURCE_PATH,
        "acceptedResearchInputFixtureSHA256",
        hashlib.sha256(fixture_path.read_bytes()).hexdigest(),
    )

    errors = checker.check(root)
    assert any(
        "Web Research contract differs from pinned Bot sources" in error
        for error in errors
    )
    assert any(
        "Research fixture contract differs from pinned Bot sources" in error
        for error in errors
    )


@pytest.mark.parametrize(
    ("relative", "name", "invalid_kind"),
    [
        (
            RESEARCH_LIMIT_SOURCE_PATH,
            "DefaultMaxUserQueryChars",
            "above_hard",
        ),
        (RESEARCH_LIMIT_SOURCE_PATH, "HardMaxAssetAttachmentRefs", "zero"),
        (RESEARCH_CONTRACT_SOURCE_PATH, "ResearchInputProtocol", "empty"),
        (RESEARCH_CONTRACT_SOURCE_PATH, "ResearchInputProtocolVersion", "zero"),
        (RESEARCH_CONTRACT_SOURCE_PATH, "maxResearchDatasetFormats", "zero"),
        (RESEARCH_CONTRACT_SOURCE_PATH, "maxResearchDatasetFormatSize", "zero"),
    ],
)
def test_checker_rejects_malformed_web_research_go_relationships(
    tmp_path: Path, relative: Path, name: str, invalid_kind: str
) -> None:
    root = minimal_tree(tmp_path)
    limit_values, _, _ = accepted_go_contract_values(root)
    if invalid_kind == "above_hard":
        value: str | int = limit_values["HardMaxUserQueryChars"] + 1
    elif invalid_kind == "empty":
        value = ""
    else:
        value = 0
    replace_go_const_value(root, relative, name, value)

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


def test_checker_has_no_python_mirrors_of_authoritative_go_values() -> None:
    limit_values, contract_values, archive_formats = accepted_go_contract_values(
        checker.ROOT
    )
    authoritative_values = {
        *limit_values.values(),
        contract_values["ResearchInputProtocol"],
        contract_values["ResearchInputProtocolVersion"],
        contract_values["maxResearchDatasetFormats"],
        contract_values["maxResearchDatasetFormatSize"],
        *archive_formats,
    }
    source = Path(checker.__file__).read_text(encoding="utf-8")
    assert _authoritative_assignment_mirrors(source, authoritative_values) == set()

    protocol = contract_values["ResearchInputProtocol"]
    assert isinstance(protocol, str)
    mutations = {
        "HIDDEN_PROTOCOL_MIRROR": repr(protocol),
        "HIDDEN_LIMIT_MIRROR": repr(max(limit_values.values())),
        "HIDDEN_ARCHIVE_MIRROR": repr(sorted(archive_formats)),
        "RESEARCH_INPUT_PROTOCOL": repr("renamed-value"),
    }
    for name, value in mutations.items():
        mutated = source + f"\ndef hidden_mirror():\n    {name} = {value}\n"
        assert _authoritative_assignment_mirrors(
            mutated, authoritative_values
        ) == {name}


def test_checker_rejects_canonical_agent_tool_drift(tmp_path: Path) -> None:
    root = minimal_tree(tmp_path)
    replace_source_once(
        root,
        AGENT_CANONICAL_SOURCE_PATH,
        '"InSilicoResearchAgent"',
        '"ChangedResearchAgent"',
    )

    errors = checker.check(root)
    assert any("agent descriptor catalog" in error for error in errors)


def test_checker_rejects_coordinated_web_drift_against_pinned_bot_source(
    tmp_path: Path,
) -> None:
    root = minimal_tree(tmp_path)
    replace_source_once(
        root,
        AGENT_CANONICAL_SOURCE_PATH,
        '"GeneNetworkAgent"',
        '"AlteredNetworkAgent"',
    )
    fixture_path = root / RESEARCH_INPUT_FIXTURE_PATH
    payload = json.loads(fixture_path.read_text(encoding="utf-8"))
    network = next(row for row in payload["data"] if row.get("slug") == "network")
    network["tool"] = "AlteredNetworkAgent"
    write(root, RESEARCH_INPUT_FIXTURE_PATH.as_posix(), payload)
    replace_go_const_value(
        root,
        RESEARCH_CONTRACT_SOURCE_PATH,
        "acceptedResearchInputFixtureSHA256",
        hashlib.sha256(fixture_path.read_bytes()).hexdigest(),
    )

    errors = checker.check(root)
    assert any("pinned Bot agent identities" in error for error in errors)


def test_checker_rejects_pinned_bot_commit_drift(tmp_path: Path) -> None:
    root = minimal_tree(tmp_path)
    manifest_path = root / SOURCE_BINDING_MANIFEST_PATH
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["activation_source_binding"]["bot_commit"] = "0" * 40
    write(root, SOURCE_BINDING_MANIFEST_PATH.as_posix(), manifest)

    errors = checker.check(root)
    assert any("Bot source binding" in error for error in errors)


def test_source_binding_rejects_oversized_manifest_before_unbounded_read(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest_path = tmp_path / SOURCE_BINDING_MANIFEST_PATH
    manifest_path.parent.mkdir(parents=True)
    with manifest_path.open("wb") as stream:
        stream.seek(checker.MAX_BOT_CONTRACT_MANIFEST_BYTES)
        stream.write(b"}")
    original_read_bytes = Path.read_bytes

    def reject_manifest_read_bytes(path: Path) -> bytes:
        if path == manifest_path:
            raise AssertionError("manifest used an unbounded read")
        return original_read_bytes(path)

    monkeypatch.setattr(Path, "read_bytes", reject_manifest_read_bytes)
    violations: list[str] = []

    assert checker._load_bot_source_binding(tmp_path, violations) is None
    assert violations == ["Bot source binding manifest is oversized"]


def test_checker_rejects_valid_unaccepted_bot_commit_proof(tmp_path: Path) -> None:
    root = minimal_tree(tmp_path)
    manifest_path = root / SOURCE_BINDING_MANIFEST_PATH
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    binding = manifest["activation_source_binding"]
    commit = binding["git_object_proof"]["commit"]
    payload = base64.b64decode(commit["content_base64"], validate=True)
    payload += b"\nWeb-only source-binding drift\n"
    oid = checker._git_object_oid("commit", payload)
    binding["bot_commit"] = oid
    commit["oid"] = oid
    commit["content_base64"] = base64.b64encode(payload).decode("ascii")
    write(root, SOURCE_BINDING_MANIFEST_PATH.as_posix(), manifest)

    errors = checker.check(root)
    assert any("accepted Bot commit" in error for error in errors)


def test_committed_source_binding_uses_accepted_bot_commit_and_minimal_objects() -> (
    None
):
    raw = (checker.ROOT / SOURCE_BINDING_MANIFEST_PATH).read_bytes()
    manifest = json.loads(raw)
    binding = manifest["activation_source_binding"]

    assert (
        binding["bot_commit"]
        == checker.ACTIVATION_SOURCE_BOT_COMMIT
        == PINNED_ACTIVATION_BOT_COMMIT
    )
    assert len(raw) < 256 * 1024
    assert len(binding["git_object_proof"]["trees"]) <= 8
    assert {(entry["role"], entry["path"]) for entry in binding["sources"]} == set(
        checker.BOT_SOURCE_PATHS.items()
    )
    packet = binding["resumable_upload_packet"]
    assert all(set(entry) == {"path", "sha256"} for entry in packet["files"])
    assert not ({"owner_subject", "filename", "capability"} & set(packet))

    fixture = binding["research_fixture"]
    authority = fixture["authority"]
    assert (
        authority["bot_commit"]
        == checker.RESEARCH_FIXTURE_BOT_COMMIT
        == PINNED_RESEARCH_FIXTURE_BOT_COMMIT
    )
    assert {(entry["role"], entry["path"]) for entry in authority["sources"]} == set(
        checker.RESEARCH_FIXTURE_SOURCE_PATHS.items()
    )
    fixture_sources = {
        entry["role"]: base64.b64decode(entry["content_base64"], validate=True)
        for entry in authority["sources"]
    }
    expected_raw = checker._research_fixture_bytes(fixture_sources)
    assert expected_raw == (checker.ROOT / RESEARCH_INPUT_FIXTURE_PATH).read_bytes()
    assert hashlib.sha256(expected_raw).hexdigest() == fixture["sha256"]


def test_checker_rejects_research_fixture_authority_blob_drift(
    tmp_path: Path,
) -> None:
    root = minimal_tree(tmp_path)
    manifest_path = root / SOURCE_BINDING_MANIFEST_PATH
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    source = manifest["activation_source_binding"]["research_fixture"]["authority"][
        "sources"
    ][0]
    payload = base64.b64decode(source["content_base64"], validate=True)
    source["content_base64"] = base64.b64encode(payload + b"\n").decode("ascii")
    write(root, SOURCE_BINDING_MANIFEST_PATH.as_posix(), manifest)

    errors = checker.check(root)
    assert any("Research fixture authority" in error for error in errors)


def test_checker_rejects_pinned_bot_blob_payload_drift(tmp_path: Path) -> None:
    root = minimal_tree(tmp_path)
    manifest_path = root / SOURCE_BINDING_MANIFEST_PATH
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    source = manifest["activation_source_binding"]["sources"][0]
    payload = base64.b64decode(source["content_base64"], validate=True)
    source["content_base64"] = base64.b64encode(payload + b"\n").decode("ascii")
    write(root, SOURCE_BINDING_MANIFEST_PATH.as_posix(), manifest)

    errors = checker.check(root)
    assert any("source inventory" in error for error in errors)


def test_checker_rejects_handwritten_normalized_contract_drift(
    tmp_path: Path,
) -> None:
    root = minimal_tree(tmp_path)
    manifest_path = root / SOURCE_BINDING_MANIFEST_PATH
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["activation_source_binding"]["contract"]["canonical_agent_tools"][
        "network"
    ] = "AlteredNetworkAgent"
    write(root, SOURCE_BINDING_MANIFEST_PATH.as_posix(), manifest)

    errors = checker.check(root)
    assert any("contract does not match pinned sources" in error for error in errors)


def test_checker_rejects_agent_descriptor_ceiling_drift(tmp_path: Path) -> None:
    root = minimal_tree(tmp_path)
    replace_source_once(
        root,
        AGENT_MAP_SOURCE_PATH,
        "const maxBotAgentDescriptors = 32",
        "const maxBotAgentDescriptors = 1",
    )

    errors = checker.check(root)
    assert any("agent descriptor catalog" in error for error in errors)


def test_checker_rejects_upload_file_ceiling_drift(tmp_path: Path) -> None:
    root = minimal_tree(tmp_path)
    replace_source_once(
        root,
        UPLOAD_CONTRACT_SOURCE_PATH,
        "maxResumableUploadFileBytes int64 = 10 << 30",
        "maxResumableUploadFileBytes int64 = 1",
    )

    errors = checker.check(root)
    assert any("datasets.max_file_bytes" in error for error in errors)


def test_checker_rejects_accepted_research_fixture_digest_drift(
    tmp_path: Path,
) -> None:
    root = minimal_tree(tmp_path)
    digest = hashlib.sha256((root / RESEARCH_INPUT_FIXTURE_PATH).read_bytes()).hexdigest()
    replace_source_once(
        root,
        RESEARCH_CONTRACT_SOURCE_PATH,
        digest,
        "0" * 64,
    )

    errors = checker.check(root)
    assert any("Research fixture SHA-256" in error for error in errors)


@pytest.mark.parametrize(
    "relative",
    [
        RESEARCH_LIMIT_SOURCE_PATH,
        RESEARCH_CONTRACT_SOURCE_PATH,
        AGENT_MAP_SOURCE_PATH,
        UPLOAD_CONTRACT_SOURCE_PATH,
    ],
)
def test_checker_ignores_unrelated_go_const_declarations(
    tmp_path: Path, relative: Path
) -> None:
    root = local_readiness_tree(tmp_path)
    path = root / relative
    source = path.read_text(encoding="utf-8")
    path.write_text(
        source
        + "\nconst unrelatedActivationValue = 1 + 2\n"
        + "const (\n\tanotherUnrelatedActivationValue = 3\n)\n",
        encoding="utf-8",
    )

    assert checker.check(root) == []


def test_checker_ignores_unrelated_const_in_guarded_group(tmp_path: Path) -> None:
    root = local_readiness_tree(tmp_path)
    replace_source_once(
        root,
        RESEARCH_CONTRACT_SOURCE_PATH,
        "const (\n",
        "const (\n\tunrelatedActivationValue = 1 + 2\n",
    )

    assert checker.check(root) == []


@pytest.mark.parametrize(
    ("relative", "accepted", "replacement"),
    [
        (
            AGENT_CANONICAL_SOURCE_PATH,
            "var CanonicalAgentTool =",
            "var MissingCanonicalAgentTool =",
        ),
        (
            AGENT_MAP_SOURCE_PATH,
            "const maxBotAgentDescriptors = 32",
            "const missingBotAgentDescriptors = 32",
        ),
        (
            UPLOAD_CONTRACT_SOURCE_PATH,
            "maxResumableUploadFileBytes int64 = 10 << 30",
            "missingResumableUploadFileBytes int64 = 10 << 30",
        ),
    ],
)
def test_checker_rejects_missing_authoritative_go_declaration(
    tmp_path: Path, relative: Path, accepted: str, replacement: str
) -> None:
    root = minimal_tree(tmp_path)
    replace_source_once(root, relative, accepted, replacement)

    errors = checker.check(root)
    assert any("Research Go contract" in error for error in errors)


def test_checker_rejects_missing_fixture_digest_declaration(tmp_path: Path) -> None:
    root = minimal_tree(tmp_path)
    replace_source_once(
        root,
        RESEARCH_CONTRACT_SOURCE_PATH,
        "acceptedResearchInputFixtureSHA256",
        "missingResearchInputFixtureSHA256",
    )

    errors = checker.check(root)
    assert any("Research Go contract" in error for error in errors)


@pytest.mark.parametrize("run_gofmt", (False, True), ids=("raw", "gofmt"))
@pytest.mark.parametrize(
    ("kind", "relative", "name"),
    [
        ("const", AGENT_MAP_SOURCE_PATH, "maxBotAgentDescriptors"),
        ("map", AGENT_CANONICAL_SOURCE_PATH, "CanonicalAgentTool"),
        (
            "set",
            RESEARCH_CONTRACT_SOURCE_PATH,
            "acceptedResearchArchiveFormats",
        ),
    ],
)
def test_checker_rejects_function_local_authoritative_go_decoys(
    tmp_path: Path,
    run_gofmt: bool,
    kind: str,
    relative: Path,
    name: str,
) -> None:
    root = minimal_tree(tmp_path)
    path = root / relative
    source = path.read_text(encoding="utf-8")
    if kind == "const":
        values = checker._parse_go_named_const_literals(source, (name,))
        assert values is not None
        declaration = f"const {name} = {values[name]}"
    elif kind == "map":
        values = checker._parse_go_string_map(source, name)
        assert values is not None
        entries = "\n".join(
            f"{json.dumps(key)}: {json.dumps(value)},"
            for key, value in values.items()
        )
        declaration = f"var {name} = map[string]string{{\n{entries}\n}}"
    else:
        values = checker._parse_go_string_set_map(source, name)
        assert values is not None
        entries = "\n".join(f'{json.dumps(value)}: {{}},' for value in values)
        declaration = f"var {name} = map[string]struct{{}}{{\n{entries}\n}}"

    runtime_name = f"runtime{name[0].upper()}{name[1:]}"
    assert name in source
    source = source.replace(name, runtime_name)
    source += (
        "\nfunc activationLocalDeclarationDecoy(){\n"
        f"{declaration}\n"
        f"_={name}\n"
        "}\n"
    )
    if run_gofmt:
        source = subprocess.run(
            ["gofmt"],
            input=source,
            text=True,
            capture_output=True,
            check=True,
        ).stdout
    path.write_text(source, encoding="utf-8")

    errors = checker.check(root)
    assert any("Research Go contract" in error for error in errors)


@pytest.mark.parametrize(
    "unterminated",
    (
        'var activationBroken = "unterminated',
        "var activationBroken = 'unterminated",
        "var activationBroken = `unterminated",
        "/* unterminated",
    ),
    ids=("string", "rune", "raw-string", "block-comment"),
)
def test_checker_fails_closed_for_unterminated_go_lexical_contexts(
    tmp_path: Path, unterminated: str
) -> None:
    root = minimal_tree(tmp_path)
    path = root / RESEARCH_CONTRACT_SOURCE_PATH
    path.write_text(
        path.read_text(encoding="utf-8") + "\n" + unterminated,
        encoding="utf-8",
    )

    errors = checker.check(root)
    assert any("Research Go contract" in error for error in errors)


@pytest.mark.parametrize(
    ("relative", "marker"),
    (
        (RESEARCH_LIMIT_SOURCE_PATH, "Research Go contract"),
        (RESEARCH_CONTRACT_SOURCE_PATH, "Research Go contract"),
        (AGENT_CANONICAL_SOURCE_PATH, "Research Go contract"),
        (AGENT_MAP_SOURCE_PATH, "Research Go contract"),
        (UPLOAD_CONTRACT_SOURCE_PATH, "Research Go contract"),
        (RESEARCH_FORMAT_SOURCE_PATH, "Research format maps"),
    ),
)
def test_each_authoritative_go_source_fails_closed_for_unterminated_context(
    tmp_path: Path, relative: Path, marker: str
) -> None:
    root = minimal_tree(tmp_path)
    path = root / relative
    path.write_text(
        path.read_text(encoding="utf-8") + "\n/* unterminated",
        encoding="utf-8",
    )

    errors = checker.check(root)
    assert any(marker in error for error in errors)


@pytest.mark.parametrize(
    ("relative", "duplicate"),
    [
        (
            AGENT_CANONICAL_SOURCE_PATH,
            '\nvar CanonicalAgentTool = map[string]string{"research": "duplicate"}\n',
        ),
        (
            AGENT_MAP_SOURCE_PATH,
            "\nconst maxBotAgentDescriptors = 32\n",
        ),
        (
            UPLOAD_CONTRACT_SOURCE_PATH,
            "\nconst maxResumableUploadFileBytes int64 = 10 << 30\n",
        ),
        (
            RESEARCH_CONTRACT_SOURCE_PATH,
            '\nconst acceptedResearchInputFixtureSHA256 = "' + "0" * 64 + '"\n',
        ),
    ],
)
def test_checker_rejects_duplicate_authoritative_go_declaration(
    tmp_path: Path, relative: Path, duplicate: str
) -> None:
    root = minimal_tree(tmp_path)
    path = root / relative
    path.write_text(path.read_text(encoding="utf-8") + duplicate, encoding="utf-8")

    errors = checker.check(root)
    assert any("Research Go contract" in error for error in errors)


@pytest.mark.parametrize(
    ("relative", "accepted", "replacement"),
    [
        (
            AGENT_MAP_SOURCE_PATH,
            "const maxBotAgentDescriptors = 32",
            "const maxBotAgentDescriptors = 16 * 2",
        ),
        (
            UPLOAD_CONTRACT_SOURCE_PATH,
            "maxResumableUploadFileBytes int64 = 10 << 30",
            "maxResumableUploadFileBytes int64 = 5 * 2 << 30",
        ),
    ],
)
def test_checker_rejects_unsupported_guarded_go_declaration(
    tmp_path: Path, relative: Path, accepted: str, replacement: str
) -> None:
    root = minimal_tree(tmp_path)
    replace_source_once(root, relative, accepted, replacement)

    errors = checker.check(root)
    assert any("Research Go contract" in error for error in errors)


@pytest.mark.parametrize(
    "relative",
    [
        AGENT_CANONICAL_SOURCE_PATH,
        AGENT_MAP_SOURCE_PATH,
        UPLOAD_CONTRACT_SOURCE_PATH,
        RESEARCH_CONTRACT_SOURCE_PATH,
    ],
)
def test_checker_rejects_out_of_root_authoritative_go_source(
    tmp_path: Path, relative: Path
) -> None:
    root = local_readiness_tree(tmp_path / "root")
    path = root / relative
    outside = tmp_path / f"outside-{relative.name}"
    outside.write_bytes(path.read_bytes())
    path.unlink()
    path.symlink_to(outside)

    errors = checker.check(root)
    assert any("out-of-scope" in error for error in errors)


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
