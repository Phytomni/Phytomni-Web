"""Tests for the read-only frontend visual contract scanner."""

from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts" / "check_brand_colors.py"


def load_mod():
    spec = importlib.util.spec_from_file_location("check_brand_colors", SPEC)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load scanner module from {SPEC}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class CheckBrandColorsTests(unittest.TestCase):
    def run_scan(self, filename: str, content: str) -> list[str]:
        mod = load_mod()
        with tempfile.TemporaryDirectory() as directory:
            sample = Path(directory) / filename
            sample.write_text(content, encoding="utf-8")
            return mod.scan_paths([sample])

    def test_detects_banned_hex(self) -> None:
        hits = self.run_scan("x.vue", "color: #626aef;\n")
        self.assertTrue(any("626aef" in hit.lower() for hit in hits))

    def test_allows_clean_file(self) -> None:
        hits = self.run_scan("y.vue", "color: var(--phy-color-primary);\n")
        self.assertEqual(hits, [])

    def test_ignores_tokens_ts_basename(self) -> None:
        hits = self.run_scan("tokens.ts", 'export const x = "#626aef";\n')
        self.assertEqual(hits, [])

    def test_rejects_backdrop_filter_declaration(self) -> None:
        hits = self.run_scan("glass.css", ".card {\n  backdrop-filter: blur(12px);\n}\n")
        self.assertTrue(any("backdrop-filter" in hit for hit in hits))

    def test_rejects_prefixed_backdrop_filter_declaration(self) -> None:
        hits = self.run_scan(
            "glass.css", ".card {\n  -webkit-backdrop-filter: blur(12px);\n}\n"
        )
        self.assertTrue(any("backdrop-filter" in hit for hit in hits))

    def test_rejects_global_wildcard_position_relative(self) -> None:
        hits = self.run_scan("global.css", "* {\n  position: relative;\n}\n")
        self.assertTrue(any("global wildcard position" in hit for hit in hits))

    def test_rejects_global_wildcard_transition(self) -> None:
        hits = self.run_scan("global.css", "*, *::before {\n  transition: opacity 0.2s ease;\n}\n")
        self.assertTrue(any("global wildcard transition" in hit for hit in hits))

    def test_rejects_component_transition_all(self) -> None:
        hits = self.run_scan("component.vue", ".button {\n  transition: all 0.2s ease;\n}\n")
        self.assertTrue(any("transition: all" in hit for hit in hits))

    def test_allows_specific_position_relative(self) -> None:
        hits = self.run_scan("component.vue", ".button {\n  position: relative;\n}\n")
        self.assertEqual(hits, [])

    def test_rejects_outline_suppression(self) -> None:
        for value in ("none", "0", "unset"):
            with self.subTest(value=value):
                hits = self.run_scan(
                    "focus.css", f".button {{\n  outline: {value};\n}}\n"
                )
                self.assertTrue(any("outline suppression" in hit for hit in hits))

    def test_rejects_page_local_theme_selector(self) -> None:
        hits = self.run_scan("page.css", ".theme-dark {\n  color: black;\n}\n")
        self.assertTrue(any("page-local .theme-dark" in hit for hit in hits))

    def test_allows_exact_semantic_theme_selector_file(self) -> None:
        mod = load_mod()
        hits = mod.scan_paths([ROOT / "apps/web/src/styles/tokens.css"])
        self.assertEqual(hits, [])

    def test_rejects_retired_visual_marker(self) -> None:
        hits = self.run_scan("legacy.vue", '<div class="app-footer"></div>\n')
        self.assertTrue(any("retired visual marker" in hit for hit in hits))

    def test_rejects_glass_bubble_surface(self) -> None:
        hits = self.run_scan(
            "bubble.css",
            ".phy-bubble-user {\n  background: rgba(255, 255, 255, 0.4);\n}\n",
        )
        self.assertTrue(any("glass bubble surface" in hit for hit in hits))

    def test_rejects_unauthorized_viewport_height(self) -> None:
        hits = self.run_scan(
            "page.vue", ".page {\n  height: 100vh;\n  height: 100dvh;\n}\n"
        )
        self.assertTrue(any("unauthorized 100vh" in hit for hit in hits))

    def test_does_not_allow_viewport_exception_in_another_file(self) -> None:
        hits = self.run_scan(
            "wrong-owner.vue",
            ".phy-auth-layout {\n  height: 100vh;\n}\n",
        )
        self.assertTrue(any("unauthorized 100vh" in hit for hit in hits))

    def test_allows_only_the_exact_viewport_scroll_owners(self) -> None:
        mod = load_mod()
        paths = [
            ROOT / "apps/web/src/components/shell/PhyAuthLayout.vue",
            ROOT / "apps/web/src/components/shell/PhyAdaptiveShell.vue",
            ROOT / "apps/web/src/views/help/HelpView.vue",
            ROOT / "apps/web/src/views/legal/LegalView.vue",
            ROOT / "apps/web/src/components/demo/AgentDemoShell.vue",
        ]
        hits = mod.scan_paths(paths)
        self.assertFalse(
            [hit for hit in hits if "100vh" in hit],
            msg="unexpected viewport exception hit: " + repr(hits),
        )

    def test_rejects_fixed_footer_owner(self) -> None:
        hits = self.run_scan(
            "footer.css", ".route-footer {\n  position: fixed;\n}\n"
        )
        self.assertTrue(any("fixed Footer owner" in hit for hit in hits))

    def test_scans_multiline_backdrop_filter_declaration(self) -> None:
        hits = self.run_scan("glass.css", ".card {\n  backdrop-filter:\n    blur(12px);\n}\n")
        self.assertTrue(any("backdrop-filter" in hit for hit in hits))


if __name__ == "__main__":
    unittest.main()
