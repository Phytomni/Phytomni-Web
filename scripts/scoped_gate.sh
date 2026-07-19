#!/usr/bin/env bash

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
# shellcheck source=scripts/gates/common.sh
source "$ROOT/scripts/gates/common.sh"

requested_mode="${1:-}"
case "$requested_mode" in
  precommit|prepush|scoped)
    ;;
  *)
    printf 'usage: scripts/scoped_gate.sh <precommit|prepush|scoped>\n' >&2
    exit 2
    ;;
esac

mode="$requested_mode"
if [ "$mode" = "scoped" ]; then
  mode="prepush"
fi

fail() {
  printf 'scoped_gate: %s\n' "$*" >&2
  exit 1
}

skip() {
  printf '\n==> scoped gate: skip %s\n' "$*"
}

run_group() {
  local group="$1"
  local dispatcher="$ROOT/scripts/run_gate_group.sh"
  [ -x "$dispatcher" ] || fail "gate dispatcher is missing or not executable: $dispatcher"
  printf '\n==> scoped gate: run %s group\n' "$group"
  "$dispatcher" "$group"
}

run_full() {
  local gate="$ROOT/scripts/validate_web_local.sh"
  [ -x "$gate" ] || fail "full gate is missing or not executable: $gate"
  printf '\n==> scoped gate: policy change forces full gate\n'
  "$gate"
}

append_git_paths() {
  local output
  local -a paths=()
  output="$(mktemp)"
  if ! git "$@" -z >"$output"; then
    rm -f "$output"
    fail "Git scope query failed: git $*"
  fi
  if [ -s "$output" ]; then
    mapfile -d '' -t paths <"$output"
    changed_paths+=("${paths[@]}")
  fi
  rm -f "$output"
}

deduplicate_paths() {
  local output
  local path
  local -a sorted_paths=()
  declare -A unique=()
  for path in "${changed_paths[@]}"; do
    [ -n "$path" ] && unique["$path"]=1
  done
  changed_paths=()
  if [ "${#unique[@]}" -eq 0 ]; then
    return
  fi
  output="$(mktemp)"
  printf '%s\0' "${!unique[@]}" | LC_ALL=C sort -z >"$output"
  mapfile -d '' -t sorted_paths <"$output"
  changed_paths=("${sorted_paths[@]}")
  rm -f "$output"
}

is_frontend_suffix() {
  case "$1" in
    *.vue|*.js|*.jsx|*.cjs|*.mjs|*.ts|*.tsx|*.cts|*.mts)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_test_path() {
  case "$1" in
    apps/web/tests/*)
      case "$1" in
        *.spec.ts|*.test.ts) return 0 ;;
      esac
      ;;
  esac
  return 1
}

collect_related_tests() {
  local path
  local candidate
  local candidate_base
  local candidate_stem
  local output
  local -a candidates=()
  declare -A source_stems=()
  declare -A related=()

  if [ ! -d "$ROOT/apps/web/tests" ]; then
    related_tests=()
    return
  fi

  for path in "${frontend_scope_paths[@]}"; do
    [ -e "$ROOT/$path" ] || continue
    if is_test_path "$path"; then
      related["$path"]=1
    else
      candidate_base="${path##*/}"
      source_stems["${candidate_base%.*}"]=1
    fi
  done

  output="$(mktemp)"
  if rg --files -0 -g '*.spec.ts' -g '*.test.ts' apps/web/tests >"$output"; then
    :
  else
    local rc=$?
    [ "$rc" -eq 1 ] || {
      rm -f "$output"
      fail "could not enumerate related Vitest specs"
    }
  fi
  if [ -s "$output" ]; then
    mapfile -d '' -t candidates <"$output"
  fi
  rm -f "$output"

  for candidate in "${candidates[@]}"; do
    candidate_base="${candidate##*/}"
    case "$candidate_base" in
      *.spec.ts) candidate_stem="${candidate_base%.spec.ts}" ;;
      *.test.ts) candidate_stem="${candidate_base%.test.ts}" ;;
      *) continue ;;
    esac
    if [ "${source_stems[$candidate_stem]+set}" = set ]; then
      related["$candidate"]=1
    fi
  done

  related_tests=()
  if [ "${#related[@]}" -gt 0 ]; then
    output="$(mktemp)"
    printf '%s\0' "${!related[@]}" | LC_ALL=C sort -z >"$output"
    mapfile -d '' -t related_tests <"$output"
    rm -f "$output"
  fi
}

run_web_tool() {
  local label="$1"
  shift
  printf '\n==> scoped gate: %s\n' "$label"
  (cd "$ROOT/apps/web" && "$@")
}

run_suppression_scan() {
  printf '\n==> scoped gate: exact static-analysis reconciliation\n'
  run_static_analysis_check - \
    --collector eslint \
    --collector typescript \
    --collector source \
    --collector config \
    --collector ci \
    --collector go
}

run_frontend_scope() {
  local prettier="$ROOT/apps/web/node_modules/.bin/prettier"
  local vitest="$ROOT/apps/web/node_modules/.bin/vitest"
  local path
  local -a web_paths=()
  local -a test_paths=()

  [ -x "$prettier" ] || fail "frontend formatter is missing or not executable: $prettier"
  for path in "${frontend_paths[@]}"; do
    web_paths+=("${path#apps/web/}")
  done

  if [ "${#web_paths[@]}" -gt 0 ]; then
    run_web_tool "G2.1 Prettier changed frontend files" "$prettier" --check "${web_paths[@]}"
  else
    skip "Prettier changed frontend files (all changed files were deleted)"
  fi
  run_suppression_scan

  collect_related_tests
  if [ "${#related_tests[@]}" -eq 0 ]; then
    skip "related Vitest specs (none mapped)"
    return
  fi
  [ -x "$vitest" ] || fail "frontend Vitest is missing or not executable: $vitest"
  for path in "${related_tests[@]}"; do
    test_paths+=("${path#apps/web/}")
  done
  run_web_tool "related Vitest specs" "$vitest" run "${test_paths[@]}"
}

