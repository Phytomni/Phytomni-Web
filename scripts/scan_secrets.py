#!/usr/bin/env python3
# Copyright (c) Biotechnology Research Institute,
# Chinese Academy of Agricultural Sciences. 2024-2026. All rights reserved.
# Author: xieshang (xieshang0608@gmail.com)
#         guxiaofeng (guxiaofeng@caas.cn)
"""Scan Git content for likely secrets.

This script exposes `main` as the CLI entrypoint and public helpers for
scanning tracked files, staged files, and revision ranges. `Rule` defines
regular-expression checks, and `Finding` records redacted scan results.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Pattern

MAX_FILE_BYTES = 1_000_000
ALLOWLIST_MARKERS = (
    "pragma: allowlist secret",
    "pragma: allowlist-secret",
    "nosec",
)
PLACEHOLDER_WORDS = (
    "changeme",
    "dummy",
    "example",
    "fake",
    "placeholder",
    "sample",
    "test",
    "your",
)
SKIP_PARTS = {
    ".git",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "__pycache__",
    "htmlcov",
}
ALLOWED_ENV_NAMES = {
    ".env.example",
    ".env.sample",
    ".env.template",
    ".env.encrypted",
}
ENVELOPE_ENV_NAME = ".env.encrypted"
ENVELOPE_MAGIC = b"PHYBOT01"
SENSITIVE_FILE_NAMES = {
    ".npmrc",
    ".pypirc",
    "client_secret.json",
    "credentials.json",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "id_rsa",
    "service-account.json",
}
SENSITIVE_SUFFIXES = {
    ".key",
    ".p12",
    ".pem",
    ".pfx",
}


@dataclass(frozen=True)
class Rule:
    """A regular expression rule for a sensitive value.

    Attributes:
        name: Stable rule identifier shown in scan output.
        pattern: Compiled regular expression used to detect a secret.
        message: Human-readable remediation message for matched values.
    """

    name: str
    pattern: Pattern[str]
    message: str


@dataclass(frozen=True)
class Finding:
    """A single secret-scan finding.

    Attributes:
        source: Origin of the finding, such as tracked, staged, or git-range.
        path: Repository-relative path associated with the finding.
        line_number: One-based line number, or zero for path-only findings.
        rule: Rule identifier that produced the finding.
        message: Human-readable description of the problem.
        context: Redacted context suitable for terminal output.
    """

    source: str
    path: str
    line_number: int
    rule: str
    message: str
    context: str

    @property
    def location(self) -> str:
        """Return the source location for display.

        Returns:
            A path-only location for path findings, or `path:line` for
            content findings.
        """
        if self.line_number > 0:
            return f"{self.path}:{self.line_number}"
        return self.path


SECRET_RULES = (
    Rule(
        name="private-key",
        pattern=re.compile(
            r"-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----"
        ),
        message="private key material must not be committed",
    ),
    Rule(
        name="github-token",
        pattern=re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{30,}\b"),
        message="GitHub token-like value detected",
    ),
    Rule(
        name="openai-token",
        pattern=re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b"),
        message="OpenAI token-like value detected",
    ),
    Rule(
        name="aws-access-key",
        pattern=re.compile(r"\b(?:A3T[A-Z0-9]|AKIA|ASIA)[A-Z0-9]{16}\b"),
        message="cloud access key-like value detected",
    ),
    Rule(
        name="jwt-token",
        pattern=re.compile(
            r"\beyJ[A-Za-z0-9_-]{10,}\."
            r"[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"
        ),
        message="JWT-like token detected",
    ),
    Rule(
        name="bearer-token",
        pattern=re.compile(
            r"(?i)\bBearer\s+(?P<value>[A-Za-z0-9._~+/=-]{24,})"
        ),
        message="Bearer token-like value detected",
    ),
    Rule(
        name="secret-assignment",
        pattern=re.compile(
            r"(?ix)"
            r"\b(?:"
            r"access[_-]?key|api[_-]?key|auth[_-]?token|"
            r"client[_-]?secret|password|passwd|private[_-]?token|"
            r"refresh[_-]?token|secret[_-]?key|x[-_]?auth[-_]?token"
            r")\b"
            r"\s*[:=]\s*"
            r"['\"]?"
            r"(?P<value>[A-Za-z0-9][A-Za-z0-9_+/=-]{15,})"
            r"(?=$|[\s,'\"#])"
        ),
        message="non-placeholder secret assignment detected",
    ),
    Rule(
        # Catches the Huawei-style short identifiers ak / sk that the
        # generic secret-assignment rule above misses (it only matches
        # access_key / secret_key etc.). Operator [:=]+ covers Python
        # "=", Go ":=", and YAML ":". Quoted value ≥ 15 chars masks the
        # 20-char Huawei AK and 40-char SK without false-positiving
        # `ak := os.Getenv("AK")` style env reads (no quoted literal).
        name="huawei-credentials",
        pattern=re.compile(
            r"(?ix)"
            r"\b(?:ak|sk|access[_-]?key[_-]?id|secret[_-]?access[_-]?key)\b"
            r"\s*[:=]+\s*"
            r"['\"]"
            r"(?P<value>[A-Za-z0-9][A-Za-z0-9_+/=-]{15,})"
            r"['\"]"
        ),
        message="Huawei-style ak/sk assignment detected",
    ),
)


def is_placeholder(value: str) -> bool:
    """Return whether a matched value is an obvious placeholder.

    Args:
        value: Matched candidate secret value.

    Returns:
        True when the value is empty, low-entropy, or placeholder-like.
    """
    normalized = value.strip(" '\"\t\r\n").lower()
    if not normalized:
        return True
    if len(set(normalized)) <= 2:
        return True
    return any(word in normalized for word in PLACEHOLDER_WORDS)


def should_skip_path(path: str) -> bool:
    """Return whether a path should be skipped during content scans.

    Args:
        path: Repository-relative path to evaluate.

    Returns:
        True when any path component belongs to the scanner skip list.
    """
    return any(part in SKIP_PARTS for part in Path(path).parts)


def sensitive_path_reason(path: str) -> str | None:
    """Return a reason when a tracked path itself looks sensitive.

    Args:
        path: Repository-relative path to evaluate.

    Returns:
        A display message when the path name is sensitive, otherwise None.
    """
    file_path = Path(path)
    name = file_path.name.lower()
    if name in ALLOWED_ENV_NAMES:
        return None
    # Allow any *.{example,sample,template} variant of an env-mode file
    # (e.g. .env.dev.example, .env.production.template) — Vite and other
    # build tools encode the mode into the filename, and the matching
    # template must keep the same prefix to be discoverable by `cp`.
    if name.endswith((".example", ".sample", ".template")):
        return None
    if name == ".env" or name.startswith(".env."):
        return "environment files must stay out of Git history"
    if name in SENSITIVE_FILE_NAMES:
        return "credential file names must stay out of Git history"
    if file_path.suffix.lower() in SENSITIVE_SUFFIXES:
        return "private key or certificate files must stay out of Git history"
    return None


def envelope_path_finding(
    source: str, path: str, raw: bytes
) -> Finding | None:
    """Validate a `.env.encrypted` path against the envelope magic.

    A real envelope is opaque ciphertext beginning with the
    ``PHYBOT01`` magic and is safe to commit and ship. A file named
    ``.env.encrypted`` that lacks the magic is almost certainly a
    misnamed plaintext .env and must still be blocked. `.env.encrypted`
    is allowlisted by name in `sensitive_path_reason`, so this content
    check is the guard that keeps a misnamed plaintext from slipping
    through wherever raw bytes are available (working tree and index).

    Args:
        source: Scan source label to attach to a generated finding.
        path: Repository-relative path being scanned.
        raw: Raw file bytes from the working tree or the staged blob.

    Returns:
        None when `path` is not envelope-named or the bytes carry the
        magic; a sensitive-path finding for a misnamed plaintext file.
    """
    if Path(path).name.lower() != ENVELOPE_ENV_NAME:
        return None
    if raw.startswith(ENVELOPE_MAGIC):
        return None
    return Finding(
        source,
        path,
        0,
        "sensitive-path",
        ".env.encrypted lacks the PHYBOT01 magic "
        "(misnamed plaintext .env?)",
        "<path>",
    )


def redact_line(line: str, match: re.Match[str]) -> str:
    """Return a display-safe copy of a matched line.

    Args:
        line: Original line containing a sensitive-looking match.
        match: Regular expression match produced by a secret rule.

    Returns:
        A redacted, bounded-length version of the input line.
    """
    value = match.groupdict().get("value")
    redacted = line.strip()
    if value:
        redacted = redacted.replace(value, "<redacted>")
    else:
        redacted = redacted.replace(match.group(0), "<redacted>")
    return redacted[:160]


def scan_line(
    source: str, path: str, line_number: int, line: str
) -> list[Finding]:
    """Scan a single line and return findings.

    Args:
        source: Scan source label to attach to generated findings.
        path: Repository-relative path for the scanned line.
        line_number: One-based line number in the scanned content.
        line: Text content to scan.

    Returns:
        Findings produced by matching non-placeholder secret rules.
    """
    lowered = line.lower()
    if any(marker in lowered for marker in ALLOWLIST_MARKERS):
        return []

    findings: list[Finding] = []
    for rule in SECRET_RULES:
        for match in rule.pattern.finditer(line):
            value = match.groupdict().get("value", match.group(0))
            if is_placeholder(value):
                continue
            findings.append(
                Finding(
                    source=source,
                    path=path,
                    line_number=line_number,
                    rule=rule.name,
                    message=rule.message,
                    context=redact_line(line, match),
                )
            )
    return findings


def scan_text(source: str, path: str, text: str) -> list[Finding]:
    """Scan text content for likely secrets.

    Args:
        source: Scan source label to attach to generated findings.
        path: Repository-relative path for the scanned text.
        text: Decoded text content to scan line by line.

    Returns:
        Path-level and line-level findings detected in the content.
    """
    findings: list[Finding] = []
    reason = sensitive_path_reason(path)
    if reason:
        findings.append(
            Finding(
                source=source,
                path=path,
                line_number=0,
                rule="sensitive-path",
                message=reason,
                context="<path>",
            )
        )

    for line_number, line in enumerate(text.splitlines(), start=1):
        findings.extend(scan_line(source, path, line_number, line))
    return findings


def decode_bytes(raw_content: bytes) -> str | None:
    """Decode file content as text, returning None for binary data.

    Args:
        raw_content: Raw bytes read from a file or Git object.

    Returns:
        UTF-8 text when decoding succeeds, otherwise None.
    """
    if b"\0" in raw_content:
        return None
    try:
        return raw_content.decode("utf-8")
    except UnicodeDecodeError:
        return None


def run_git(
    args: list[str], *, check: bool = True
) -> subprocess.CompletedProcess[str]:
    """Run a Git command and return the completed process.

    Args:
        args: Git arguments to append after the `git` executable.
        check: Whether subprocess should raise when Git exits non-zero.

    Returns:
        Completed Git subprocess with captured stdout and stderr.
    """
    return subprocess.run(
        ["git", *args],
        check=check,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def tracked_files() -> list[str]:
    """Return tracked files in the current Git checkout.

    Returns:
        Repository-relative paths tracked by Git.
    """
    result = run_git(["ls-files", "-z"])
    return [path for path in result.stdout.split("\0") if path]


def staged_files() -> list[str]:
    """Return added, copied, modified, or renamed staged files.

    Returns:
        Repository-relative staged paths with add, copy, modify, or rename
        status.
    """
    result = run_git(
        [
            "diff",
            "--cached",
            "--name-only",
            "-z",
            "--diff-filter=ACMR",
        ]
    )
    return [path for path in result.stdout.split("\0") if path]


def scan_worktree_path(path: str) -> list[Finding]:
    """Scan a tracked path from the working tree.

    Args:
        path: Repository-relative path to scan from the working tree.

    Returns:
        Findings detected in the path, or an empty list for skipped,
        missing, oversized, directory, or binary paths.
    """
    if should_skip_path(path):
        return []
    file_path = Path(path)
    reason = sensitive_path_reason(path)
    if reason and not file_path.exists():
        return [
            Finding("tracked", path, 0, "sensitive-path", reason, "<path>")
        ]
    if not file_path.is_file() or file_path.stat().st_size > MAX_FILE_BYTES:
        return []
    raw_content = file_path.read_bytes()
    if file_path.name.lower() == ENVELOPE_ENV_NAME:
        finding = envelope_path_finding("tracked", path, raw_content)
        return [finding] if finding else []
    text = decode_bytes(raw_content)
    if text is None:
        return []
    return scan_text("tracked", path, text)


def scan_staged_path(path: str) -> list[Finding]:
    """Scan a staged path from the Git index.

    Args:
        path: Repository-relative path to read from the Git index.

    Returns:
        Findings detected in the staged object, or an empty list for skipped,
        missing, oversized, or binary content.
    """
    if should_skip_path(path):
        return []
    result = subprocess.run(
        ["git", "show", f":{path}"],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        return []
    if Path(path).name.lower() == ENVELOPE_ENV_NAME:
        finding = envelope_path_finding("staged", path, result.stdout)
        return [finding] if finding else []
    if len(result.stdout) > MAX_FILE_BYTES:
        return []
    text = decode_bytes(result.stdout)
    if text is None:
        return []
    return scan_text("staged", path, text)


def scan_paths(paths: list[str], *, staged: bool) -> list[Finding]:
    """Scan a list of paths from the working tree or Git index.

    Args:
        paths: Repository-relative paths to scan.
        staged: Whether to read paths from the Git index instead of disk.

    Returns:
        Combined findings from all scanned paths.
    """
    findings: list[Finding] = []
    for path in paths:
        if staged:
            findings.extend(scan_staged_path(path))
        else:
            findings.extend(scan_worktree_path(path))
    return findings


def scan_range_paths(range_spec: str) -> list[Finding]:
    """Scan path names changed in a Git revision range.

    Args:
        range_spec: Git revision range understood by `git log`.

    Returns:
        Findings for sensitive path names changed in the range.
    """
    result = run_git(["log", "--name-only", "--format=", range_spec])
    findings: list[Finding] = []
    seen: set[str] = set()
    for path in result.stdout.splitlines():
        if not path or path in seen or should_skip_path(path):
            continue
        seen.add(path)
        reason = sensitive_path_reason(path)
        if reason:
            findings.append(
                Finding(
                    "git-range", path, 0, "sensitive-path", reason, "<path>"
                )
            )
    return findings


def parse_hunk_start(line: str) -> int | None:
    """Parse a unified-diff hunk header and return the new-file start line.

    Args:
        line: Unified-diff hunk header.

    Returns:
        The new-file start line when present, otherwise None.
    """
    match = re.search(r"\+(\d+)(?:,\d+)?", line)
    if not match:
        return None
    return int(match.group(1))


def parse_diff_path(line: str) -> str:
    """Parse the new path from a diff header.

    Args:
        line: `diff --git` header line.

    Returns:
        The normalized new-file path, or `<unknown>` for malformed headers.
    """
    parts = line.split()
    if len(parts) < 4:
        return "<unknown>"
    path = parts[3]
    if path.startswith("b/"):
        path = path[2:]
    return path


def scan_range_patch(range_spec: str) -> list[Finding]:
    """Scan added lines in a Git revision range.

    Args:
        range_spec: Git revision range understood by `git log`.

    Returns:
        Findings detected in added patch lines for the requested range.
    """
    result = run_git(
        [
            "log",
            "--format=commit %H",
            "--patch",
            "--no-ext-diff",
            range_spec,
        ]
    )
    findings: list[Finding] = []
    commit = "<unknown>"
    path = "<unknown>"
    line_number = 0

    for raw_line in result.stdout.splitlines():
        if raw_line.startswith("commit "):
            commit = raw_line.split(maxsplit=1)[1][:12]
            continue
        if raw_line.startswith("diff --git "):
            path = parse_diff_path(raw_line)
            line_number = 0
            continue
        if raw_line.startswith("@@ "):
            line_number = parse_hunk_start(raw_line) or 0
            continue
        if raw_line.startswith("+++") or raw_line.startswith("---"):
            continue
        if raw_line.startswith("+"):
            added_line = raw_line[1:]
            source = f"git-range:{commit}"
            findings.extend(scan_line(source, path, line_number, added_line))
            if line_number:
                line_number += 1
            continue
        if raw_line.startswith("-"):
            continue
        if line_number:
            line_number += 1

    return findings


def scan_git_range(range_spec: str) -> list[Finding]:
    """Scan changed paths and added lines in a Git revision range.

    Args:
        range_spec: Git revision range understood by `git log`.

    Returns:
        Findings from both changed path names and added patch lines.
    """
    return scan_range_paths(range_spec) + scan_range_patch(range_spec)


def print_findings(findings: list[Finding]) -> None:
    """Print findings in a compact form.

    Args:
        findings: Secret-scan findings to print to stderr.

    Returns:
        None. Findings are written to stderr.
    """
    print(
        f"Secret scan failed with {len(findings)} finding(s):", file=sys.stderr
    )
    for finding in findings:
        print(
            f"- {finding.location} [{finding.source}] "
            f"{finding.rule}: {finding.message}",
            file=sys.stderr,
        )
        print(f"  context: {finding.context}", file=sys.stderr)


def parse_args(argv: list[str]) -> argparse.Namespace:
    """Parse command-line arguments.

    Args:
        argv: Command-line arguments excluding the executable name.

    Returns:
        Parsed scanner options.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--all",
        action="store_true",
        help="scan all tracked files in the working tree",
    )
    mode.add_argument(
        "--staged",
        action="store_true",
        help="scan staged files from the Git index",
    )
    mode.add_argument(
        "--git-range",
        metavar="RANGE",
        help="scan added lines and changed paths in a Git revision range",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """Run the secret scanner.

    Args:
        argv: Optional command-line arguments excluding the executable name.

    Returns:
        Process exit code. Zero means no findings were detected.
    """
    args = parse_args(argv or sys.argv[1:])
    if args.staged:
        findings = scan_paths(staged_files(), staged=True)
    elif args.git_range:
        findings = scan_git_range(args.git_range)
    else:
        findings = scan_paths(tracked_files(), staged=False)

    if findings:
        print_findings(findings)
        return 1

    print("Secret scan passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
