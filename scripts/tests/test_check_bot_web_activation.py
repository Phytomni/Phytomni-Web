"""Tests for the fail-closed Bot/Web activation evidence gate."""

from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path

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
) -> dict[str, object]:
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


def matrix_text(value: dict[str, object]) -> str:
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


def minimal_tree(tmp_path: Path, value: dict[str, object] | None = None) -> Path:
    root = tmp_path
    write(
        root,
        checker.MATRIX_REL.as_posix(),
        matrix_text(matrix_value() if value is None else value),
    )
    for relative, content in checker.DEFAULT_CHECK_FILES.items():
        write(root, relative.as_posix(), content)
    return root


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
    value["feature_flags"]["unknown"] = False  # type: ignore[index]
    assert any("feature flag" in error for error in checker.check(minimal_tree(tmp_path, value)))

    value = matrix_value()
    value["rows"][0]["status"] = "Accepted"  # type: ignore[index]
    assert any("status" in error for error in checker.check(minimal_tree(tmp_path, value)))

    value = matrix_value(rollback=checker.ROLLBACK_MARKERS[:-1])
    assert any("rollback" in error for error in checker.check(minimal_tree(tmp_path, value)))


def test_committed_matrix_is_dark_and_cli_has_one_stable_pass_line() -> None:
    assert checker.check(checker.ROOT) == []
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        assert checker.main([]) == 0
    assert output.getvalue().strip() == checker.PASS_LINE


def test_cli_failure_is_bounded_and_does_not_echo_raw_content(tmp_path: Path) -> None:
    value = matrix_value()
    value["rows"][0]["fixture_id"] = "raw answer body"  # type: ignore[index]
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


def test_requested_unknown_flag_is_rejected_without_echoing_value() -> None:
    errors = checker.activation_errors({}, requested_flags={"private_payload": True})
    assert errors == ["unknown feature flag"]
