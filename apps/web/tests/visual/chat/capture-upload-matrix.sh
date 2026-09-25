#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
REPO_ROOT="$(cd "${WEB_ROOT}/../.." && pwd)"
EVIDENCE_DIR="${REPO_ROOT}/.codex/evidence/frontend-v2/unified-attachments"
SESSION="phy-chat-unified-attachments"
TRACKED_CAPTURE_FILES=(
    "apps/web/src/views/chat/components/AttachmentChipStrip.vue"
    "apps/web/tests/component/AttachmentChipStrip.spec.ts"
    "apps/web/tests/unit/views/chat/chat-visual-fixtures.spec.ts"
    "apps/web/tests/visual/chat/README.md"
    "apps/web/tests/visual/chat/assert-upload-styles.js"
    "apps/web/tests/visual/chat/capture-upload-matrix.sh"
    "apps/web/tests/visual/chat/measure-geometry.js"
)
if ! git -C "${REPO_ROOT}" diff --exit-code -- "${TRACKED_CAPTURE_FILES[@]}" >/dev/null 2>&1 ||
    ! git -C "${REPO_ROOT}" diff --cached --exit-code -- "${TRACKED_CAPTURE_FILES[@]}" >/dev/null 2>&1; then
    printf '%s\n' \
        'attachment capture requires clean tracked attachment sources; ignored evidence is allowed' >&2
    exit 1
fi
BASE_URL="http://127.0.0.1:5174/tests/visual/chat/"
SOURCE_SHA="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
GEOMETRY_SCRIPT_SHA256="$(sha256sum "${SCRIPT_DIR}/measure-geometry.js" | awk '{print $1}')"
STYLE_SCRIPT_SHA256="$(sha256sum "${SCRIPT_DIR}/assert-upload-styles.js" | awk '{print $1}')"
CONTRACT_SHA256="$(sha256sum "${WEB_ROOT}/tests/unit/views/chat/chat-visual-fixtures.spec.ts" | awk '{print $1}')"

# This capture only creates evidence; it does not claim a visual pass.

cleanup() {
    if ! agent-browser --session "${SESSION}" close >/dev/null 2>&1; then
        printf 'unified attachment cleanup: browser close failed\n' >&2
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
    "empty"
    "uploading-detail-open"
    "mixed-ready-failed-expired"
    "ten-files-overflow"
    "incompatible-agent-blocked"
)
themes=("light" "dark")

capture_fixture() {
    local state="$1"
    local width="$2"
    local height="$3"
    local theme="$4"
    local stem="attachment__${state}__${width}x${height}__${theme}"

    agent-browser --session "${SESSION}" set viewport "${width}" "${height}"
    agent-browser --session "${SESSION}" set media "${theme}"
    agent-browser --session "${SESSION}" open \
        "${BASE_URL}?state=${state}&locale=en-US&theme=${theme}"
    agent-browser --session "${SESSION}" wait --fn \
        "document.querySelector('[data-testid=chat-visual-root]')?.dataset.fixtureReady === 'true'"

    agent-browser --session "${SESSION}" eval \
        "window.__PHY_CHAT_CAPTURE_META__ = {contract: 'unified-attachments-v1', sourceSha: '${SOURCE_SHA}', geometryScriptSha256: '${GEOMETRY_SCRIPT_SHA256}', styleScriptSha256: '${STYLE_SCRIPT_SHA256}', contractSha256: '${CONTRACT_SHA256}'}"

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
geometry_count=$(
    find "${EVIDENCE_DIR}" -maxdepth 1 -type f -name '*.geometry.json' |
        wc -l |
        tr -d ' '
)
style_count=$(
    find "${EVIDENCE_DIR}" -maxdepth 1 -type f -name '*.upload.json' |
        wc -l |
        tr -d ' '
)
test "${png_count}" -eq "${EXPECTED_COUNT}"
test "${geometry_count}" -eq "${EXPECTED_COUNT}"
test "${style_count}" -eq "${EXPECTED_COUNT}"

for png in "${EVIDENCE_DIR}"/*.png; do
    test -s "${png%.png}.geometry.json"
    test -s "${png%.png}.upload.json"
done

agent-browser --session "${SESSION}" close
trap - EXIT
