# Copyright (c) Biotechnology Research Institute,
# Chinese Academy of Agricultural Sciences. 2024-2026. All rights reserved.
# Author: xieshang (xieshang0608@gmail.com)
#         guxiaofeng (guxiaofeng@caas.cn)
"""Tests for the repo-wide secret scanner (scripts/scan_secrets.py).

Covers the pure-function surface only — placeholder detection, path
skipping, sensitive-path classification, envelope magic validation,
redaction, per-rule line scanning, allowlist suppression, byte decoding,
and the unified-diff parser helpers. Git subprocess paths
(`staged_files`, `scan_git_range`, etc.) are exercised by
`scripts/validate_web_local.sh` end-to-end on real repository state and
are intentionally out of scope here.
"""

from __future__ import annotations

import re

import pytest

import scan_secrets
from scan_secrets import (
    Finding,
    SECRET_RULES,
    decode_bytes,
    envelope_path_finding,
    is_placeholder,
    parse_diff_path,
    parse_hunk_start,
    redact_line,
    scan_line,
    scan_text,
    sensitive_path_reason,
    should_skip_path,
)

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------------
# is_placeholder
# ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "value",
    [
        "",
        "   ",
        "''",
        '""',
        "aaaaaaaaaa",
        "ababababab",
        "changeme",
        "DummyValue",
        "this-is-an-example",
        "FAKE_TOKEN",
        "PLACEHOLDER",
        # Commit 3838bd6 regression: REPLACE_* literals are treated as
        # obvious placeholders so config templates do not page the gate.
        "REPLACE_ME",
        "REPLACE_ME_TOKEN_ABC",
        "<replace-with-real-key>",
        "sample-key",
        "test-secret",
        "your-api-key-here",
    ],
)
def test_is_placeholder_true(value: str) -> None:
    """Empty, low-entropy, and well-known placeholder values are filtered."""
    assert is_placeholder(value) is True


# Each fixture below would be a real-shaped credential — annotate the
# source lines with the scanner's own allowlist marker so the pre-commit
# hook ignores them. The marker is checked against each physical source
# line, NOT the string literal, so test assertions that receive these
# values still exercise the regex paths normally.
@pytest.mark.parametrize(
    "value",
    [
        "q9X7m2k4nR8tP1bL5wF",  # pragma: allowlist secret
        "Zk3rT8mQ2pN5vL7yH4cB",  # pragma: allowlist secret
        "AKIAQ9X7M2K4NR8TP1BL",  # pragma: allowlist secret
        "ghp_q9X7m2k4nR8tP1bL5wFz2aC6dY3",  # pragma: allowlist secret
    ],
)
def test_is_placeholder_false(value: str) -> None:
    """High-entropy values bypass the placeholder corpus."""
    assert is_placeholder(value) is False


# ---------------------------------------------------------------------
# should_skip_path
# ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        ".git/config",
        "a/b/.git/HEAD",
        ".venv/lib/python3.11/site-packages/x.py",
        "src/__pycache__/cache.pyc",
        ".mypy_cache/foo",
        ".pytest_cache/v/cache",
        ".ruff_cache/0.5.0/abc",
        "htmlcov/index.html",
    ],
)
def test_should_skip_path_true(path: str) -> None:
    """Paths under SKIP_PARTS are excluded from content scans."""
    assert should_skip_path(path) is True


@pytest.mark.parametrize(
    "path",
    [
        "src/main.py",
        "scripts/scan_secrets.py",
        "chat-ai/src/views/chat/index.vue",
        "nky_client_go/main.go",
        "docs/README.md",
    ],
)
def test_should_skip_path_false(path: str) -> None:
    """Ordinary project paths are scanned."""
    assert should_skip_path(path) is False


# ---------------------------------------------------------------------
# sensitive_path_reason
# ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "src/main.py",
        "README.md",
        ".env.example",
        ".env.sample",
        ".env.template",
        ".env.dev.example",
        ".env.production.template",
        ".env.encrypted",
    ],
)
def test_sensitive_path_reason_none(path: str) -> None:
    """Source files and allowlisted env templates emit no path finding."""
    assert sensitive_path_reason(path) is None


