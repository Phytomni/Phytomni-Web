"""Tests for the offline reference-only upload boundary scanner."""

from __future__ import annotations

import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest


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


def _canonical_agent_arguments_source() -> str:
    return "\n".join(
        (
            'args["data_list"] = map[string]string{}',
            'args["obs_file_list"] = []string{}',
            'args["data_list"] = map[string]string{}',
            'args["obs_file_list"] = []string{}',
            'args["obs_file_list"] = []string{}',
            'args["obs_file_list"] = []string{}',
            "",
        )
    )


def _clean_root(tmp_path: Path):
    checker = load_checker()
    for relative in (*checker.WEB_RELAY_PATHS, *checker.GO_RELAY_PATHS):
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        source = "// reference-only attachment request; no file bytes or OBS paths\n"
        if relative == checker.CANONICAL_AGENT_ARGUMENTS_PATH:
            source = _canonical_agent_arguments_source()
        path.write_text(source, encoding="utf-8")
    return checker


class ResumableUploadBoundaryTests(unittest.TestCase):
    def _tmp_root(self):
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        return Path(temp_dir.name)

    def test_current_checkout_passes(self):
        checker = load_checker()

        self.assertEqual(checker.check(ROOT), [])

    def test_clean_reference_only_sources_pass(self):
        tmp_path = self._tmp_root()
        checker = _clean_root(tmp_path)

        self.assertEqual(checker.check(tmp_path), [])

        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(checker.main(["--root", str(tmp_path)]), 0)
        self.assertEqual(output.getvalue().strip(), checker.PASS_LINE)

    def test_browser_file_append_is_rejected_with_line_diagnostic(self):
        tmp_path = self._tmp_root()
        checker = _clean_root(tmp_path)
        source = tmp_path / checker.WEB_RELAY_PATHS[0]
        source.write_text(
            'const body = new FormData();\nbody.append("files", file);\n',
            encoding="utf-8",
        )

        violations = checker.check(tmp_path)

        self.assertTrue(
            any(
                str(checker.WEB_RELAY_PATHS[0]) in violation
                and ":2:" in violation
                and "raw browser file" in violation
                for violation in violations
            )
        )

    def test_go_multipart_and_file_bytes_are_rejected(self):
        tmp_path = self._tmp_root()
        checker = _clean_root(tmp_path)
        source = tmp_path / checker.GO_RELAY_PATHS[0]
        source.write_text(
            'form, _ := c.Request.MultipartReader()\n'
            'var payload []byte\n'
            'bytes.NewReader(file.Data)\n',
            encoding="utf-8",
        )

        violations = checker.check(tmp_path)

        self.assertTrue(any("multipart file relay" in violation for violation in violations))
        self.assertTrue(any("complete file bytes" in violation for violation in violations))

    def test_only_canonical_agent_argument_assignments_are_allowed(self):
        tmp_path = self._tmp_root()
        checker = _clean_root(tmp_path)

        self.assertEqual(checker.check(tmp_path), [])

        other_source = tmp_path / checker.GO_RELAY_PATHS[0]
        other_source.write_text(
            'args["obs_file_list"] = []string{}\n', encoding="utf-8"
        )
        violations = checker.check(tmp_path)

        self.assertTrue(any("native attachment field" in violation for violation in violations))

    def test_noncanonical_native_attachment_values_are_rejected(self):
        fixtures = (
            'args["obs_file_list"] = input.Paths\n',
            'args["data_list"] = map[string]string{"obs://x": ""}\n',
            'type Input struct { DataList map[string]string }\n',
            'type Input struct { OBSFileList []string }\n',
        )
        for fixture in fixtures:
            with self.subTest(fixture=fixture):
                tmp_path = self._tmp_root()
                checker = _clean_root(tmp_path)
                source = tmp_path / checker.CANONICAL_AGENT_ARGUMENTS_PATH
                source.write_text(
                    _canonical_agent_arguments_source() + fixture, encoding="utf-8"
                )

                violations = checker.check(tmp_path)

                self.assertTrue(any("native attachment field" in item for item in violations))

    def test_duplicate_canonical_assignment_is_rejected(self):
        tmp_path = self._tmp_root()
        checker = _clean_root(tmp_path)
        source = tmp_path / checker.CANONICAL_AGENT_ARGUMENTS_PATH
        source.write_text(
            _canonical_agent_arguments_source()
            + 'args["obs_file_list"] = []string{}\n',
            encoding="utf-8",
        )

        violations = checker.check(tmp_path)

        self.assertTrue(any("canonical assignment count" in item for item in violations))

    def test_browser_native_attachment_append_is_rejected(self):
        tmp_path = self._tmp_root()
        checker = _clean_root(tmp_path)
        source = tmp_path / checker.WEB_RELAY_PATHS[0]
        source.write_text('formData.append("data_list", value)\n', encoding="utf-8")

        violations = checker.check(tmp_path)

        self.assertTrue(any("native attachment field" in item for item in violations))

    def test_allowlist_is_exact_and_does_not_cover_production_paths(self):
        checker = load_checker()

        self.assertIn(
            Path("apps/web/tests/unit/views/chat/message-parse.spec.ts"),
            checker.LEGACY_HISTORY_TEST_ALLOWLIST,
        )
        self.assertNotIn(
            Path("apps/server/service/api_service/query.go"),
            checker.LEGACY_HISTORY_TEST_ALLOWLIST,
        )
        self.assertTrue(
            all(
                "tests" in path.parts or "message-parse.ts" in path.name
                for path in checker.LEGACY_HISTORY_TEST_ALLOWLIST
            )
        )

    def test_checker_has_no_network_or_secret_transport_dependencies(self):
        source = SPEC.read_text(encoding="utf-8")

        self.assertNotIn("requests", source)
        self.assertNotIn("urllib", source)
        self.assertNotIn("Authorization", source)
        self.assertNotIn("Bearer", source)
