#!/usr/bin/env bash
# validate_web_local.sh — full pre-commit gate for Phytomni-Web (G-1 + G0..G7.5, G11–G14)
#
# Runs every check listed in .claude/plans/production-backport.md:
#   G-1  staged/unstaged secret scan
#   G0   git diff whitespace check
#   G1   apps/web vue-tsc --noEmit
#   G2   apps/web eslint (read-only, no --fix)
#   G3   apps/web vite build
#   G4   apps/server go mod tidy
#   G5   apps/server gofmt -l (must be empty)
#   G6   apps/server go vet
#   G7   apps/server go build
#   G7.5 apps/server go test ./... (guards gateway + i18n unit tests)
#   G11  apps/web SET_LOGIN_STATUS invariant — definition only in stores/user.ts,
#        call only in views/login/index.vue
#   G12  apps/web vitest run + coverage threshold
#   G13  i18n hardcoded-copy scanner (CJK / ElMessage / gin.H ratchet against
#        scripts/i18n_allowlist.md)
#   G14  frontend visual design contract (brand colors, agent-influenced glass,
#        and global wildcard CSS side effects)
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
step "G-1 secret scan (changed + untracked files)"
changed="$(mktemp)"
trap 'rm -f "$changed"' EXIT
# Scan staged + unstaged tracked changes AND new untracked files (a brand-new
# file carrying a secret is invisible to `git diff` until it is added).
# --exclude-standard honors .gitignore, so node_modules/dist/.codex stay out.
{
  git diff --name-only --diff-filter=ACMR
  git diff --cached --name-only --diff-filter=ACMR
  git ls-files --others --exclude-standard
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
step "G1 apps/web: vue-tsc --noEmit"
( cd apps/web && npm run --silent type-check )

step "G2 apps/web: eslint (read-only)"
( cd apps/web && npx --no-install eslint . \
  --ext .vue,.js,.jsx,.cjs,.mjs,.ts,.tsx,.cts,.mts \
  --ignore-path .gitignore )

step "G3 apps/web: vite build"
( cd apps/web && npm run --silent build )

step "G4 apps/server: go mod tidy"
( cd apps/server && go mod tidy )
if ! git diff --quiet -- apps/server/go.mod apps/server/go.sum; then
  fail "G4 go mod tidy touched go.mod/go.sum; review the diff and commit it before retrying."
fi

step "G5 apps/server: gofmt -l"
unformatted="$( cd apps/server && gofmt -l . )"
if [ -n "$unformatted" ]; then
  printf 'gofmt -l reported:\n%s\n' "$unformatted" >&2
  fail "G5 gofmt: files above are not gofmt-clean; run 'gofmt -w' on them."
fi

step "G6 apps/server: go vet"
( cd apps/server && go vet ./... )

step "G7 apps/server: go build"
( cd apps/server && go build -o /tmp/phytomni-nky-main . ) && rm -f /tmp/phytomni-nky-main

step "G7.5 apps/server: go test"
( cd apps/server && go test ./... )

step "G11 apps/web: SET_LOGIN_STATUS invariant (definition + sole-caller + no-stray)"
def_count="$( grep -c 'SET_LOGIN_STATUS(' apps/web/src/stores/user.ts 2>/dev/null || echo 0 )"
[ "$def_count" = "1" ] || fail "G11.1 SET_LOGIN_STATUS definition: expected 1 hit in apps/web/src/stores/user.ts, got $def_count"
call_count="$( grep -c 'SET_LOGIN_STATUS(' apps/web/src/views/login/index.vue 2>/dev/null || echo 0 )"
[ "$call_count" = "1" ] || fail "G11.2 SET_LOGIN_STATUS sole legal call: expected 1 hit in apps/web/src/views/login/index.vue, got $call_count"
stray="$( grep -rl 'SET_LOGIN_STATUS' apps/web/src/ \
  --include='*.ts' --include='*.vue' 2>/dev/null \
  | grep -v -E '^apps/web/src/stores/user\.ts$|^apps/web/src/views/login/index\.vue$' \
  || true )"
[ -z "$stray" ] || { printf '%s\n' "$stray" >&2; fail "G11.3 SET_LOGIN_STATUS stray caller: files above must not reference SET_LOGIN_STATUS — only stores/user.ts (definition) and views/login/index.vue (sole call) are allowed."; }

step "G12 apps/web: vitest run + coverage threshold"
( cd apps/web && npm run coverage )

step "G13 i18n: hardcoded-copy scanner (ratchet against allowlist)"
python3 scripts/check_i18n.py --check

step "G14 frontend visual design contract"
python3 scripts/check_brand_colors.py

step "validate_web_local.sh: ALL GATES PASS"
