"""Contract tests for structured repository-file validation."""

from __future__ import annotations

from pathlib import Path

import pytest

from scripts.check_repository_files import (
    check_file,
    check_json_text,
    check_markdown_text,
    formatting_paths,
    parse_only_reason,
    read_nul_paths,
)

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]
PRETTIER = ROOT / "apps" / "web" / "node_modules" / ".bin" / "prettier"


def test_duplicate_json_keys_are_reported() -> None:
    findings = check_json_text("config.json", '{"mode": 1, "mode": 2}\n')

    assert [finding.rule for finding in findings] == ["duplicate-json-key"]


def test_malformed_json_is_reported_without_printing_content() -> None:
    findings = check_json_text("config.json", '{"mode": }\n')

    assert findings[0].rule == "json-parse"
    assert "mode" not in findings[0].message


def test_markdown_checks_fences_headings_and_links() -> None:
    text = (
        "# Root\n"
        "### Outside jump\n"
        "```text\n"
        "###### code heading\n"
        "```\n"
        "[code heading](file:///tmp/report)\n"
    )

    findings = check_markdown_text("docs/guide.md", text)
    rules = [finding.rule for finding in findings]

    assert rules.count("heading-jump") == 1
    assert "unsafe-link" in rules
    assert all(finding.line != 4 for finding in findings)


def test_markdown_reports_open_fence_and_empty_destination() -> None:
    findings = check_markdown_text("docs/guide.md", "# Root\n[x]()\n```\n")

    assert {finding.rule for finding in findings} == {
        "unclosed-fence",
        "empty-link",
    }


def test_nul_scope_preserves_paths_with_spaces_and_empty_scope() -> None:
    assert read_nul_paths(b"docs/with space.md\0apps/web/src/view.ts\0") == (
        "docs/with space.md",
        "apps/web/src/view.ts",
    )
    assert read_nul_paths(b"") == ()


def test_formatting_scope_excludes_parse_only_fixtures_and_package_lock() -> None:
    paths = tuple(
        Path(path)
        for path in (
            "docs/with space.md",
            "apps/web/package-lock.json",
            "apps/web/tests/fixtures/a2ui/manifest.json",
            "apps/web/src/legal/terms.en-US.md",
        )
    )

    assert formatting_paths(paths) == (Path("docs/with space.md"),)
    assert parse_only_reason(Path("apps/web/package-lock.json"))
    assert parse_only_reason(Path("docs/development/static-analysis-exemptions.md"))
    assert parse_only_reason(Path("apps/web/tests/fixtures/a2ui/manifest.json"))
    assert parse_only_reason(Path("apps/web/src/legal/terms.en-US.md"))


def test_malformed_yaml_is_reported_by_pinned_prettier(tmp_path: Path) -> None:
    path = tmp_path / "bad.yaml"
    path.write_text("items: [\n", encoding="utf-8")

    findings = check_file(path, root=tmp_path, prettier_bin=PRETTIER)

    assert findings
    assert findings[0].rule == "yaml-parse"
