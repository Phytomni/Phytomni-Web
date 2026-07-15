"""RED/GREEN tests for the repository A2UI activation-contract checker."""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from scripts import check_a2ui_activation_contract as checker


FIXTURE_BYTES = b'{"surface_id":"synthetic-surface","widget":"confirm"}\n'
DOC_REQUIRED_MARKERS = (
    "A2UI interaction lifecycle",
    "three supported widgets",
    "message-owned state",
    "messageKey + run_id + surface_id",
    "terminal",
    "input_required",
    "N=2",
    "no automatic retry",
    "no-blind-replay",
    "unknown lock",
    "Form/Choice cancellation",
    "history/reload read-only degradation",
    "reload fail-safe",
    "lifecycle status",
    "visible focus",
    "touch controls",
    ".codex/evidence/a2ui-activation/",
    "A1 activation-ready is not production activation",
)


class A2uiActivationContractTests(unittest.TestCase):
    def make_tree(self) -> tuple[tempfile.TemporaryDirectory[str], Path]:
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        fixture_root = root / "apps/web/tests/fixtures/a2ui"
        fixture = fixture_root / "upstream/chat_confirm/downlink.json"
        fixture.parent.mkdir(parents=True)
        fixture.write_bytes(FIXTURE_BYTES)

        manifest = {
            "schema_version": 1,
            "catalog_version": "v1.0",
            "source_repository": "Phytomni-Bot",
            "fixtures": [
                {
                    "id": "synthetic-confirm",
                    "class": "upstream-projection",
                    "contract_kind": "open_surface",
                    "partial": True,
                    "source_commit": "synthetic-source-commit",
                    "source_path": "docs/contracts/a2ui/chat_confirm/downlink.json",
                    "sha256": hashlib.sha256(FIXTURE_BYTES).hexdigest(),
                    "file": "upstream/chat_confirm/downlink.json",
                }
            ],
        }
        self.write(root, "apps/web/tests/fixtures/a2ui/manifest.json", manifest)

        self.write(
            root,
            "apps/web/src/views/chat/streaming/a2uiAction.ts",
            """
type A2uiActionTransport = (
  envelope: A2uiActionEnvelope,
) => Promise<A2uiActionResponse>;
export function sendA2uiAction(
  envelope: A2uiActionEnvelope,
  transport: A2uiActionTransport,
): Promise<A2uiActionResponse> {
  return transport(envelope);
}
""",
        )
        self.write(
            root,
            "apps/server/http/router/api.go",
            """
func Api(r *gin.RouterGroup) {
  a2uiRouter := r.Group("api/v1").Use(
    middleware.A2uiJSONGuard(),
    middleware.OperationLog(),
  )
  a2uiRouter.POST("/conversations/:id/a2ui-actions", apiHandler.A2uiAction)
}
""",
        )
        self.write(
            root,
            "apps/server/middleware/operation_log.go",
            """
const a2uiActionAuditMask = "[REDACTED]"
func redactA2uiActionBody(body []byte) string {
  masked, _ := json.Marshal(a2uiActionAuditBody{Payload: a2uiActionAuditMask})
  return string(masked)
}
""",
        )
        self.write(
            root,
            "apps/server/external/bot/a2ui_action.go",
            """
const A2uiActionMaxResponseBytes int64 = 1 << 20
func readResponse(resp *http.Response) ([]byte, error) {
  return io.ReadAll(io.LimitReader(resp.Body, A2uiActionMaxResponseBytes+1))
}
""",
        )
        self.write(
            root,
            "apps/server/config/app.yml.example",
            """
bot:
  stream_enabled: false
  a2ui_actions_enabled: false
""",
        )
        self.write(
            root,
            "apps/server/external/bot/config.go",
            "// A2uiActionsEnabled returns a local 503 while the flag is false.\n",
        )
        self.write(root, "docs/frontend-design-system.md", "\n".join(DOC_REQUIRED_MARKERS))
        return temporary, root

    @staticmethod
    def write(root: Path, relative: str, value: object) -> None:
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(value, (dict, list)):
            path.write_text(json.dumps(value), encoding="utf-8")
        else:
            path.write_text(str(value), encoding="utf-8")

    def run_checker(self, root: Path) -> tuple[int, str]:
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            code = checker.main(["--root", str(root)])
        return code, output.getvalue()

    def assert_fails(self, root: Path, marker: str) -> None:
        code, output = self.run_checker(root)
        self.assertNotEqual(code, 0, output)
        self.assertIn(marker, output)

    def test_complete_synthetic_tree_prints_only_stable_pass_line(self) -> None:
        temporary, root = self.make_tree()
        self.addCleanup(temporary.cleanup)
        code, output = self.run_checker(root)
        self.assertEqual(code, 0, output)
        self.assertEqual(output.strip(), "A2UI activation contract: PASS")

    def test_manifest_hash_mismatch_fails(self) -> None:
        temporary, root = self.make_tree()
        self.addCleanup(temporary.cleanup)
        manifest_path = root / "apps/web/tests/fixtures/a2ui/manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["fixtures"][0]["sha256"] = "0" * 64
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        self.assert_fails(root, "sha256 mismatch")

    def test_missing_fixture_fails(self) -> None:
        temporary, root = self.make_tree()
        self.addCleanup(temporary.cleanup)
        (root / "apps/web/tests/fixtures/a2ui/upstream/chat_confirm/downlink.json").unlink()
        self.assert_fails(root, "missing fixture")

    def test_orphan_fixture_fails(self) -> None:
        temporary, root = self.make_tree()
        self.addCleanup(temporary.cleanup)
        self.write(
            root,
            "apps/web/tests/fixtures/a2ui/http/orphan.json",
            {"synthetic": True},
        )
        self.assert_fails(root, "orphan fixture")

    def test_escaping_fixture_path_fails(self) -> None:
        temporary, root = self.make_tree()
        self.addCleanup(temporary.cleanup)
        manifest_path = root / "apps/web/tests/fixtures/a2ui/manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["fixtures"][0]["file"] = "../outside.json"
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        self.assert_fails(root, "escapes fixture root")

    def test_staging_capture_and_unclassified_fixtures_fail(self) -> None:
        for field, value, marker in (
            ("class", "staging-capture", "staging-capture"),
            ("class", "unknown", "unclassified"),
            ("contract_kind", "unknown", "unclassified"),
        ):
            with self.subTest(field=field, value=value):
                temporary, root = self.make_tree()
                self.addCleanup(temporary.cleanup)
                manifest_path = root / "apps/web/tests/fixtures/a2ui/manifest.json"
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                manifest["fixtures"][0][field] = value
                manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
                self.assert_fails(root, marker)

    def test_action_transport_forbids_global_dedup_and_void_reply(self) -> None:
        markers = ("sentIds", "_resetA2uiActionIdempotencyForTests", "Promise<void>")
        for marker in markers:
            with self.subTest(marker=marker):
                temporary, root = self.make_tree()
                self.addCleanup(temporary.cleanup)
                path = root / "apps/web/src/views/chat/streaming/a2uiAction.ts"
                path.write_text(path.read_text(encoding="utf-8") + marker, encoding="utf-8")
                self.assert_fails(root, marker)

    def test_action_route_must_be_registered_exactly_once(self) -> None:
        temporary, root = self.make_tree()
        self.addCleanup(temporary.cleanup)
        path = root / "apps/server/http/router/api.go"
        original = path.read_text(encoding="utf-8")
        route = '  a2uiRouter.POST("/conversations/:id/a2ui-actions", apiHandler.A2uiAction)\n'
        path.write_text(original.replace(route, ""), encoding="utf-8")
        self.assert_fails(root, "action route count")

        path.write_text(original + route, encoding="utf-8")
        self.assert_fails(root, "action route count")

    def test_action_route_requires_guard_before_operation_log(self) -> None:
        temporary, root = self.make_tree()
        self.addCleanup(temporary.cleanup)
        path = root / "apps/server/http/router/api.go"
        text = path.read_text(encoding="utf-8")
        text = text.replace(
            "    middleware.A2uiJSONGuard(),\n    middleware.OperationLog(),",
            "    middleware.OperationLog(),\n    middleware.A2uiJSONGuard(),",
        )
        path.write_text(text, encoding="utf-8")
        self.assert_fails(root, "A2uiJSONGuard must precede OperationLog")

    def test_audit_and_body_limit_invariants_are_required(self) -> None:
        temporary, root = self.make_tree()
        self.addCleanup(temporary.cleanup)
        audit = root / "apps/server/middleware/operation_log.go"
        audit.write_text(
            audit.read_text(encoding="utf-8").replace("[REDACTED]", "[redacted]"),
            encoding="utf-8",
        )
        self.assert_fails(root, "whole-payload")

        audit.write_text(
            "const a2uiActionAuditMask = \"[REDACTED]\"\n"
            "func redactA2uiActionBody(body []byte) string { return \"x\" }\n",
            encoding="utf-8",
        )
        bot = root / "apps/server/external/bot/a2ui_action.go"
        bot.write_text(
            bot.read_text(encoding="utf-8").replace(
                "io.LimitReader(resp.Body, A2uiActionMaxResponseBytes+1)",
                "io.ReadAll(resp.Body)",
            ),
            encoding="utf-8",
        )
        self.assert_fails(root, "1 MiB LimitReader")

    def test_stream_and_action_flags_must_default_off(self) -> None:
        for key in ("stream_enabled", "a2ui_actions_enabled"):
            with self.subTest(key=key):
                temporary, root = self.make_tree()
                self.addCleanup(temporary.cleanup)
                config = root / "apps/server/config/app.yml.example"
                config.write_text(
                    config.read_text(encoding="utf-8").replace(
                        f"{key}: false", f"{key}: true"
                    ),
                    encoding="utf-8",
                )
                self.assert_fails(root, f"{key} default must be false")

    def test_config_governance_rejects_stale_launch_promises(self) -> None:
        stale_markers = (
            "until Bot P0 ships",
            "until Bot accept ships",
            "Bot-shaped 403 stub",
            "Bot endpoint existence alone authorizes activation",
        )
        for marker in stale_markers:
            for relative in (
                "apps/server/config/app.yml.example",
                "apps/server/external/bot/config.go",
            ):
                with self.subTest(marker=marker, relative=relative):
                    temporary, root = self.make_tree()
                    self.addCleanup(temporary.cleanup)
                    config = root / relative
                    config.write_text(
                        config.read_text(encoding="utf-8") + f"\n# {marker}\n",
                        encoding="utf-8",
                    )
                    self.assert_fails(root, marker)

    def test_design_system_requires_the_activation_lifecycle_contract(self) -> None:
        for marker in DOC_REQUIRED_MARKERS:
            with self.subTest(marker=marker):
                temporary, root = self.make_tree()
                self.addCleanup(temporary.cleanup)
                doc = root / "docs/frontend-design-system.md"
                doc.write_text(
                    doc.read_text(encoding="utf-8").replace(marker, ""),
                    encoding="utf-8",
                )
                self.assert_fails(root, marker)

    def test_design_system_rejects_unbacked_environment_proof_claims(self) -> None:
        temporary, root = self.make_tree()
        self.addCleanup(temporary.cleanup)
        doc = root / "docs/frontend-design-system.md"
        doc.write_text(
            doc.read_text(encoding="utf-8") + "\nProduction\nproof is complete.\n",
            encoding="utf-8",
        )
        self.assert_fails(root, "unbacked environment proof claim")


if __name__ == "__main__":
    unittest.main()
