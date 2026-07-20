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


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_vite_plugin_modules_are_typed_and_keep_the_ordered_pipeline() -> None:
    plugin_index = _read(PLUGIN_ROOT / "index.ts")

    assert "import vue from \"@vitejs/plugin-vue\";" in plugin_index
    assert "import vueJsx from \"@vitejs/plugin-vue-jsx\";" in plugin_index
    assert "createAutoImport" in plugin_index
    assert "createSetupExtend" in plugin_index
    assert "createSvgIcon" in plugin_index
    assert "createCompression" in plugin_index
    assert re.search(
        r"vue\(\).*vueJsx\(\).*createAutoImport\(\).*"
        r"createSetupExtend\(\).*createSvgIcon\(isBuild\)",
        plugin_index,
        flags=re.DOTALL,
    )
    assert "if (isBuild) vitePlugins.push(...createCompression(viteEnv));" in plugin_index


def test_plugin_factories_preserve_runtime_contracts() -> None:
    auto_import = _read(PLUGIN_ROOT / "auto-import.ts")
    compression = _read(PLUGIN_ROOT / "compression.ts")
    setup_extend = _read(PLUGIN_ROOT / "setup-extend.ts")
    svg_icon = _read(PLUGIN_ROOT / "svg-icon.ts")

    assert 'imports: ["vue", "vue-router", "pinia"]' in auto_import
    assert "dts: false" in auto_import
    assert 'VITE_BUILD_COMPRESS.split(",")' in compression
    assert 'includes("gzip")' in compression
    assert 'includes("brotli")' in compression
    assert "algorithm: \"brotliCompress\"" in compression
    assert "return setupExtend();" in setup_extend
    assert 'symbolId: "icon-[dir]-[name]"' in svg_icon
    assert "svgoOptions: isBuild" in svg_icon


def test_vite_config_keeps_proxy_alias_and_chunk_contracts() -> None:
    config = _read(WEB_ROOT / "vite.config.ts")

    assert 'import createVitePlugins from "./vite/plugins";' in config
    assert 'const devProxyApi = env.VITE_DEV_PROXY_API || "http://localhost:8080";' in config
    assert '"/api/v1"' in config
    assert 'includes("text/event-stream")' in config
    assert "setNoDelay" in config
    assert '"@": fileURLToPath(new URL("./src", import.meta.url))' in config
    assert '"vue-i18n": ["vue-i18n"]' in config
    assert 'locales: ["./src/locales"]' in config


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
