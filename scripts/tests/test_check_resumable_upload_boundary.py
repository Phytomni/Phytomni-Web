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
        elif relative == checker.BOT_UPLOAD_CREATE_PATH:
            source = 'type UploadCreateRequest struct { Purpose string `json:"purpose"` }\n'
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

    def test_legacy_relay_symbols_are_rejected(self):
        tmp_path = self._tmp_root()
        checker = _clean_root(tmp_path)
        source = tmp_path / checker.GO_RELAY_PATHS[0]
        source.write_text(
            "type QueryFile struct{}\n"
            "func UploadFileWithMeta() {}\n"
            "type UploadLimits struct{}\n"
            "type FileUploadResponse struct{}\n",
            encoding="utf-8",
        )

        violations = checker.check(tmp_path)

        self.assertTrue(any("QueryFile" in item for item in violations))
        self.assertTrue(any("legacy Bot file upload" in item for item in violations))
        self.assertTrue(any("upload limit/response" in item for item in violations))

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

    def test_browser_upload_metadata_purpose_is_rejected(self):
        tmp_path = self._tmp_root()
        checker = _clean_root(tmp_path)
        source = tmp_path / checker.BROWSER_UPLOAD_CONTROL_PATH
        source.write_text(
            'const metadata = { filename: "reads.fastq.gz", purpose: "dataset" };\n',
            encoding="utf-8",
        )

        violations = checker.check(tmp_path)

        self.assertTrue(any("browser upload purpose" in item for item in violations))

    def test_public_upload_body_purpose_tag_is_rejected(self):
        tmp_path = self._tmp_root()
        checker = _clean_root(tmp_path)
        source = tmp_path / checker.PUBLIC_UPLOAD_HANDLER_PATH
        source.write_text(
            'type uploadCreateBody struct { Purpose string `json:"purpose"` }\n',
            encoding="utf-8",
        )

        violations = checker.check(tmp_path)

        self.assertTrue(any("public upload purpose" in item for item in violations))

    def test_trusted_bot_upload_create_purpose_is_allowed(self):
        tmp_path = self._tmp_root()
        checker = _clean_root(tmp_path)

        self.assertEqual(checker.check(tmp_path), [])

    def test_trusted_web_go_upload_service_derives_purpose(self):
        tmp_path = self._tmp_root()
        checker = _clean_root(tmp_path)
        source = tmp_path / checker.WEB_GO_UPLOAD_SERVICE_PATH
        source.write_text(
            "client.CreateUpload(ctx, rxBot.UploadCreateRequest{\n"
            "    Purpose: string(purpose),\n"
            "})\n",
            encoding="utf-8",
        )

        self.assertEqual(checker.check(tmp_path), [])

    def test_untrusted_web_go_purpose_assignment_is_rejected(self):
        tmp_path = self._tmp_root()
        checker = _clean_root(tmp_path)
        source = tmp_path / checker.GO_RELAY_PATHS[0]
        source.write_text(
            "Purpose: string(purpose)\n",
            encoding="utf-8",
        )

        violations = checker.check(tmp_path)

        self.assertTrue(
            any("forbidden attachment field" in item for item in violations)
        )

    def test_trusted_web_go_upload_service_rejects_description_and_storage_fields(self):
        fixtures = (
            'payload["dataset_description"] = value\n',
            'payload["object_key"] = value\n',
        )
        for fixture in fixtures:
            with self.subTest(fixture=fixture):
                tmp_path = self._tmp_root()
                checker = _clean_root(tmp_path)
                source = tmp_path / checker.WEB_GO_UPLOAD_SERVICE_PATH
                source.write_text(
                    "client.CreateUpload(ctx, rxBot.UploadCreateRequest{\n"
                    "    Purpose: string(purpose),\n"
                    "})\n"
                    + fixture,
                    encoding="utf-8",
                )

                violations = checker.check(tmp_path)

                self.assertTrue(
                    any(
                        "dataset description" in item
                        or "forbidden attachment field" in item
                        for item in violations
                    )
                )

    def test_dataset_description_is_rejected_on_browser_and_go_paths(self):
        fixtures = (
            ("web", 'formData.append("dataset_description", description)\n'),
            ("go", 'payload["dataset_description"] = value\n'),
            ("go", 'type Input struct { Description string `json:"dataset_description"` }\n'),
        )
        for owner, fixture in fixtures:
            with self.subTest(owner=owner, fixture=fixture):
                tmp_path = self._tmp_root()
                checker = _clean_root(tmp_path)
                source = (
                    tmp_path / checker.WEB_RELAY_PATHS[0]
                    if owner == "web"
                    else tmp_path / checker.GO_RELAY_PATHS[0]
                )
                source.write_text(fixture, encoding="utf-8")

                violations = checker.check(tmp_path)

                self.assertTrue(any("dataset description" in item for item in violations))

    def test_browser_sensitive_attachment_fields_are_rejected(self):
        fields = (
            "obs_path",
            "object_key",
            "owner_subject",
            "credentials",
            "upload_id",
            "storage_path",
        )
        for field in fields:
            with self.subTest(field=field):
                tmp_path = self._tmp_root()
                checker = _clean_root(tmp_path)
                source = tmp_path / checker.WEB_RELAY_PATHS[0]
                source.write_text(
                    f'formData.append("{field}", value)\n', encoding="utf-8"
                )

                violations = checker.check(tmp_path)

                self.assertTrue(
                    any("forbidden attachment field" in item for item in violations)
                )

    def test_public_upload_body_owner_and_storage_tags_are_rejected(self):
        fixtures = (
            'type Body struct { Owner string `json:"owner_subject"` }\n',
            'type Body struct { Key string `json:"object_key"` }\n',
        )
        for fixture in fixtures:
            with self.subTest(fixture=fixture):
                tmp_path = self._tmp_root()
                checker = _clean_root(tmp_path)
                source = tmp_path / checker.PUBLIC_UPLOAD_HANDLER_PATH
                source.write_text(fixture, encoding="utf-8")

                violations = checker.check(tmp_path)

                self.assertTrue(
                    any("forbidden attachment field" in item for item in violations)
                )

    def test_go_sensitive_attachment_fields_are_rejected(self):
        fields = ("obs_path", "object_key", "credentials", "upload_id", "storage_path")
        for field in fields:
            with self.subTest(field=field):
                tmp_path = self._tmp_root()
                checker = _clean_root(tmp_path)
                source = tmp_path / checker.GO_RELAY_PATHS[0]
                source.write_text(
                    f'payload["{field}"] = value\n', encoding="utf-8"
                )

                violations = checker.check(tmp_path)

                self.assertTrue(
                    any("forbidden attachment field" in item for item in violations)
                )

    def test_file_and_blob_body_assignments_are_rejected(self):
        fixtures = (
            "request.body = file\n",
            "const options = { data: selectedFile };\n",
            "const options = { body: blob };\n",
        )
        for fixture in fixtures:
            with self.subTest(fixture=fixture):
                tmp_path = self._tmp_root()
                checker = _clean_root(tmp_path)
                source = tmp_path / checker.WEB_RELAY_PATHS[0]
                source.write_text(fixture, encoding="utf-8")

                violations = checker.check(tmp_path)

                self.assertTrue(any("file or Blob body" in item for item in violations))

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
