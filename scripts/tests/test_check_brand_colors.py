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

    def test_allows_component_transition_all(self) -> None:
        hits = self.run_scan("component.vue", ".button {\n  transition: all 0.2s ease;\n}\n")
        self.assertEqual(hits, [])

    def test_allows_specific_position_relative(self) -> None:
        hits = self.run_scan("component.vue", ".button {\n  position: relative;\n}\n")
        self.assertEqual(hits, [])

    def test_scans_multiline_backdrop_filter_declaration(self) -> None:
        hits = self.run_scan("glass.css", ".card {\n  backdrop-filter:\n    blur(12px);\n}\n")
        self.assertTrue(any("backdrop-filter" in hit for hit in hits))


if __name__ == "__main__":
    unittest.main()