@pytest.mark.parametrize(
    "path,fragment",
    [
        (".env", "environment files"),
        (".env.production", "environment files"),
        (".env.local", "environment files"),
        ("nky_client_python/.env.dev", "environment files"),
        ("credentials.json", "credential file names"),
        ("client_secret.json", "credential file names"),
        ("id_rsa", "credential file names"),
        (".npmrc", "credential file names"),
        ("server.pem", "private key or certificate"),
        ("cert.key", "private key or certificate"),
        ("keystore.p12", "private key or certificate"),
        ("identity.pfx", "private key or certificate"),
    ],
)
def test_sensitive_path_reason_flags(path: str, fragment: str) -> None:
    """Real env files, named credential files, and key suffixes are flagged."""
    reason = sensitive_path_reason(path)
    assert reason is not None
    assert fragment in reason


# ---------------------------------------------------------------------
# envelope_path_finding (PHYBOT01 magic for .env.encrypted)
# ---------------------------------------------------------------------


def test_envelope_path_finding_skips_non_envelope() -> None:
    """Non-envelope paths return None regardless of content."""
    assert envelope_path_finding("tracked", "src/main.py", b"anything") is None


def test_envelope_path_finding_accepts_valid_magic() -> None:
    """A .env.encrypted file with PHYBOT01 magic is a real envelope — pass."""
    raw = scan_secrets.ENVELOPE_MAGIC + b"\x00ciphertext-bytes"
    assert envelope_path_finding("tracked", ".env.encrypted", raw) is None


def test_envelope_path_finding_rejects_missing_magic() -> None:
    """A file named .env.encrypted that lacks magic is a misnamed plaintext."""
    finding = envelope_path_finding(
        "staged", "config/.env.encrypted", b"SECRET_KEY=real-leak-here\n"
    )
    assert finding is not None
    assert isinstance(finding, Finding)
    assert finding.source == "staged"
    assert finding.path == "config/.env.encrypted"
    assert finding.rule == "sensitive-path"
    assert finding.context == "<path>"
    assert "PHYBOT01" in finding.message


# ---------------------------------------------------------------------
# redact_line
# ---------------------------------------------------------------------


def test_redact_line_named_value_group_redacts_only_value() -> None:
    """When the rule has a `value` group, only that substring is redacted."""
    line = '   password = "q9X7m2k4nR8tP1bL5wF"   '  # pragma: allowlist secret
    pattern = re.compile(r'password\s*=\s*"(?P<value>[^"]+)"')
    match = pattern.search(line)
    assert match is not None
    redacted = redact_line(line, match)
    assert "q9X7m2k4nR8tP1bL5wF" not in redacted
    assert "<redacted>" in redacted
    assert redacted.startswith('password = "')


def test_redact_line_no_named_group_redacts_whole_match() -> None:
    """Rules without a named value group redact the full match span."""
    line = "BEGIN RSA PRIVATE KEY block follows"
    pattern = re.compile(r"BEGIN RSA PRIVATE KEY")
    match = pattern.search(line)
    assert match is not None
    redacted = redact_line(line, match)
    assert "BEGIN RSA PRIVATE KEY" not in redacted
    assert "<redacted>" in redacted


def test_redact_line_caps_at_160_chars() -> None:
    """Redacted context never exceeds 160 characters for terminal display."""
    long_prefix = "x" * 200
    secret = "q9X7m2k4nR8tP1bL5wF"  # pragma: allowlist secret
    line = f'{long_prefix} password = "{secret}"'
    pattern = re.compile(r'password\s*=\s*"(?P<value>[^"]+)"')
    match = pattern.search(line)
    assert match is not None
    assert len(redact_line(line, match)) <= 160


# ---------------------------------------------------------------------
# scan_line — per-rule positive samples
# ---------------------------------------------------------------------


