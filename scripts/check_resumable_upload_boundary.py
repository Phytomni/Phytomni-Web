#!/usr/bin/env python3
"""Check the Web repository's reference-only upload relay boundary.

This scanner is intentionally offline and source-based.  It is prepared as a
strict gate for the point at which the Go file relay is removed; until that
cutover, running it against the current checkout is expected to report the
legacy relay.  It never reads a Bot checkout, production configuration, or
file contents from an upload.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]

# Keep the scan narrow and explicit.  These are the production request builders
# and handlers that can put a Chat/product attachment on the Web → Bot path.
WEB_RELAY_PATHS = (
    Path("apps/web/src/views/chat/composables/useSendMessage.ts"),
    Path("apps/web/src/views/chat/composables/useStreamMessage.ts"),
    Path("apps/web/src/views/chat/composables/useRefreshMessage.ts"),
    Path("apps/web/src/views/chat/composables/useBotRemoteAgentRun.ts"),
)
GO_RELAY_PATHS = (
    Path("apps/server/http/handler/api_handler/query.go"),
    Path("apps/server/service/api_service/query.go"),
    Path("apps/server/service/api_service/agent_task.go"),
    Path("apps/server/external/bot/client.go"),
    Path("apps/server/external/bot/types.go"),
    Path("apps/server/external/bot/agent_arguments.go"),
)

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


def _scan_go_file(relative: Path, source: str, violations: list[str]) -> None:
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
        r"bytes\.NewReader\(\s*(?:f|file|selectedFile)\.Data\s*\)",
        "complete file bytes are passed into a Bot request",
        violations,
    )
    _find(
        relative,
        source,
        r"\bobs_file_list\b|\bOBSFileList\b",
        "OBS path list remains in a Web → Bot attachment request builder",
        violations,
    )
    _find(
        relative,
        source,
        r"(?im)^\s*(?:file_bytes|fileData|file_data|data|bytes)\s+\[\]byte\b",
        "file-byte field remains in a Web request or relay type",
        violations,
    )


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


def check(root: Path = ROOT) -> list[str]:
    """Return bounded, path-and-line diagnostics for forbidden relay code."""

    violations: list[str] = []
    scan_paths(root, WEB_RELAY_PATHS, _scan_web_file, violations)
    scan_paths(root, GO_RELAY_PATHS, _scan_go_file, violations)
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
