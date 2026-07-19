#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/gates/common.sh
source "$SCRIPT_DIR/common.sh"

step "G-0 server-runtime: exact static-analysis suppression reconciliation"
run_static_analysis_check - \
  --collector source \
  --collector config \
  --collector ci

step "G7.5 apps/server: go test"
( cd apps/server && go test ./... )