# Every physical line below holds a real-shaped credential literal. The
# inline `# pragma: allowlist secret` markers tell scan_secrets to skip
# these source lines so the pre-commit hook stays green. Test assertions
# below receive the *string values* (which do NOT contain the pragma
# text) so each rule's regex still fires exactly as it would in real
# code. Keep one pragma per physical line — multi-line implicit string
# concatenation defeats the per-line marker check.
RULE_POSITIVE_SAMPLES: dict[str, str] = {
    "private-key": "-----BEGIN RSA PRIVATE KEY-----",  # pragma: allowlist secret
    "github-token": "token: ghp_q9X7m2k4nR8tP1bL5wFz2aC6dY3sEvH",  # pragma: allowlist secret
    "openai-token": "OPENAI = sk-q9X7m2k4nR8tP1bL5wFz2aC6dY",  # pragma: allowlist secret
    "aws-access-key": "creds=AKIAQ9X7M2K4NR8TP1BL",  # pragma: allowlist secret
    "jwt-token": "auth=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.q9X7m2k4nR8tP1bL5wFz",  # pragma: allowlist secret
    "bearer-token": "Authorization: Bearer q9X7m2k4nR8tP1bL5wFz2aC6dY3sE",  # pragma: allowlist secret
    "secret-assignment": 'password = "q9X7m2k4nR8tP1bL5wF"',  # pragma: allowlist secret
    "huawei-credentials": 'ak = "q9X7m2k4nR8tP1bL5wF"',  # pragma: allowlist secret
}


def test_rule_positive_samples_cover_every_rule() -> None:
    """Every Rule in SECRET_RULES has a positive sample in this test file.

    Prevents silently shipping a new Rule without coverage when
    SECRET_RULES grows.
    """
    rule_names = {rule.name for rule in SECRET_RULES}
    sample_names = set(RULE_POSITIVE_SAMPLES)
    assert rule_names == sample_names, (
        f"missing samples: {rule_names - sample_names}; "
        f"stale samples: {sample_names - rule_names}"
    )


@pytest.mark.parametrize(
    "rule_name,line",
    sorted(RULE_POSITIVE_SAMPLES.items()),
)
def test_scan_line_rule_fires_on_real_looking_value(
    rule_name: str, line: str
) -> None:
    """Each rule produces a finding when fed a high-entropy non-placeholder."""
    findings = scan_line("test", "fake.txt", 42, line)
    assert findings, f"no findings for {rule_name} sample"
    matched_rules = {finding.rule for finding in findings}
    assert rule_name in matched_rules, (
        f"{rule_name} did not match its own sample; "
        f"actually matched: {matched_rules}"
    )


@pytest.mark.parametrize(
    "rule_name,line",
    sorted(RULE_POSITIVE_SAMPLES.items()),
)
def test_scan_line_findings_never_leak_secret(
    rule_name: str, line: str
) -> None:
    """The Finding.context field redacts the high-entropy substring."""
    findings = scan_line("test", "fake.txt", 1, line)
    interesting = [f for f in findings if f.rule == rule_name]
    assert interesting, f"no {rule_name} finding to assert against"
    for finding in interesting:
        assert "<redacted>" in finding.context
        assert "q9X7m2k4nR8tP1bL5wFz" not in finding.context
        assert "q9X7m2k4nR8tP1bL5wF" not in finding.context


# ---------------------------------------------------------------------
# scan_line — negative cases
# ---------------------------------------------------------------------


def test_scan_line_allowlist_marker_suppresses_all_rules() -> None:
    """Lines tagged with `pragma: allowlist secret` skip every rule."""
    # Build the asserted input as a single string so the marker travels
    # with the secret on one physical scan-line (the very property the
    # test verifies). Source-side, the pragma at the end also keeps the
    # pre-commit hook from flagging this fixture file.
    line = 'password = "q9X7m2k4nR8tP1bL5wF"  # pragma: allowlist secret'
    assert scan_line("test", "fake.txt", 1, line) == []


def test_scan_line_nosec_marker_suppresses_all_rules() -> None:
    """`nosec` (bandit-style) is also honoured as an allowlist marker."""
    line = 'password = "q9X7m2k4nR8tP1bL5wF"  # nosec'  # pragma: allowlist secret
    assert scan_line("test", "fake.txt", 1, line) == []


