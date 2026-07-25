"""Enforce the supported Vite 8 dependency and configuration boundary."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

import pytest

pytestmark = pytest.mark.unit

REPO_ROOT = Path(__file__).resolve().parents[2]
WEB_ROOT = REPO_ROOT / "apps" / "web"

EXPECTED_DIRECT_VERSIONS = {
    "vite": "8.1.5",
    "@vitejs/plugin-vue": "6.0.8",
    "@vitejs/plugin-vue-jsx": "5.1.6",
    "vitest": "4.1.10",
    "@vitest/coverage-v8": "4.1.10",
    "@vue/test-utils": "2.4.11",
    "happy-dom": "20.11.1",
    "vue": "3.5.40",
    "pinia": "4.0.2",
    "vue-i18n": "11.4.7",
    "element-plus": "2.14.3",
    "vue-router": "5.2.0",
    "typescript": "6.0.3",
    "vue-tsc": "3.3.8",
    "@vue/tsconfig": "0.9.1",
    "@types/node": "26.1.1",
    "eslint": "10.7.0",
    "@eslint/js": "10.0.1",
    "eslint-plugin-vue": "10.10.0",
    "@vue/eslint-config-typescript": "14.9.0",
    "@vue/eslint-config-prettier": "10.2.0",
    "globals": "17.7.0",
    "prettier": "3.9.6",
    "sass": "1.101.7",
    "unplugin-auto-import": "21.0.0",
    "vite-plugin-compression2": "2.5.3",
    "npm-run-all2": "9.0.2",
}

FORBIDDEN_DIRECT_PACKAGES = {
    "rolldown-vite",
    "vite-plugin-compression",
    "vite-plugin-svg-icons",
    "vite-plugin-vue-setup-extend",
    "scss",
    "npm-run-all",
    "@rushstack/eslint-patch",
}


def _package_json() -> dict[str, Any]:
    return json.loads((WEB_ROOT / "package.json").read_text(encoding="utf-8"))


def _lockfile() -> dict[str, Any]:
    return json.loads((WEB_ROOT / "package-lock.json").read_text(encoding="utf-8"))


def _config() -> str:
    return (WEB_ROOT / "vite.config.mts").read_text(encoding="utf-8")


def _direct_packages(package: dict[str, Any]) -> dict[str, str]:
    return {
        **package.get("dependencies", {}),
        **package.get("devDependencies", {}),
    }


def _walk_dependency_graph(
    node: dict[str, Any],
    path: str = "root",
) -> tuple[list[tuple[str, str]], list[tuple[str, str, str]]]:
    vite_nodes: list[tuple[str, str]] = []
    invalid_nodes: list[tuple[str, str, str]] = []

    for name, dependency in node.get("dependencies", {}).items():
        if not isinstance(dependency, dict):
            continue
        dependency_path = f"{path}/{name}"
        if name == "vite":
            version = dependency.get("version")
            vite_nodes.append((dependency_path, str(version)))
        for field in ("extraneous", "invalid", "missing"):
            if dependency.get(field):
                invalid_nodes.append((dependency_path, field, str(dependency[field])))
        nested_vite, nested_invalid = _walk_dependency_graph(
            dependency, dependency_path
        )
        vite_nodes.extend(nested_vite)
        invalid_nodes.extend(nested_invalid)

    return vite_nodes, invalid_nodes


def _npm_graph() -> dict[str, Any]:
    result = subprocess.run(
        ["npm", "ls", "--all", "--json"],
        cwd=WEB_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    graph = json.loads(result.stdout)
    assert not graph.get("problems"), graph.get("problems")
    return graph


def test_final_direct_dependency_matrix_is_exact_and_has_no_transitional_packages() -> None:
    package = _package_json()
    direct = _direct_packages(package)

    for name, version in EXPECTED_DIRECT_VERSIONS.items():
        assert direct.get(name) == version, name
    assert not FORBIDDEN_DIRECT_PACKAGES.intersection(direct)
    assert "overrides" not in package


def test_final_lockfile_uses_vite_8_without_the_diagnostic_alias() -> None:
    lock = _lockfile()
    packages = lock["packages"]
    vite = packages["node_modules/vite"]

    assert vite["version"] == "8.1.5"
    assert vite["resolved"].endswith("/vite-8.1.5.tgz")
    assert "node_modules/rolldown-vite" not in packages
    assert all("rolldown-vite" not in value for value in packages)


def test_npm_graph_has_one_supported_vite_core_and_no_invalid_nodes() -> None:
    vite_nodes, invalid_nodes = _walk_dependency_graph(_npm_graph())

    assert invalid_nodes == []
    assert vite_nodes
    assert all(version == "8.1.5" for _, version in vite_nodes), vite_nodes
    assert all("rolldown-vite" not in path for path, _ in vite_nodes)


def test_final_vite_config_uses_browser_floor_and_supported_rolldown_options() -> None:
    config = _config()

    assert 'target: ["chrome111", "edge111", "firefox114", "safari16.4"]' in config
    assert "rolldownOptions:" in config
    assert "codeSplitting:" in config
    assert 'name: "vue-i18n"' in config
    assert 'name: "locales"' not in config
    assert "advancedChunks" not in config
    assert "manualChunks" not in config
    assert "rollupOptions" not in config
    assert "preprocessorOptions" not in config
    assert 'api: "modern"' not in config


def test_vite_plugins_keep_only_supported_first_party_build_owners() -> None:
    plugin_index = (WEB_ROOT / "vite" / "plugins" / "index.ts").read_text(
        encoding="utf-8"
    )
    package = _package_json()
    direct = _direct_packages(package)

    assert "createSetupExtend" not in plugin_index
    assert "createSvgIcon" not in plugin_index
    assert "vite-plugin-vue-setup-extend" not in direct
    assert "vite-plugin-svg-icons" not in direct
    assert "vite-plugin-compression2" in direct
    assert "vite-plugin-compression" not in direct


def test_frontend_runtime_scripts_keep_raw_commands_diagnostic_only() -> None:
    scripts = _package_json()["scripts"]

    assert scripts["build"] == "run-p type-check build-only"
    assert scripts["build-only"] == (
        "node scripts/quality/run-with-warning-oracle.mjs build"
    )
    assert scripts["test:run"] == (
        "npm run test:warning-oracle && "
        "node scripts/quality/run-with-warning-oracle.mjs test"
    )
    assert scripts["coverage"] == (
        "npm run test:warning-oracle && "
        "node scripts/quality/run-with-warning-oracle.mjs coverage"
    )

    for name in ("build-only:raw", "test:run:raw", "coverage:raw"):
        assert name in scripts
