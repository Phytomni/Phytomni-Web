from pathlib import Path
import importlib.util

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "scripts" / "check_brand_colors.py"


def load_mod():
    spec = importlib.util.spec_from_file_location("check_brand_colors", SPEC)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_detects_banned_hex(tmp_path):
    mod = load_mod()
    sample = tmp_path / "x.vue"
    sample.write_text("color: #626aef;\n", encoding="utf-8")
    hits = mod.scan_paths([sample])
    assert any("626aef" in h.lower() for h in hits)


def test_allows_clean_file(tmp_path):
    mod = load_mod()
    sample = tmp_path / "y.vue"
    sample.write_text("color: var(--phy-color-primary);\n", encoding="utf-8")
    assert mod.scan_paths([sample]) == []


def test_ignores_tokens_ts_basename(tmp_path):
    mod = load_mod()
    sample = tmp_path / "tokens.ts"
    sample.write_text('export const x = "#626aef";\n', encoding="utf-8")
    assert mod.scan_paths([sample]) == []
