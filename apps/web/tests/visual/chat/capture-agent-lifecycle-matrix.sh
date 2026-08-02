#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
REPO_ROOT="$(cd "${WEB_ROOT}/../.." && pwd)"
EVIDENCE_DIR="${REPO_ROOT}/.codex/evidence/frontend-v2/agent-lifecycle"
LEDGER_PATH="${EVIDENCE_DIR}/visual-review-ledger.md"
SESSION="phy-agent-lifecycle-matrix"
BASE_URL="http://127.0.0.1:5174/tests/visual/chat/"

cleanup() {
    if ! agent-browser --session "${SESSION}" close >/dev/null 2>&1; then
        printf 'Agent lifecycle matrix cleanup: browser close failed\n' >&2
    fi
}
trap cleanup EXIT

mkdir -p "${EVIDENCE_DIR}"
test -d "${EVIDENCE_DIR}"
find "${EVIDENCE_DIR}" -mindepth 1 -maxdepth 1 -type f -delete

states=(
    "agent-preparing"
    "agent-running-partial"
    "agent-succeeded-artifacts"
    "agent-succeeded-empty"
    "agent-failed"
    "review-confirm-fallback"
    "analyst-log-pending"
    "analyst-log-available"
)
viewports=("390 844" "1440 900")
themes=("light" "dark")

capture_fixture() {
    local state="$1"
    local width="$2"
    local height="$3"
    local theme="$4"
    local stem="agent-lifecycle__${state}__${width}x${height}__${theme}"

    agent-browser --session "${SESSION}" set viewport "${width}" "${height}"
    agent-browser --session "${SESSION}" set media "${theme}"
    agent-browser --session "${SESSION}" open \
        "${BASE_URL}?state=${state}&locale=en-US&theme=${theme}"
    agent-browser --session "${SESSION}" wait --fn \
        "document.querySelector('[data-testid=chat-visual-root]')?.dataset.fixtureReady === 'true'"
    if [[ "${state}" == "agent-succeeded-artifacts" ]]; then
        agent-browser --session "${SESSION}" wait --fn \
            "(() => { const images = Array.from(document.querySelectorAll('[data-testid=chat-visual-root] img')); return images.length > 0 && images.every((image) => image.complete && image.naturalWidth > 0); })()"
    else
        agent-browser --session "${SESSION}" wait --fn \
            "Array.from(document.querySelectorAll('[data-testid=chat-visual-root] img')).every((image) => image.complete && image.naturalWidth > 0)"
    fi
    agent-browser --session "${SESSION}" wait 500
    agent-browser --session "${SESSION}" eval --stdin \
        <"${SCRIPT_DIR}/measure-geometry.js" |
        tee "${EVIDENCE_DIR}/${stem}.geometry.json"
    test -s "${EVIDENCE_DIR}/${stem}.geometry.json"
    agent-browser --session "${SESSION}" eval --stdin \
        <"${SCRIPT_DIR}/assert-geometry.js"
    agent-browser --session "${SESSION}" eval --stdin \
        <"${SCRIPT_DIR}/assert-agent-lifecycle-styles.js" |
        tee "${EVIDENCE_DIR}/${stem}.lifecycle-style.json"
    test -s "${EVIDENCE_DIR}/${stem}.lifecycle-style.json"
    agent-browser --session "${SESSION}" screenshot \
        "${EVIDENCE_DIR}/${stem}.png"
}

regenerate_visual_review_ledger() {
    {
        printf '%s\n' '| Screenshot | Locale | Theme | Viewport | State | fixture_source | Geometry | identity_redaction | manual_review | Notes |'
        printf '%s\n' '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
        while IFS= read -r png; do
            local filename="${png##*/}"
            local remainder="${filename#agent-lifecycle__}"
            local state="${remainder%%__*}"
            remainder="${remainder#*__}"
            local viewport="${remainder%%__*}"
            remainder="${remainder#*__}"
            local theme="${remainder%.png}"
            printf '%s\n' "| \`${filename}\` | en-US | ${theme} | ${viewport} | ${state} | tests/visual/chat | PASS | not-needed-synthetic | Pending | Geometry and lifecycle-style assertions passed; manual review pending. |"
        done < <(find "${EVIDENCE_DIR}" -maxdepth 1 -type f -name '*.png' -print | LC_ALL=C sort)
    } >"${LEDGER_PATH}"

    local ledger_rows
    ledger_rows=$(grep -Ec '^\| [^|]*agent-lifecycle__.*[.]png[^|]*\|' "${LEDGER_PATH}")
    test "${ledger_rows}" -eq "${EXPECTED_COUNT}"
}

for state in "${states[@]}"; do
    for viewport in "${viewports[@]}"; do
        read -r width height <<<"${viewport}"
        for theme in "${themes[@]}"; do
            capture_fixture "${state}" "${width}" "${height}" "${theme}"
        done
    done
done

EXPECTED_COUNT=32
png_count=$(find "${EVIDENCE_DIR}" -maxdepth 1 -type f -name '*.png' | wc -l | tr -d ' ')
geometry_count=$(find "${EVIDENCE_DIR}" -maxdepth 1 -type f -name '*.geometry.json' | wc -l | tr -d ' ')
style_count=$(find "${EVIDENCE_DIR}" -maxdepth 1 -type f -name '*.lifecycle-style.json' | wc -l | tr -d ' ')
test "${png_count}" -eq "${EXPECTED_COUNT}"
test "${geometry_count}" -eq "${EXPECTED_COUNT}"
test "${style_count}" -eq "${EXPECTED_COUNT}"

for png in "${EVIDENCE_DIR}"/*.png; do
    test -s "${png%.png}.geometry.json"
    test -s "${png%.png}.lifecycle-style.json"
done

regenerate_visual_review_ledger

agent-browser --session "${SESSION}" close
trap - EXIT
