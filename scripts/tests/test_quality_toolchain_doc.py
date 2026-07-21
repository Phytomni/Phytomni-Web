"""Contract tests for the development-tool approval packet."""

from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
DOC = REPO_ROOT / "docs" / "development" / "quality-toolchain.md"


TOOL_CONTRACTS = {
    "Staticcheck": ("2025.1.1", "honnef.co/go/tools/cmd/staticcheck"),
    "ShellCheck": ("0.10.0", "github.com/koalaman/shellcheck"),
    "shfmt": ("v3.10.0", "mvdan.cc/sh/v3/cmd/shfmt"),
    "actionlint": ("v1.7.4", "github.com/rhysd/actionlint/cmd/actionlint"),
    "Prettier": ("2.7.1", "prettier@2.7.1"),
    "Python stdlib checker": ("3.12.13", "standard library only"),
}


REQUIRED_FIELDS = (
    "Exact version",
    "Need",
    "Upstream URL",
    "License",
    "Maintainer / release source",
    "Install method",
    "Cryptographic integrity",
    "Cached path",
    "Approximate download / install size",
    "Cold / warm timing",
    "Network behavior",
    "CI cache key",
    "Security implications",
    "Local failure mode",
    "Alternatives",
    "Rollback",
)


def _section(document: str, title: str) -> str:
    start = document.index(f"### {title}")
    remainder = document[start + len(f"### {title}") :]
    next_heading = remainder.find("\n### ")
    return remainder if next_heading == -1 else remainder[:next_heading]


def test_quality_toolchain_packet_has_one_complete_record_per_tool() -> None:
    document = DOC.read_text(encoding="utf-8")

    assert "Task 60 runners approved" in document
    assert "human reviewer approved Task 60" in document
    assert "package-lock.json" in document and "modified" in document

    for title, (version, identity) in TOOL_CONTRACTS.items():
        section = _section(document, title)
        assert version in section, (title, version)
        assert identity in section, (title, identity)
        for field in REQUIRED_FIELDS:
            assert field in section, (title, field)


def test_unverified_evidence_is_explicit_and_not_silently_approved() -> None:
    document = DOC.read_text(encoding="utf-8")

    for tool in ("Staticcheck", "ShellCheck", "shfmt", "actionlint"):
        section = _section(document, tool)
        assert "Needs Verification" in section, tool
        assert "SHA-256" in section or "SHA-256" in document, tool

    assert "GOTOOLCHAIN=auto" in document
    assert "Approved archive SHA-256" in document
    assert "fail closed" in document


def test_official_metadata_addendum_preserves_provenance_boundary() -> None:
    document = DOC.read_text(encoding="utf-8")

    assert "Go 1.24.1" in document
    assert "Go 1.23.2" in document
    assert "GPLv3" in document
    assert "BSD-3-Clause" in document
    assert (
        "6c881ab0698e4e6ea235245f22832860544f17ba386442fe7e9d629f8cbedf87"
        in document
    )
    assert "not treated as approved evidence" in document


def test_approved_linux_evidence_records_all_runner_hashes_and_probes() -> None:
    document = DOC.read_text(encoding="utf-8")

    assert "Approved Linux amd64 evidence" in document
    for value in (
        "ae320e410225295ecb2a2cd406113e3c2fe40521aaed984dd11dc41a0a50b253",
        "6c881ab0698e4e6ea235245f22832860544f17ba386442fe7e9d629f8cbedf87",
        "1f57a384d59542f8fac5f503da1f3ea44242f46dff969569e80b524d64b71dbc",
        "fc0a6886bbb9a23a39eeec4b176193cadb54ddbe77cdbb19b637933919545395",
    ):
        assert value in document
    assert "staticcheck 2025.1.1 (0.6.1)" in document
    assert "version: 0.10.0" in document
    assert "v3.10.0" in document
    assert "BSD-3-Clause" in document


def test_docs_index_links_to_the_packet() -> None:
    index = (REPO_ROOT / "docs" / "README.md").read_text(encoding="utf-8")
    assert "development/quality-toolchain.md" in index
