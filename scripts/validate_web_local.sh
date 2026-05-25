#!/usr/bin/env bash
# validate_web_local.sh — full pre-commit gate for Phytomni-Web (G-1 + G0..G10)
#
# Runs every check listed in .claude/plans/production-backport.md §"全量门禁清单":
#   G-1  staged/unstaged secret scan
#   G0   git diff whitespace check
#   G1   chat-ai vue-tsc --noEmit
#   G2   chat-ai eslint (read-only, no --fix)
#   G3   chat-ai vite build
#   G4   nky_client_go go mod tidy
#   G5   nky_client_go gofmt -l (must be empty)
#   G6   nky_client_go go vet
#   G7   nky_client_go go build
#   G8   nky_client_python uv sync
#   G9   nky_client_python compileall on the five real entrypoints
#   G10  (Phase D+) attempt mcp_server_phytomni.server import; skip if absent
#
# Exit 0 means safe to commit. Any failure aborts via `set -e`.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# ------------------------------------------------------------------
# Pretty printing
# ------------------------------------------------------------------
step() { printf '\n\e[1;34m==> %s\e[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }
fail() { printf '\n\e[1;31mFAIL: %s\e[0m\n' "$*" >&2; exit 1; }

# ------------------------------------------------------------------
# G-1 — secret scan on the diff
# ------------------------------------------------------------------
step "G-1 secret scan (changed files only)"
changed="$(mktemp)"
trap 'rm -f "$changed"' EXIT
{
  git diff --name-only --diff-filter=ACMR
  git diff --cached --name-only --diff-filter=ACMR
} | sort -u >"$changed"

if [ -s "$changed" ]; then
  # Real-secret patterns — literal value forms, not field names.
  hits="$(xargs -a "$changed" -r rg -nP \
    -e '[A-Z0-9]{20}\.[A-Za-z0-9/+]{40}' \
    -e 'AKIA[0-9A-Z]{16}' \
    -e 'AKLT[A-Za-z0-9]{20,}' \
    -e '(mysql|postgres(?:ql)?)://[^[:space:]"]+:[^[:space:]"@]+@' \
    -e 'Bearer\s+[A-Za-z0-9._\-]{30,}' \
    -e 'eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}' \
    2>/dev/null || true)"
  if [ -n "$hits" ]; then
    printf '%s\n' "$hits"
    fail "G-1 secret scan: literal credential-shaped strings detected above; redact before commit."
  fi
  note "no real-secret patterns in changed files"
else
  note "no staged/unstaged changes — skip"
fi

# ------------------------------------------------------------------
# G0 — whitespace
# ------------------------------------------------------------------
step "G0 git diff --check"
git diff --check
git diff --cached --check
note "no whitespace errors"

# ------------------------------------------------------------------
# Sub-project gates
# ------------------------------------------------------------------
step "G1 chat-ai: vue-tsc --noEmit"
( cd chat-ai && npm run --silent type-check )

step "G2 chat-ai: eslint (read-only)"
( cd chat-ai && npx --no-install eslint . \
  --ext .vue,.js,.jsx,.cjs,.mjs,.ts,.tsx,.cts,.mts \
  --ignore-path .gitignore )

step "G3 chat-ai: vite build"
( cd chat-ai && npm run --silent build )

step "G4 nky_client_go: go mod tidy"
( cd nky_client_go && go mod tidy )
if ! git diff --quiet -- nky_client_go/go.mod nky_client_go/go.sum; then
  fail "G4 go mod tidy touched go.mod/go.sum; review the diff and commit it before retrying."
fi

step "G5 nky_client_go: gofmt -l"
unformatted="$( cd nky_client_go && gofmt -l . )"
if [ -n "$unformatted" ]; then
  printf 'gofmt -l reported:\n%s\n' "$unformatted" >&2
  fail "G5 gofmt: files above are not gofmt-clean; run 'gofmt -w' on them."
fi

step "G6 nky_client_go: go vet"
( cd nky_client_go && go vet ./... )

step "G7 nky_client_go: go build"
( cd nky_client_go && go build -o /tmp/phytomni-nky-main . ) && rm -f /tmp/phytomni-nky-main

step "G8 nky_client_python: uv sync"
( cd nky_client_python && uv sync --quiet )

step "G9 nky_client_python: compileall entrypoints"
( cd nky_client_python && uv run --quiet python -m compileall -q \
  nky_client.py models.py tool_format_processing.py client_log.py main.py )

step "G10 nky_client_python: try import mcp_server_phytomni.server"
if ( cd nky_client_python && uv run --quiet python -c "import mcp_server_phytomni.server" 2>/dev/null ); then
  note "mcp_server_phytomni import ok"
else
  note "skip — mcp_server_phytomni not installed (expected before Phase D editable link)"
fi

step "validate_web_local.sh: ALL GATES PASS"