run_go_scope() {
  local gofmt_output
  local path
  local package_dir
  local -a server_paths=()
  local -a package_dirs=()
  declare -A unique_packages=()

  if [ "$go_foundation" -eq 1 ] || [ "$go_deleted" -eq 1 ]; then
    run_group server-static
    run_group server-runtime
    return
  fi

  for path in "${go_paths[@]}"; do
    server_paths+=("${path#apps/server/}")
    package_dir="${path#apps/server/}"
    if [[ "$package_dir" == */* ]]; then
      package_dir="${package_dir%/*}"
    else
      package_dir="."
    fi
    unique_packages["$package_dir"]=1
  done
  package_dirs=("${!unique_packages[@]}")

  printf '\n==> scoped gate: gofmt changed Go files\n'
  gofmt_output="$(cd "$ROOT/apps/server" && gofmt -l "${server_paths[@]}")"
  if [ -n "$gofmt_output" ]; then
    printf '%s\n' "$gofmt_output" >&2
    fail "gofmt reported unformatted changed files"
  fi

  for package_dir in "${package_dirs[@]}"; do
    run_go_tool "go vet ./$package_dir" vet "./$package_dir"
    run_go_tool "go test ./$package_dir" test "./$package_dir"
  done
}

run_go_tool() {
  local label="$1"
  local subcommand="$2"
  local package="$3"
  printf '\n==> scoped gate: %s\n' "$label"
  (cd "$ROOT/apps/server" && go "$subcommand" "$package")
}

changed_paths=()
base=""
base_source=""
if [ "$mode" = "precommit" ]; then
  append_git_paths diff --cached --name-only --diff-filter=ACMR
  printf '==> scoped gate (precommit, staged index)\n'
else
  if base="$(git rev-parse --verify '@{upstream}' 2>/dev/null)"; then
    base_source="upstream"
  elif base="$(git merge-base HEAD main 2>/dev/null)"; then
    base_source="merge-base"
  else
    fail 'cannot resolve @{upstream} or merge-base HEAD main; run "make full" instead'
  fi
  append_git_paths diff --name-only --diff-filter=ACMR "$base..HEAD"
  append_git_paths diff --name-only --diff-filter=ACMR
  append_git_paths diff --cached --name-only --diff-filter=ACMR
  append_git_paths ls-files --others --exclude-standard
  printf '==> scoped gate (%s, BASE=%s)\n' "$mode/$base_source" "$base"
fi
deduplicate_paths

if [ "${#changed_paths[@]}" -eq 0 ]; then
  printf 'scoped gate: no changed files; skipping all tools\n'
  exit 0
fi

frontend_paths=()
frontend_scope_paths=()
go_paths=()
related_tests=()
frontend_changed=0
go_changed=0
go_deleted=0
go_foundation=0
policy_changed=0
for path in "${changed_paths[@]}"; do
  case "$path" in
    static-analysis-exemptions.toml|docs/development/static-analysis-exemptions.md|Makefile|*.toml|*.yaml|*.yml|.github/workflows/*|.githooks/*|scripts/check_static_analysis_exemptions.py|scripts/static_analysis/*|scripts/gates/*|scripts/run_gate_group.sh|scripts/validate_web_local.sh|scripts/scoped_gate.sh|scripts/scan_secrets.py|scripts/check_*.py|scripts/tests/test_gate_contract.py|scripts/tests/test_scoped_gate.py|scripts/tests/test_makefile_contract.py|apps/web/package.json|apps/web/package-lock.json|apps/web/tsconfig*.json|apps/web/.eslintrc.cjs|apps/web/.prettierrc.cjs|apps/server/go.mod|apps/server/go.sum|apps/server/config/*)
      policy_changed=1
      ;;
  esac
  case "$path" in
    apps/server/go.mod|apps/server/go.sum|apps/server/main.go|apps/server/db/*|apps/server/model/*|apps/server/middleware/*|apps/server/config/*|apps/server/common/*|apps/server/utils/*|apps/server/server/*)
      go_foundation=1
      ;;
  esac
  if [[ "$path" == apps/web/* ]] && is_frontend_suffix "$path"; then
    frontend_changed=1
    frontend_scope_paths+=("$path")
    [ -e "$ROOT/$path" ] && frontend_paths+=("$path")
  fi
  if [[ "$path" == apps/server/*.go || "$path" == apps/server/**/*.go ]]; then
    go_changed=1
    if [ -e "$ROOT/$path" ]; then
      go_paths+=("$path")
    else
      go_deleted=1
    fi
  fi
done

if [ "$policy_changed" -eq 1 ]; then
  run_full
  printf '\n==> scoped gate passed (full policy path)\n'
  exit 0
fi

run_group hygiene

if [ "$frontend_changed" -eq 1 ]; then
  run_frontend_scope
else
  skip "frontend static/runtime tools (no changed TypeScript/Vue/JavaScript files)"
fi

if [ "$go_changed" -eq 1 ]; then
  run_go_scope
else
  skip "Go static/runtime tools (no changed Go files)"
fi

run_group contracts
printf '\n==> scoped gate passed\n'
