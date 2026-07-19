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

run_static_analysis_check() {
  local ledger_path="$1"
  shift
  local output
  local status
  local -a command=(
    python3
    scripts/check_static_analysis_exemptions.py
    --check
  )
  if [ "$ledger_path" != "-" ]; then
    command+=(--check-ledger "$ledger_path")
  fi
  command+=("$@")
  output="$(mktemp)"
  if "${command[@]}" >"$output"; then
    rm -f "$output"
    return 0
  else
    status=$?
  fi
  tail -40 "$output" >&2
  rm -f "$output"
  return "$status"
}
