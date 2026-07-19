#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/gates/common.sh
source "$SCRIPT_DIR/common.sh"

step "G1 apps/web: vue-tsc --noEmit"
( cd apps/web && npm run --silent type-check )

step "G2.1 apps/web: Prettier format check (read-only)"
( cd apps/web && npm run --silent format:check )

step "G2 apps/web: eslint (read-only)"
( cd apps/web && npx --no-install eslint . \
  --ext .vue,.js,.jsx,.cjs,.mjs,.ts,.tsx,.cts,.mts \
  --ignore-path .gitignore )
