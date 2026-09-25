#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
REPO_ROOT="$(cd "${WEB_ROOT}/../.." && pwd)"
EVIDENCE_DIR="${REPO_ROOT}/.codex/evidence/frontend-v2/responsive-continuity"
SESSION="phy-chat-home-matrix"
BASE_URL="http://127.0.0.1:5174/tests/visual/chat/"

cleanup() {
    if ! agent-browser --session "${SESSION}" close >/dev/null 2>&1; then
        printf 'visual matrix cleanup: browser close failed\n' >&2
    fi
}
trap cleanup EXIT

mkdir -p "${EVIDENCE_DIR}"
test -d "${EVIDENCE_DIR}"
# A failed rerun must never leave stale screenshots or geometry records that
# can be mistaken for evidence from the current matrix.
find "${EVIDENCE_DIR}" -mindepth 1 -maxdepth 1 -type f -delete

viewports=(
    "320 568"
    "390 844"
    "480 800"
    "768 1024"
    "899 768"
    "900 768"
    "1024 768"
    "1199 768"
    "1279 768"
    "1280 768"
    "1366 768"
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
recovery_agent_preview=(
    "390 844"
    "1440 900"
    "2560 1440"
)
recovery_compact_disclosure=(
    "1024 768"
    "1279 768"
)
recovery_history=(
    "390 844"
    "768 1024"
    "1024 768"
    "1920 1080"
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
    if [[ "${state}" == "agent-preview" ]]; then
        agent-browser --session "${SESSION}" wait --fn "(() => { const dialog = document.querySelector('[data-testid=chat-agent-preview] [role=dialog]'); const media = document.querySelector('[data-testid=chat-agent-preview] .agent-capability-popover__media'); if (!dialog || !media) return false; const dialogRect = dialog.getBoundingClientRect(); const mediaRect = media.getBoundingClientRect(); return dialogRect.width > 0 && dialogRect.height > 0 && mediaRect.width > 0 && mediaRect.height > 0; })()"
    fi
    agent-browser --session "${SESSION}" eval --stdin <"${SCRIPT_DIR}/measure-geometry.js" | tee "${EVIDENCE_DIR}/${stem}.geometry.json"
    test -s "${EVIDENCE_DIR}/${stem}.geometry.json"
    agent-browser --session "${SESSION}" eval --stdin <"${SCRIPT_DIR}/assert-geometry.js"
    agent-browser --session "${SESSION}" screenshot "${EVIDENCE_DIR}/${stem}.png"
}

for viewport in "${viewports[@]}"; do
    read -r width height <<<"${viewport}"
    for locale in "${locales[@]}"; do
        for theme in "${themes[@]}"; do
            capture_fixture "empty" "${width}" "${height}" "${locale}" "${theme}"
            capture_fixture "empty-cases" "${width}" "${height}" "${locale}" "${theme}"
        done
    done
done

for viewport in "${representative_populated[@]}"; do
    read -r width height <<<"${viewport}"
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

for viewport in "${recovery_agent_preview[@]}"; do
    read -r width height <<<"${viewport}"
    for locale in "${locales[@]}"; do
        for theme in "${themes[@]}"; do
            capture_fixture "agent-preview" "${width}" "${height}" "${locale}" "${theme}"
        done
    done
done

for viewport in "${recovery_compact_disclosure[@]}"; do
    read -r width height <<<"${viewport}"
    for locale in "${locales[@]}"; do
        for theme in "${themes[@]}"; do
            capture_fixture "sidebar-compact-explore-open" "${width}" "${height}" "${locale}" "${theme}"
        done
    done
done

for state in history-title-only history-loading history-empty history-error; do
    for viewport in "${recovery_history[@]}"; do
        read -r width height <<<"${viewport}"
        for locale in "${locales[@]}"; do
            for theme in "${themes[@]}"; do
                capture_fixture "${state}" "${width}" "${height}" "${locale}" "${theme}"
            done
        done
    done
done

EXPECTED_PNG_COUNT=232
EXPECTED_GEOMETRY_COUNT=232
png_count=$(find "${EVIDENCE_DIR}" -mindepth 1 -maxdepth 1 -type f -name '*.png' | wc -l | tr -d ' ')
geometry_count=$(find "${EVIDENCE_DIR}" -mindepth 1 -maxdepth 1 -type f -name '*.geometry.json' | wc -l | tr -d ' ')
test "${png_count}" -eq "${EXPECTED_PNG_COUNT}"
test "${geometry_count}" -eq "${EXPECTED_GEOMETRY_COUNT}"
for png in "${EVIDENCE_DIR}"/*.png; do
    test -f "${png%.png}.geometry.json"
done

agent-browser --session "${SESSION}" close
trap - EXIT
