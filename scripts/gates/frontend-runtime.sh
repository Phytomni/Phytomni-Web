#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/gates/common.sh
source "$SCRIPT_DIR/common.sh"

step "G3 apps/web: vite build"
( cd apps/web && npm run --silent build )

step "G12 apps/web: vitest run + coverage threshold"
( cd apps/web && npm run coverage )
