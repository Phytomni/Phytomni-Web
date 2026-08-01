#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
REPO_ROOT="$(cd "${WEB_ROOT}/../.." && pwd)"
EVIDENCE_DIR="${REPO_ROOT}/.codex/evidence/frontend-v2/resumable-upload"
SESSION="phy-chat-upload-matrix"
BASE_URL="http://127.0.0.1:5174/tests/visual/chat/"

cleanup() {
    if ! agent-browser --session "${SESSION}" close >/dev/null 2>&1; then
        printf 'upload matrix cleanup: browser close failed\n' >&2
    fi
}
trap cleanup EXIT

mkdir -p "${EVIDENCE_DIR}"
test -d "${EVIDENCE_DIR}"
find "${EVIDENCE_DIR}" -mindepth 1 -maxdepth 1 -type f -delete

viewports=(
    "320 568"
    "390 844"
    "480 800"
    "768 1024"
    "1024 768"
    "1366 768"
    "1920 1080"
    "2560 1440"
)
states=(
    "upload-queued"
    "upload-uploading"
    "upload-paused"
    "upload-failed"
    "upload-completed"
)
themes=("light" "dark")

capture_fixture() {
    local state="$1"
    local width="$2"
    local height="$3"
    local theme="$4"
    local stem="upload__${state#upload-}__${width}x${height}__${theme}"

    agent-browser --session "${SESSION}" set viewport "${width}" "${height}"
    agent-browser --session "${SESSION}" set media "${theme}"
    agent-browser --session "${SESSION}" open \
        "${BASE_URL}?state=${state}&locale=en-US&theme=${theme}"
    agent-browser --session "${SESSION}" wait --fn \
        "document.querySelector('[data-testid=chat-visual-root]')?.dataset.fixtureReady === 'true'"
    agent-browser --session "${SESSION}" eval --stdin \
        <"${SCRIPT_DIR}/measure-geometry.js" |
        tee "${EVIDENCE_DIR}/${stem}.geometry.json"
    test -s "${EVIDENCE_DIR}/${stem}.geometry.json"
    agent-browser --session "${SESSION}" eval --stdin \
        <"${SCRIPT_DIR}/assert-geometry.js"
    agent-browser --session "${SESSION}" eval --stdin \
        <"${SCRIPT_DIR}/assert-upload-styles.js" |
        tee "${EVIDENCE_DIR}/${stem}.upload.json"
    test -s "${EVIDENCE_DIR}/${stem}.upload.json"
    agent-browser --session "${SESSION}" screenshot \
        "${EVIDENCE_DIR}/${stem}.png"
}

for state in "${states[@]}"; do
    for viewport in "${viewports[@]}"; do
        read -r width height <<<"${viewport}"
        for theme in "${themes[@]}"; do
            capture_fixture "${state}" "${width}" "${height}" "${theme}"
        done
    done
done

EXPECTED_COUNT=80
png_count=$(find "${EVIDENCE_DIR}" -maxdepth 1 -type f -name '*.png' | wc -l | tr -d ' ')
geometry_count=$(find "${EVIDENCE_DIR}" -maxdepth 1 -type f -name '*.geometry.json' | wc -l | tr -d ' ')
style_count=$(find "${EVIDENCE_DIR}" -maxdepth 1 -type f -name '*.upload.json' | wc -l | tr -d ' ')
test "${png_count}" -eq "${EXPECTED_COUNT}"
test "${geometry_count}" -eq "${EXPECTED_COUNT}"
test "${style_count}" -eq "${EXPECTED_COUNT}"

for png in "${EVIDENCE_DIR}"/*.png; do
    test -s "${png%.png}.geometry.json"
    test -s "${png%.png}.upload.json"
done

agent-browser --session "${SESSION}" close
trap - EXIT
