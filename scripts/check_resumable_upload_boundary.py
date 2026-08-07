#!/usr/bin/env python3
"""Check the Web repository's reference-only upload relay boundary.

This scanner is intentionally offline and source-based. It enforces the
reference-only boundary after the Go file relay cutover. It never reads a Bot
checkout, production configuration, or file contents from an upload.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]

# Keep the scan narrow and explicit. These are the production request builders,
# public upload-control handler, and trusted Bot upload DTO that define the
# Browser/Web attachment boundary. The direct Browser → Bot part transport is
# intentionally not in this list: it is allowed to carry one file part under an
# opaque capability and is governed by its own transport tests.
BROWSER_UPLOAD_CONTROL_PATH = Path("apps/web/src/api/upload.ts")
PUBLIC_UPLOAD_HANDLER_PATH = Path("apps/server/http/handler/api_handler/upload_files.go")
BOT_UPLOAD_CREATE_PATH = Path("apps/server/external/bot/upload_contract.go")

WEB_RELAY_PATHS = (
    Path("apps/web/src/views/chat/composables/useSendMessage.ts"),
    Path("apps/web/src/views/chat/composables/useStreamMessage.ts"),
    Path("apps/web/src/views/chat/composables/useRefreshMessage.ts"),
    Path("apps/web/src/views/chat/composables/useBotRemoteAgentRun.ts"),
    BROWSER_UPLOAD_CONTROL_PATH,
)
GO_RELAY_PATHS = (
    Path("apps/server/http/handler/api_handler/query.go"),
    Path("apps/server/service/api_service/query.go"),
    Path("apps/server/service/api_service/agent_task.go"),
    Path("apps/server/external/bot/client.go"),
    Path("apps/server/external/bot/types.go"),
    Path("apps/server/external/bot/agent_arguments.go"),
    PUBLIC_UPLOAD_HANDLER_PATH,
    BOT_UPLOAD_CREATE_PATH,
)
CANONICAL_AGENT_ARGUMENTS_PATH = Path("apps/server/external/bot/agent_arguments.go")
CANONICAL_EMPTY_ASSIGNMENTS = {
    'args["data_list"] = map[string]string{}': 2,
    'args["obs_file_list"] = []string{}': 4,
}

# If a future scanner extension reads tests, only these exact legacy-history
# parsers may mention the old marker.  A broad directory or substring
# allow-list would hide a new production relay and is deliberately forbidden.
LEGACY_HISTORY_TEST_ALLOWLIST = frozenset(
    {
        Path("apps/web/src/views/chat/utils/message-parse.ts"),
        Path("apps/web/tests/unit/views/chat/message-parse.spec.ts"),
    }
)

PASS_LINE = "Resumable upload boundary: PASS"
FAIL_LINE = "Resumable upload boundary: FAIL"
MAX_FAILURE_LINES = 64
MAX_FAILURE_LENGTH = 240

# These fields are forbidden on Browser → Web Go control payloads and on
# ordinary Web → Bot request DTOs. `owner_subject` is intentionally absent from
# the Go set: Web derives it from the authenticated owner before sending the
# trusted Bot DTOs, and the three existing Bot request types must retain it.
FORBIDDEN_BROWSER_FIELDS = frozenset(
    {
        "purpose",
        "dataset_description",
        "data_list",
        "obs_file_list",
        "obs_path",
        "object_key",
        "owner_subject",
        "credentials",
        "access_key",
        "secret_key",
        "upload_id",
        "bucket",
        "storage_path",
        "file_path",
        "file_bytes",
    }
)
FORBIDDEN_GO_FIELDS = frozenset(
    {
        "purpose",
        "dataset_description",
        "data_list",
        "obs_file_list",
        "obs_path",
        "object_key",
        "credentials",
        "access_key",
        "secret_key",
        "upload_id",
        "bucket",
        "storage_path",
        "file_path",
        "file_bytes",
    }
)


def _field_alternation(fields: Iterable[str]) -> str:
    return "(?:" + "|".join(
        re.escape(field) for field in sorted(fields, key=len, reverse=True)
    ) + ")"


def _line_number(source: str, offset: int) -> int:
    return source.count("\n", 0, offset) + 1


def _diagnostic(relative: Path, source: str, match: re.Match[str], reason: str) -> str:
    line = _line_number(source, match.start())
    return f"{relative}:{line}: {reason}"


def _find(
    relative: Path,
    source: str,
    pattern: str,
    reason: str,
    violations: list[str],
) -> None:
    for match in re.finditer(pattern, source, flags=re.MULTILINE):
        violations.append(_diagnostic(relative, source, match, reason))


def _scan_web_file(relative: Path, source: str, violations: list[str]) -> None:
    _find(
        relative,
        source,
        r"\.append\(\s*[\"'](?:file|files)[\"']\s*,",
        "raw browser file appended to a Chat/product request",
        violations,
    )
    _find(
        relative,
        source,
        r"\.append\(\s*[\"'](?:data_list|obs_file_list|DataList|OBSFileList)[\"']\s*,",
        "native attachment field appended to a browser request",
        violations,
    )
    _find(
        relative,
        source,
        r"\.append\(\s*[\"'][^\"']+[\"']\s*,\s*(?:file|selectedFiles|selectedFile|blob)\b",
        "browser File/Blob appended to a Chat/product control request",
        violations,
    )
    _find(
        relative,
        source,
        r"(?:files|selectedFiles|selectedFile)\s*\.forEach\s*\(",
        "browser file collection iterated in a Chat/product request builder",
        violations,
    )
    if relative == BROWSER_UPLOAD_CONTROL_PATH:
        _find(
            relative,
            source,
            r"(?<![\w$])purpose\s*\??\s*:",
            "browser upload purpose must be derived by Web Go",
            violations,
        )
        _find(
            relative,
            source,
            r"[\"']purpose[\"']\s*:",
            "browser upload purpose must be derived by Web Go",
            violations,
        )
    _find(
        relative,
        source,
        r"\.(?:append|set)\(\s*[\"']dataset_description[\"']\s*,|"
        r"(?<![\w$])dataset_description\s*:|"
        r"[\"']dataset_description[\"']\s*:",
        "dataset description serialized by the browser",
        violations,
    )
    field_pattern = _field_alternation(FORBIDDEN_BROWSER_FIELDS)
    _find(
        relative,
        source,
        rf"\.(?:append|set)\(\s*[\"']{field_pattern}[\"']\s*,",
        "forbidden attachment field serialized by the browser",
        violations,
    )
    _find(
        relative,
        source,
        rf"(?<![\w$]){field_pattern}\s*:",
        "forbidden attachment field serialized by the browser",
        violations,
    )
    _find(
        relative,
        source,
        rf"[\"']{field_pattern}[\"']\s*:",
        "forbidden attachment field serialized by the browser",
        violations,
    )
    _find(
        relative,
        source,
        r"(?<![\w$])(?:body|data)\s*[:=]\s*(?:file|selectedFile|selectedFiles|blob)\b",
        "file or Blob body sent by the browser",
        violations,
    )


def _remove_canonical_empty_assignments(source: str, violations: list[str]) -> str:
    """Remove only the counted, canonical native compatibility assignments."""

    lines = source.splitlines(keepends=True)
    normalized = [line.strip() for line in lines]
    for assignment, expected_count in CANONICAL_EMPTY_ASSIGNMENTS.items():
        actual_count = normalized.count(assignment)
        if actual_count != expected_count:
            violations.append(
                f"{CANONICAL_AGENT_ARGUMENTS_PATH}: canonical assignment "
                f"count for {assignment!r} is {actual_count}, expected {expected_count}"
            )
    return "".join(
        line
        for line in lines
        if line.strip() not in CANONICAL_EMPTY_ASSIGNMENTS
    )


def _scan_go_file(
    relative: Path,
    source: str,
    violations: list[str],
    *,
    allow_trusted_purpose: bool = False,
) -> None:
    if relative == CANONICAL_AGENT_ARGUMENTS_PATH:
        source = _remove_canonical_empty_assignments(source, violations)
        _find(
            relative,
            source,
            r"\b(?:data_list|obs_file_list|DataList|OBSFileList)\b",
            "noncanonical native attachment field remains in the argument builder",
            violations,
        )
    _find(
        relative,
        source,
        r"\bQueryFile\b",
        "legacy QueryFile relay type or caller remains",
        violations,
    )
    _find(
        relative,
        source,
        r"\bUploadFile(?:WithMeta)?\b",
        "legacy Bot file upload method remains on the Web relay path",
        violations,
    )
    _find(
        relative,
        source,
        r"\bUploadLimits\b|\bFileUploadResponse\b",
        "legacy request-level upload limit/response type remains",
        violations,
    )
    _find(
        relative,
        source,
        r"mime/multipart|multipart\.New(?:Writer|Reader)|MultipartReader|CreateFormFile|ParseMultipartForm|\bFormFile\b|\bform\.File\[",
        "Go multipart file relay remains on a production request path",
        violations,
    )
    _find(
        relative,
        source,
        r"bytes\.NewReader\(\s*(?:f|file|selectedFile|blob)\.Data\s*\)",
        "complete file bytes are passed into a Bot request",
        violations,
    )
    _find(
        relative,
        source,
        r"bytes\.NewReader\(\s*(?:file|selectedFile|selectedFiles|blob|fileData|fileBytes)\b",
        "complete file bytes are passed into a Bot request",
        violations,
    )
    _find(
        relative,
        source,
        r"\b\w+\s*\[\s*[\"'](?:data_list|obs_file_list)[\"']\s*\]\s*=|[\"'](?:data_list|obs_file_list)[\"']\s*:",
        "native attachment field assigned in a Web → Bot request builder",
        violations,
    )
    _find(
        relative,
        source,
        r"\b(?:DataList|OBSFileList)\s+(?:\[\][A-Za-z0-9_.*]+|map\[)",
        "Go native attachment field remains in a Web → Bot request builder",
        violations,
    )
    _find(
        relative,
        source,
        r"(?im)^\s*(?:file_bytes|fileData|file_data|data|bytes)\s+\[\]byte\b",
        "file-byte field remains in a Web request or relay type",
        violations,
    )
    fields = FORBIDDEN_GO_FIELDS
    if allow_trusted_purpose:
        fields = fields - {"purpose"}
    field_pattern = _field_alternation(fields)
    _find(
        relative,
        source,
        r"json:\"dataset_description(?:,[^\"]*)?\"|"
        r"\[\s*[\"']dataset_description[\"']\s*\]\s*[:=]|"
        r"(?<![\w.])dataset_description\s*:",
        "dataset description serialized by Web Go",
        violations,
    )
    _find(
        relative,
        source,
        rf"json:\"{field_pattern}(?:,[^\"]*)?\"",
        "forbidden attachment field serialized by Web Go",
        violations,
    )
    _find(
        relative,
        source,
        rf"\[\s*[\"']{field_pattern}[\"']\s*\]\s*[:=]",
        "forbidden attachment field serialized by Web Go",
        violations,
    )
    _find(
        relative,
        source,
        rf"(?<![\w.]){field_pattern}\s*:",
        "forbidden attachment field serialized by Web Go",
        violations,
    )
    _find(
        relative,
        source,
        r"(?<![\w.])(?:body|payload|data)\s*[:=]\s*"
        r"(?:file|selectedFile|selectedFiles|blob|fileBytes|fileData)\b",
        "file or Blob body sent by Web Go",
        violations,
    )


def _scan_public_upload_handler(
    relative: Path, source: str, violations: list[str]
) -> None:
    _find(
        relative,
        source,
        r"json:\"purpose(?:,[^\"]*)?\"",
        "public upload purpose must be derived by Web Go",
        violations,
    )
    _find(
        relative,
        source,
        r"(?im)^\s*Purpose\s+[A-Za-z0-9_.*\[\]]+\s+`json:\"",
        "public upload purpose must be derived by Web Go",
        violations,
    )
    public_field_pattern = _field_alternation(FORBIDDEN_BROWSER_FIELDS)
    _find(
        relative,
        source,
        rf"json:\"{public_field_pattern}(?:,[^\"]*)?\"",
        "forbidden attachment field accepted by the public upload body",
        violations,
    )
    _scan_go_file(relative, source, violations)


def _read_source(root: Path, relative: Path, violations: list[str]) -> str | None:
    path = root / relative
    try:
        path.resolve().relative_to(root.resolve())
    except ValueError:
        violations.append(f"refusing to read out-of-scope source: {relative}")
        return None
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        violations.append(f"missing boundary source: {relative}")
    except (OSError, UnicodeDecodeError):
        violations.append(f"cannot read boundary source: {relative}")
    return None


def scan_paths(
    root: Path,
    paths: Iterable[Path],
    scanner,
    violations: list[str],
) -> None:
    for relative in paths:
        source = _read_source(root, relative, violations)
        if source is not None:
            scanner(relative, source, violations)


def _scan_go_boundary_file(relative: Path, source: str, violations: list[str]) -> None:
    if relative == PUBLIC_UPLOAD_HANDLER_PATH:
        _scan_public_upload_handler(relative, source, violations)
        return
    _scan_go_file(
        relative,
        source,
        violations,
        allow_trusted_purpose=relative == BOT_UPLOAD_CREATE_PATH,
    )


def check(root: Path = ROOT) -> list[str]:
    """Return bounded, path-and-line diagnostics for forbidden relay code."""

    violations: list[str] = []
    scan_paths(root, WEB_RELAY_PATHS, _scan_web_file, violations)
    scan_paths(root, GO_RELAY_PATHS, _scan_go_boundary_file, violations)
    # Keep output stable and bounded so this remains safe for a gate log.
    unique = list(dict.fromkeys(violations))
    return [item[:MAX_FAILURE_LENGTH] for item in unique[:MAX_FAILURE_LINES]]


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=ROOT,
        help="Web repository root (defaults to the checkout containing this script)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    violations = check(args.root.resolve())
    if violations:
        print(FAIL_LINE)
        for violation in violations:
            print(f"- {violation}")
        return 1
    print(PASS_LINE)
    return 0


if __name__ == "__main__":
    sys.exit(main())
