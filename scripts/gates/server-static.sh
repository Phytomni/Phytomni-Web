#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/gates/common.sh
source "$SCRIPT_DIR/common.sh"

step "G4.1 apps/server: exact Go directives and config reconciliation"
run_static_analysis_check - \
    --collector go \
    --collector config

step "G4 apps/server: go module integrity and tidy"
(cd apps/server && go mod verify)
(cd apps/server && go mod tidy)
changed_modules="$(git diff --name-only -- apps/server/go.mod apps/server/go.sum)"
if [ -n "$changed_modules" ]; then
    fail "G4 go mod tidy touched go.mod/go.sum; review the diff and commit it before retrying."
fi

step "G5 apps/server: gofmt -l"
unformatted="$(cd apps/server && gofmt -l .)"
if [ -n "$unformatted" ]; then
    printf 'gofmt -l reported:\n%s\n' "$unformatted" >&2
    fail "G5 gofmt: files above are not gofmt-clean; run 'gofmt -w' on them."
fi

step "G6 apps/server: go vet"
(cd apps/server && go vet ./...)

step "G7 apps/server: go build"
(cd apps/server && go build -o /tmp/phytomni-nky-main .) && rm -f /tmp/phytomni-nky-main

STATICCHECK_CACHE="${STATICCHECK_CACHE:-$ROOT/.cache/phytomni/staticcheck-cache}"
export STATICCHECK_CACHE
(cd apps/server && "$ROOT/scripts/staticcheck_runner.sh" -f json ./...)