@pytest.mark.parametrize(
    "line",
    [
        # Each line matches a rule regex but the value is a known placeholder.
        'password = "REPLACE_ME_TOKEN_ABC"',
        'api_key = "your-api-key-here-please"',
        'access_key = "example-access-key-xyz"',
        'secret_key = "sample-secret-key-1234567"',
        'ak = "REPLACE_ME_AK_VALUE_HERE"',
    ],
)
def test_scan_line_placeholders_are_silenced(line: str) -> None:
    """Placeholder values produce zero findings even when the regex matches."""
    assert scan_line("test", "fake.txt", 1, line) == []


def test_scan_line_clean_line_produces_no_findings() -> None:
    """Ordinary code without secret-shaped tokens is clean."""
    line = "    return calculate_total(price, tax_rate)"
    assert scan_line("test", "fake.txt", 1, line) == []


# ---------------------------------------------------------------------
# scan_text — integration of sensitive_path_reason + scan_line
# ---------------------------------------------------------------------


def test_scan_text_combines_path_and_line_findings() -> None:
    """scan_text emits a path finding for `.env` and any line findings."""
    secret = "q9X7m2k4nR8tP1bL5wF"  # pragma: allowlist secret
    text = f'API_KEY = "{secret}"\n'
    findings = scan_text("tracked", ".env", text)
    rule_names = [finding.rule for finding in findings]
    assert "sensitive-path" in rule_names
    # The .env path is named-sensitive on its own; the line-level rule
    # additionally flags the assignment.
    assert any(rn != "sensitive-path" for rn in rule_names)


def test_scan_text_clean_source_file_is_empty() -> None:
    """A normal source file with no secrets returns no findings."""
    text = (
        "def add(a: int, b: int) -> int:\n"
        '    """Return the sum."""\n'
        "    return a + b\n"
    )
    assert scan_text("tracked", "src/math_utils.py", text) == []


# ---------------------------------------------------------------------
# decode_bytes
# ---------------------------------------------------------------------


def test_decode_bytes_returns_text_for_utf8() -> None:
    """UTF-8 bytes round-trip to text."""
    assert decode_bytes("hello\n中文\n".encode("utf-8")) == "hello\n中文\n"


def test_decode_bytes_returns_none_for_null_bytes() -> None:
    """Null byte is the canonical binary-content signal — treat as binary."""
    assert decode_bytes(b"PK\x03\x04binary\x00payload") is None


def test_decode_bytes_returns_none_for_invalid_utf8() -> None:
    """Undecodable byte sequences are reported as binary, not guessed."""
    assert decode_bytes(b"\xff\xfe\xfd\xfc") is None


# ---------------------------------------------------------------------
# parse_hunk_start / parse_diff_path
# ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "header,expected",
    [
        ("@@ -1,4 +5,3 @@ def foo():", 5),
        ("@@ -1 +5 @@", 5),
        ("@@ -10,0 +123,4 @@", 123),
    ],
)
def test_parse_hunk_start_extracts_new_file_line(
    header: str, expected: int
) -> None:
    """The new-file line number is parsed from the unified-diff hunk header."""
    assert parse_hunk_start(header) == expected


def test_parse_hunk_start_returns_none_for_garbage() -> None:
    """A non-header line yields None, not an exception."""
    assert parse_hunk_start("not a hunk header") is None


@pytest.mark.parametrize(
    "header,expected",
    [
        ("diff --git a/foo.py b/bar.py", "bar.py"),
        ("diff --git a/sub/foo b/sub/bar", "sub/bar"),
        # The b/ prefix is stripped; everything else is preserved verbatim.
        ("diff --git a/x b/path with weird chars", "path"),
    ],
)
def test_parse_diff_path_extracts_new_path(
    header: str, expected: str
) -> None:
    """The new path is extracted from the `diff --git` header."""
    assert parse_diff_path(header) == expected


def test_parse_diff_path_returns_unknown_for_short_header() -> None:
    """A malformed header falls back to <unknown>."""
    assert parse_diff_path("diff bad") == "<unknown>"
