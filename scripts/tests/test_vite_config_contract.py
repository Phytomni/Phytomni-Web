"""Characterize the production Vite configuration before typing its plugins."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

REPO_ROOT = Path(__file__).resolve().parents[2]
WEB_ROOT = REPO_ROOT / "apps" / "web"
PLUGIN_ROOT = WEB_ROOT / "vite" / "plugins"
CHECKPOINT = (
    REPO_ROOT
    / ".codex"
    / "specs"
    / "2026-07-24-frontend-toolchain-vite5-checkpoint.md"
)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_vite_plugin_modules_are_typed_and_keep_the_ordered_pipeline() -> None:
    plugin_index = _read(PLUGIN_ROOT / "index.ts")

    assert "import vue from \"@vitejs/plugin-vue\";" in plugin_index
    assert "import vueJsx from \"@vitejs/plugin-vue-jsx\";" in plugin_index
    assert "createAutoImport" in plugin_index
    assert "createCompression" in plugin_index
    assert re.search(
        r"vue\(\).*vueJsx\(\).*createAutoImport\(\)",
        plugin_index,
        flags=re.DOTALL,
    )
    assert "if (isBuild) vitePlugins.push(...createCompression(viteEnv));" in plugin_index


def test_plugin_factories_preserve_runtime_contracts() -> None:
    package = json.loads((WEB_ROOT / "package.json").read_text(encoding="utf-8"))
    auto_import = _read(PLUGIN_ROOT / "auto-import.ts")
    compression = _read(PLUGIN_ROOT / "compression.ts")

    assert package["devDependencies"]["npm-run-all2"] == "9.0.2"
    assert "npm-run-all" not in package["devDependencies"]
    assert package["devDependencies"]["unplugin-auto-import"] == "21.0.0"
    assert package["scripts"]["build"] == "run-p type-check build-only"
    assert package["scripts"]["build-only:raw"] == "vite build --mode production"
    assert (
        package["scripts"]["build-only"]
        == "node scripts/quality/run-with-warning-oracle.mjs build"
    )
    assert package["scripts"]["test:run"] == "vitest run"
    assert package["scripts"]["coverage"] == "vitest run --coverage"
    assert 'imports: ["vue", "vue-router", "pinia"]' in auto_import
    assert "dts: false" in auto_import
    assert "PluginOption" in auto_import
    assert "as Plugin" not in auto_import
    assert package["devDependencies"]["vite-plugin-compression2"] == "2.5.3"
    assert "vite-plugin-compression" not in package["devDependencies"]
    assert 'import { compression } from "vite-plugin-compression2";' in compression
    assert "export function parseCompressionAlgorithms" in compression
    assert '(value ?? "")' in compression
    assert '.split(",")' in compression
    assert 'requested.has("gzip")' in compression
    assert 'requested.has("brotli")' in compression
    assert "deleteOriginalAssets: false" in compression


def test_unused_vite_plugins_and_fake_scss_package_are_absent() -> None:
    package = json.loads((WEB_ROOT / "package.json").read_text(encoding="utf-8"))
    plugin_index = _read(PLUGIN_ROOT / "index.ts")

    assert "createSetupExtend" not in plugin_index
    assert "createSvgIcon" not in plugin_index
    assert "vite-plugin-vue-setup-extend" not in package["devDependencies"]
    assert "vite-plugin-svg-icons" not in package["devDependencies"]
    assert "scss" not in package["devDependencies"]
    assert not (PLUGIN_ROOT / "setup-extend.ts").exists()
    assert not (PLUGIN_ROOT / "svg-icon.ts").exists()


def test_vite_config_keeps_proxy_alias_and_chunk_contracts() -> None:
    config = _read(WEB_ROOT / "vite.config.mts")

    assert 'import createVitePlugins from "./vite/plugins";' in config
    assert 'const devProxyApi = env.VITE_DEV_PROXY_API || "http://localhost:8080";' in config
    assert '"/api/v1"' in config
    assert 'includes("text/event-stream")' in config
    assert "setNoDelay" in config
    assert '"@": fileURLToPath(new URL("./src", import.meta.url))' in config
    assert '"vue-i18n": ["vue-i18n"]' in config
    assert 'locales: ["./src/locales"]' in config


def test_vite_toolchain_uses_the_checkpoint_versions_and_modern_sass_api() -> None:
    package = json.loads((WEB_ROOT / "package.json").read_text(encoding="utf-8"))
    vite_config = _read(WEB_ROOT / "vite.config.mts")

    expected_versions = {
        "vite": "5.4.21",
        "@vitejs/plugin-vue": "6.0.8",
        "@vitejs/plugin-vue-jsx": "5.1.6",
        "sass": "1.101.7",
        "@types/node": "20.19.31",
    }
    for name, version in expected_versions.items():
        assert package["devDependencies"][name] == version
    assert 'api: "modern"' in vite_config


def test_vite5_checkpoint_is_explicitly_diagnostic_and_evidence_backed() -> None:
    checkpoint = _read(CHECKPOINT)

    assert "Diagnostic only — not releasable" in checkpoint
    assert "Vite | `5.4.21`" in checkpoint
    assert "205 files passed and 2,709 tests passed" in checkpoint
    assert "VITE_BUILD_COMPRESS=gzip,brotli npm run build-only" in checkpoint
    assert "Vite CJS Node API warning | 0" in checkpoint


def test_application_typecheck_uses_the_target_esnext_library() -> None:
    config = json.loads(
        (WEB_ROOT / "tsconfig.json").read_text(encoding="utf-8")
    )
    config_project = json.loads(
        (WEB_ROOT / "tsconfig.config.json").read_text(encoding="utf-8")
    )

    assert "ESNext" in config["compilerOptions"]["lib"]
    assert "vite" not in config["include"]
    assert "vite/**/*.ts" in config_project["include"]
