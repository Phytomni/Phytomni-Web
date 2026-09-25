#!/usr/bin/env bash
set -euo pipefail

# Wait-progress + fake-CoT visual matrix.
# Viewports match frontend-v2/chat-home-restoration/harness:
# 8 states × 9 viewports × en-US/zh-CN × light/dark = 288 PNGs.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
REPO_ROOT="$(cd "${WEB_ROOT}/../.." && pwd)"
EVIDENCE_DIR="${PHYTOMNI_VISUAL_EVIDENCE_DIR:-${REPO_ROOT}/.codex/evidence/wait-progress-cot/harness}"
LEDGER_PATH="${EVIDENCE_DIR}/visual-review-ledger.md"
SESSION="phy-wait-cot-matrix"
BASE_URL="${PHYTOMNI_VISUAL_BASE_URL:-http://127.0.0.1:5174/tests/visual/chat/}"

cleanup() {
    if ! agent-browser --session "${SESSION}" close >/dev/null 2>&1; then
        printf 'Wait-CoT matrix cleanup: browser close failed\n' >&2
    fi
}
trap cleanup EXIT

mkdir -p "${EVIDENCE_DIR}"
test -d "${EVIDENCE_DIR}"
find "${EVIDENCE_DIR}" -mindepth 1 -maxdepth 1 -type f -delete

states=(
    "wait-cot-chat-start"
    "wait-cot-chat-mid"
    "wait-cot-chat-flush"
    "wait-cot-knowledge-mid"
    "wait-cot-design"
    "wait-cot-genome"
    "wait-cot-research"
    "wait-cot-network-partial"
)
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
locales=("en-US" "zh-CN")
themes=("light" "dark")

capture_fixture() {
    local state="$1"
    local width="$2"
    local height="$3"
    local locale="$4"
    local theme="$5"
    local stem="wait-cot__${state}__${width}x${height}__${locale}__${theme}"

    agent-browser --session "${SESSION}" set viewport "${width}" "${height}"
    agent-browser --session "${SESSION}" set media "${theme}"
    agent-browser --session "${SESSION}" open \
        "${BASE_URL}?state=${state}&locale=${locale}&theme=${theme}"
    agent-browser --session "${SESSION}" wait --fn \
        "document.querySelector('[data-testid=chat-visual-root]')?.dataset.fixtureReady === 'true'"
    agent-browser --session "${SESSION}" wait --fn \
        "document.querySelector('[data-test=send-progress]') !== null"
    agent-browser --session "${SESSION}" wait 450
    agent-browser --session "${SESSION}" screenshot \
        "${EVIDENCE_DIR}/${stem}.png"
    test -s "${EVIDENCE_DIR}/${stem}.png"
}

regenerate_visual_review_ledger() {
    {
        printf '%s\n' '| Screenshot | Locale | Theme | Viewport | State | fixture_source | Geometry | identity_redaction | manual_review | Notes |'
        printf '%s\n' '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
        while IFS= read -r png; do
            local filename="${png##*/}"
            local remainder="${filename#wait-cot__}"
            local state="${remainder%%__*}"
            remainder="${remainder#*__}"
            local viewport="${remainder%%__*}"
            remainder="${remainder#*__}"
            local locale="${remainder%%__*}"
            remainder="${remainder#*__}"
            local theme="${remainder%.png}"
            printf '%s\n' "| \`${filename}\` | ${locale} | ${theme} | ${viewport} | ${state} | tests/visual/chat | n/a-wait-cot | not-needed-synthetic | Pending | Capture complete; manual review pending. |"
        done < <(find "${EVIDENCE_DIR}" -maxdepth 1 -type f -name '*.png' -print | LC_ALL=C sort)
    } >"${LEDGER_PATH}"

    local ledger_rows
    ledger_rows=$(grep -Ec '^\| [^|]*wait-cot__.*[.]png[^|]*\|' "${LEDGER_PATH}")
    test "${ledger_rows}" -eq "${EXPECTED_COUNT}"
}

for state in "${states[@]}"; do
    for viewport in "${viewports[@]}"; do
        read -r width height <<<"${viewport}"
        for locale in "${locales[@]}"; do
            for theme in "${themes[@]}"; do
                capture_fixture "${state}" "${width}" "${height}" "${locale}" "${theme}"
            done
        done
    done
done

EXPECTED_COUNT=$((${#states[@]} * ${#viewports[@]} * ${#locales[@]} * ${#themes[@]}))
png_count=$(find "${EVIDENCE_DIR}" -maxdepth 1 -type f -name '*.png' | wc -l | tr -d ' ')
test "${png_count}" -eq "${EXPECTED_COUNT}"

regenerate_visual_review_ledger

agent-browser --session "${SESSION}" close
trap - EXIT
