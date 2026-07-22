"""Policy tests for the type-aware frontend ESLint project."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]
WEB_ROOT = ROOT / "apps" / "web"
BRIDGE = WEB_ROOT / "scripts" / "quality" / "eslint-inventory.mjs"
PROJECT = WEB_ROOT / "tsconfig.eslint.json"
ESLINT_CONFIG = WEB_ROOT / ".eslintrc.cjs"


def _tracked_frontend_type_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "apps/web"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return [
        path.removeprefix("apps/web/")
        for path in result.stdout.splitlines()
        if path.endswith((".ts", ".tsx", ".vue"))
    ]


def test_eslint_project_covers_every_linted_typescript_file() -> None:
    document = json.loads(PROJECT.read_text(encoding="utf-8"))

    assert document["extends"] == "./tsconfig.json"
    assert set(document["include"]) == {
        "env.d.ts",
        "src/**/*.ts",
        "src/**/*.vue",
        "tests/**/*.ts",
        "tests/**/*.vue",
        "vite/**/*.ts",
        "vite.config.ts",
        "vitest.config.ts",
    }
    allowed = ("src/", "tests/", "vite/")
    exact = {"env.d.ts", "vite.config.ts", "vitest.config.ts"}
    assert all(path.startswith(allowed) or path in exact for path in _tracked_frontend_type_files())


def test_eslint_project_uses_an_include_only_first_party_scope() -> None:
    document = json.loads(PROJECT.read_text(encoding="utf-8"))

    assert "exclude" not in document


def test_parser_project_is_scoped_to_typescript_and_vue_files() -> None:
    text = ESLINT_CONFIG.read_text(encoding="utf-8")

    assert 'files: ["**/*.ts", "**/*.tsx", "**/*.vue"]' in text
    assert 'project: "./tsconfig.eslint.json"' in text
    assert "tsconfigRootDir: __dirname" in text


def test_vue_component_names_are_checked_by_the_rule() -> None:
    text = ESLINT_CONFIG.read_text(encoding="utf-8")

    assert '"vue/multi-word-component-names": "error"' in text
    assert '"vue/multi-word-component-names": "off"' not in text


def test_handled_promise_rule_is_strictly_scoped_for_bootstrap_auth_batch() -> None:
    text = ESLINT_CONFIG.read_text(encoding="utf-8")

    assert '"@typescript-eslint/no-floating-promises": [' in text
    assert '"error",' in text
    assert "{ ignoreVoid: false }" in text
    assert "ignoreVoid: true" not in text
    for path in (
        "src/main.ts",
        "src/utils/request.ts",
        "src/layout/LayoutView.vue",
        "src/views/change-password/ChangePasswordView.vue",
        "src/views/error/UnauthorizedView.vue",
        "src/views/forgot-password/ForgotPasswordView.vue",
        "src/views/login/LoginView.vue",
        "src/views/register/RegisterView.vue",
    ):
        assert f'"{path}"' in text


def test_handled_promise_rule_is_strictly_scoped_for_research_surfaces_batch() -> None:
    text = ESLINT_CONFIG.read_text(encoding="utf-8")

    for path in (
        "src/components/DeepGenomeResultViewer.vue",
        "src/components/research/BotArtifactList.vue",
        "src/components/research/DeepGenomeArtifact.vue",
        "src/components/research/ResearchArtifactShell.vue",
        "src/components/shell/PhyAdaptiveShell.vue",
        "src/components/shell/PhyAdaptiveSidebar.vue",
        "src/composables/useDeepGenomeToc.ts",
        "src/views/digital-design-agent/DigitalDesignAgentView.vue",
        "src/views/gene-network-agent/GeneNetworkAgentView.vue",
        "src/views/research-agent/ResearchAgentView.vue",
    ):
        assert f'"{path}"' in text


def test_handled_promise_rule_is_strictly_scoped_for_data_admin_batch() -> None:
    text = ESLINT_CONFIG.read_text(encoding="utf-8")

    for path in (
        "src/views/admin-management/AdminManagementView.vue",
        "src/views/favorites/FavoritesView.vue",
        "src/views/gene-display/GeneDetailView.vue",
        "src/views/gene-display/GeneDisplayView.vue",
        "src/views/global-config/GlobalConfigView.vue",
        "src/views/help/HelpView.vue",
        "src/views/history/HistoryView.vue",
        "src/views/profile/ProfileView.vue",
        "src/views/task-manager/TaskManagerView.vue",
        "src/views/user-list/UserListView.vue",
    ):
        assert f'"{path}"' in text


def test_handled_promise_rule_is_strictly_scoped_for_chat_composable_batch() -> None:
    text = ESLINT_CONFIG.read_text(encoding="utf-8")

    for path in (
        "src/views/chat/composables/useAgentImages.ts",
        "src/views/chat/composables/useChatHistoryActions.ts",
        "src/views/chat/composables/useComposer.ts",
        "src/views/chat/composables/useCopyDownload.ts",
        "src/views/chat/composables/useFileUpload.ts",
        "src/views/chat/composables/useLogView.ts",
        "src/views/chat/composables/useReactions.ts",
        "src/views/chat/composables/useRefreshMessage.ts",
        "src/views/chat/composables/useSelectChat.ts",
        "src/views/chat/composables/useSendMessage.ts",
        "src/views/chat/composables/useSidebarNavigation.ts",
    ):
        assert f'"{path}"' in text


def test_await_thenable_rule_is_scoped_to_characterized_async_contracts() -> None:
    text = ESLINT_CONFIG.read_text(encoding="utf-8")

    assert '"@typescript-eslint/await-thenable": "error"' in text
    for path in (
        "src/composables/useDeepGenomeDownloads.ts",
        "src/views/chat/composables/useRefreshMessage.ts",
        "src/views/chat/composables/useSelectChat.ts",
        "src/views/chat/composables/useSendMessage.ts",
    ):
        assert f'"{path}"' in text


def test_misused_promises_rule_is_scoped_to_callback_contract_batch() -> None:
    text = ESLINT_CONFIG.read_text(encoding="utf-8")

    assert '"@typescript-eslint/no-misused-promises": [' in text
    assert "checksConditionals: true" in text
    assert "checksSpreads: true" in text
    assert "checksVoidReturn: true" in text
    for path in (
        "src/components/research/ResearchEvidencePanel.vue",
        "src/layout/LayoutView.vue",
        "src/views/change-password/ChangePasswordView.vue",
        "src/views/chat/ChatView.vue",
        "src/views/chat/composables/useComposer.ts",
        "src/views/chat/composables/useFileUpload.ts",
        "src/views/chat/composables/useLogView.ts",
        "src/views/chat/composables/useReactions.ts",
        "src/views/profile/ProfileView.vue",
        "tests/unit/composables/useDeepGenomeDownloads.spec.ts",
        "tests/visual/chat/main.ts",
        "tests/visual/research/main.ts",
    ):
        assert f'"{path}"' in text


def test_unsafe_boundary_rules_are_scoped_to_batch_56a() -> None:
    text = ESLINT_CONFIG.read_text(encoding="utf-8")

    assert '"@typescript-eslint/no-unsafe-assignment": "error"' in text
    assert '"@typescript-eslint/no-unsafe-member-access": "error"' in text
    for path in (
        "src/permission.ts",
        "src/stores/app.ts",
        "src/stores/theme.ts",
        "src/stores/user.ts",
        "src/utils/auth.ts",
        "src/utils/index.ts",
        "src/utils/markdown-inline.ts",
        "src/utils/request.ts",
    ):
        assert f'"{path}"' in text


def test_unsafe_boundary_rules_are_scoped_to_batch_56b() -> None:
    text = ESLINT_CONFIG.read_text(encoding="utf-8")

    assert '"@typescript-eslint/no-unsafe-assignment": "error"' in text
    assert '"@typescript-eslint/no-unsafe-member-access": "error"' in text
    for path in (
        "src/composables/useDeepGenomeDownloads.ts",
        "src/views/change-password/ChangePasswordView.vue",
        "src/views/chat/composables/useBotCapabilities.ts",
        "src/views/chat/composables/useCopyDownload.ts",
        "src/views/chat/composables/useRefreshMessage.ts",
        "src/views/chat/composables/useSelectChat.ts",
        "src/views/chat/composables/useSendMessage.ts",
        "src/views/chat/streaming/a2uiParse.ts",
        "src/views/feedback/FeedbackView.vue",
        "src/views/gene-display/GeneDetailView.vue",
    ):
        assert f'"{path}"' in text


def test_unsafe_propagation_rules_are_scoped_to_characterized_production_owners() -> None:
    text = ESLINT_CONFIG.read_text(encoding="utf-8")

    for rule in (
        '"@typescript-eslint/no-unsafe-call": "error"',
        '"@typescript-eslint/no-unsafe-argument": "error"',
        '"@typescript-eslint/no-unsafe-return": "error"',
    ):
        assert rule in text
    for path in (
        "src/components/MarkdownViewer.vue",
        "src/composables/useDeepGenomeDownloads.ts",
        "src/utils/index.ts",
        "src/utils/request.ts",
        "src/utils/sanitize-markup.ts",
        "src/views/chat/botProjection.ts",
        "src/views/research-agent/ResearchAgentView.vue",
    ):
        assert f'"{path}"' in text


def test_final_frontend_lint_policy_is_strict_and_zero_warning() -> None:
    package = json.loads((WEB_ROOT / "package.json").read_text(encoding="utf-8"))
    lint_raw = package["scripts"]["lint:raw"]
    assert "--max-warnings 0" in lint_raw
    assert "--format json" in lint_raw

    text = ESLINT_CONFIG.read_text(encoding="utf-8")
    for rule in (
        "@typescript-eslint/no-explicit-any",
        "@typescript-eslint/no-non-null-assertion",
        "@typescript-eslint/no-unused-vars",
        "@typescript-eslint/no-floating-promises",
        "@typescript-eslint/no-misused-promises",
        "@typescript-eslint/await-thenable",
        "@typescript-eslint/no-unsafe-assignment",
        "@typescript-eslint/no-unsafe-member-access",
        "@typescript-eslint/no-unsafe-call",
        "@typescript-eslint/no-unsafe-argument",
        "@typescript-eslint/no-unsafe-return",
    ):
        assert f'"{rule}"' in text
        assert f'"{rule}": "off"' not in text

    result = subprocess.run(
        [
            "node",
            str(BRIDGE),
            "--root",
            str(WEB_ROOT),
            "--rule",
            "@typescript-eslint/no-explicit-any=error",
            "--rule",
            "@typescript-eslint/no-non-null-assertion=error",
            "--rule",
            "@typescript-eslint/no-unused-vars=error",
            "--file",
            "src/utils/request.ts",
            "--file",
            "src/utils/sanitize-markup.ts",
            "--file",
            "src/views/chat/botProjection.ts",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["findings"] == []


def test_inventory_rejects_a_file_outside_the_project_root() -> None:
    result = subprocess.run(
        ["node", str(BRIDGE), "--root", str(WEB_ROOT), "--file", "../outside.ts"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode != 0
    assert "outside root" in result.stderr
