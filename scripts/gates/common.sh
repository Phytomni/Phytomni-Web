#!/usr/bin/env bash

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

step() { printf '\n\e[1;34m==> %s\e[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }
fail() {
  printf '\n\e[1;31mFAIL: %s\e[0m\n' "$*" >&2
  exit 1
}
