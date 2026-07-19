#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
REPO_ROOT="$(cd "${WEB_ROOT}/../.." && pwd)"
EVIDENCE_DIR="${REPO_ROOT}/.codex/evidence/frontend-v2/chat-home-restoration/harness"
SESSION="phy-chat-home-matrix"
BASE_URL="http://127.0.0.1:5174/tests/visual/chat/"

cleanup() {
  agent-browser --session "${SESSION}" close >/dev/null 2>&1 || true
}
trap cleanup EXIT

mkdir -p "${EVIDENCE_DIR}"
test -d "${EVIDENCE_DIR}"

viewports=(
  "320 568"
  "390 844"
  "480 800"
  "768 1024"
  "1024 768"
  "1366 768"
  "1440 900"
  "1920 1080"
  "2560 1440"
)
representative_populated=(
  "320 568"
  "768 1024"
  "1024 768"
  "1440 900"
  "2560 1440"
)
locales=("en-US" "zh-CN")
themes=("light" "dark")

capture_fixture() {
  local state="$1"
  local width="$2"
  local height="$3"
  local locale="$4"
  local theme="$5"
  local stem="chat__${state}__${width}x${height}__${locale}__${theme}"

  agent-browser --session "${SESSION}" set viewport "${width}" "${height}"
  agent-browser --session "${SESSION}" set media "${theme}"
  agent-browser --session "${SESSION}" open "${BASE_URL}?state=${state}&locale=${locale}&theme=${theme}"
  agent-browser --session "${SESSION}" wait --fn "document.querySelector('[data-testid=chat-visual-root]')?.dataset.fixtureReady === 'true'"
  agent-browser --session "${SESSION}" eval --stdin < "${SCRIPT_DIR}/measure-geometry.js" | tee "${EVIDENCE_DIR}/${stem}.geometry.json"
  test -s "${EVIDENCE_DIR}/${stem}.geometry.json"
  agent-browser --session "${SESSION}" eval --stdin < "${SCRIPT_DIR}/assert-geometry.js"
  agent-browser --session "${SESSION}" screenshot "${EVIDENCE_DIR}/${stem}.png"
}

for viewport in "${viewports[@]}"; do
  read -r width height <<< "${viewport}"
  for locale in "${locales[@]}"; do
    for theme in "${themes[@]}"; do
      capture_fixture "empty" "${width}" "${height}" "${locale}" "${theme}"
      capture_fixture "empty-cases" "${width}" "${height}" "${locale}" "${theme}"
    done
  done
done

for viewport in "${representative_populated[@]}"; do
  read -r width height <<< "${viewport}"
  for locale in "${locales[@]}"; do
    for theme in "${themes[@]}"; do
      capture_fixture "populated" "${width}" "${height}" "${locale}" "${theme}"
    done
  done
done

for locale in "${locales[@]}"; do
  for theme in "${themes[@]}"; do
    capture_fixture "sidebar-mobile-closed" "390" "844" "${locale}" "${theme}"
    capture_fixture "sidebar-mobile-open" "390" "844" "${locale}" "${theme}"
  done
done

agent-browser --session "${SESSION}" close
trap - EXIT
