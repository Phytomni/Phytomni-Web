"""Tests for the offline reference-only upload boundary scanner."""

from __future__ import annotations

import contextlib
import importlib.util
import io
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts" / "check_resumable_upload_boundary.py"


def load_checker():
    spec = importlib.util.spec_from_file_location(
        "check_resumable_upload_boundary", SPEC
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load checker module from {SPEC}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _clean_root(tmp_path: Path):
    checker = load_checker()
    for relative in (*checker.WEB_RELAY_PATHS, *checker.GO_RELAY_PATHS):
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            "// reference-only attachment request; no file bytes or OBS paths\n",
            encoding="utf-8",
        )
    return checker


def test_current_checkout_reports_the_known_legacy_relay():
    checker = load_checker()

    violations = checker.check(ROOT)

    assert violations
    assert any("query.go" in violation for violation in violations)
    assert any("QueryFile" in violation for violation in violations)
    assert all(len(violation) <= checker.MAX_FAILURE_LENGTH for violation in violations)
    assert len(violations) <= checker.MAX_FAILURE_LINES


def test_clean_reference_only_sources_pass(tmp_path: Path):
    checker = _clean_root(tmp_path)

    assert checker.check(tmp_path) == []

    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        assert checker.main(["--root", str(tmp_path)]) == 0
    assert output.getvalue().strip() == checker.PASS_LINE


def test_browser_file_append_is_rejected_with_line_diagnostic(tmp_path: Path):
    checker = _clean_root(tmp_path)
    source = tmp_path / checker.WEB_RELAY_PATHS[0]
    source.write_text(
        'const body = new FormData();\nbody.append("files", file);\n',
        encoding="utf-8",
    )

    violations = checker.check(tmp_path)

    assert any(
        str(checker.WEB_RELAY_PATHS[0]) in violation
        and ":2:" in violation
        and "raw browser file" in violation
        for violation in violations
    )


def test_go_multipart_and_file_bytes_are_rejected(tmp_path: Path):
    checker = _clean_root(tmp_path)
    source = tmp_path / checker.GO_RELAY_PATHS[0]
    source.write_text(
        'form, _ := c.Request.MultipartReader()\n'
        'var payload []byte\n'
        'bytes.NewReader(file.Data)\n',
        encoding="utf-8",
    )

    violations = checker.check(tmp_path)

    assert any("multipart file relay" in violation for violation in violations)
    assert any("complete file bytes" in violation for violation in violations)


def test_obs_paths_and_legacy_upload_methods_are_rejected(tmp_path: Path):
    checker = _clean_root(tmp_path)
    source = tmp_path / checker.GO_RELAY_PATHS[-1]
    source.write_text(
        'func BuildAgentArguments() {\n'
        '  args["obs_file_list"] = paths\n'
        '  _ = UploadFileWithMeta\n'
        '}\n',
        encoding="utf-8",
    )

    violations = checker.check(tmp_path)

    assert any("OBS path list" in violation for violation in violations)
    assert any("legacy Bot file upload" in violation for violation in violations)


def test_allowlist_is_exact_and_does_not_cover_production_paths():
    checker = load_checker()

    assert (
        Path("apps/web/tests/unit/views/chat/message-parse.spec.ts")
        in checker.LEGACY_HISTORY_TEST_ALLOWLIST
    )
    assert (
        Path("apps/server/service/api_service/query.go")
        not in checker.LEGACY_HISTORY_TEST_ALLOWLIST
    )
    assert all(
        "tests" in path.parts or "message-parse.ts" in path.name
        for path in checker.LEGACY_HISTORY_TEST_ALLOWLIST
    )


def test_checker_has_no_network_or_secret_transport_dependencies():
    source = SPEC.read_text(encoding="utf-8")

    assert "requests" not in source
    assert "urllib" not in source
    assert "Authorization" not in source
    assert "Bearer" not in source
