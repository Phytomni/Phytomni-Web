#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/gates/common.sh
source "$SCRIPT_DIR/common.sh"

step "G1 apps/web: exact TypeScript reconciliation"
run_static_analysis_check - --collector typescript

step "G2.1 apps/web: Prettier format check (read-only)"
( cd apps/web && npm run --silent format:check )

step "G2 apps/web: exact ESLint reconciliation"
run_static_analysis_check - --collector eslint
