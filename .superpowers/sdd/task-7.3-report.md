# Task 7.3 Report — Align the Analyst Demonstration

## Status

**Complete pending human visual/static-output review.** The Analyst route now uses
the shared `AgentDemoShell`, keeps the existing sample question/task ID and bundled
download target, and labels the task/result as static sample output. The exact
commit hash is included in the handoff after the commit is created.

## Implementation

- Replaced the legacy full-viewport Analyst page with `AgentDemoShell` and its
  localized title/subtitle, Back event, question/result slots, and footer note.
- Kept the exact callpeak sample question, task ID
  `4a7715a-996a-22e0-acd5-fb278e7d45b3`, download path, and
  `callpeak_results.zip` filename.
- Added localized static task/result labels and truthful sample-download copy in
  both English and Chinese locale packs.
- Used the approved pale user/assistant message tokens and a single compact result
  download button. Enter-key activation calls the same download action.
- Retained temporary-anchor click and DOM cleanup behavior; no live API,
  task-status polling, byte progress, or completion claim was added.
- Removed the route's duplicate viewport/header/avatar/card presentation styles.

## TDD Evidence

The focused spec was added before the route implementation. The initial RED run
failed because the legacy route had no demo-shell/static-label/download selectors
(`3 tests failed`). After the implementation, the same focused suite passed with
`3/3` tests.

## Commands and Results

| Check | Command | Result |
|---|---|---|
| Focused demo suite | `cd apps/web && npx vitest run tests/component/demo/AnalystAgentDemo.spec.ts tests/component/demo/AgentDemoShell.spec.ts tests/unit/constants/agent-locales.spec.ts` | **PASS** — 3 files, 11 tests |
| TypeScript | `cd apps/web && npm run type-check` | **PASS** — `vue-tsc --noEmit` |
| Scoped lint | `cd apps/web && npx eslint src/views/analyst-agent/index.vue --no-fix` | **PASS** — 0 errors, 0 warnings |
| Diff hygiene | `git diff --check` | **PASS** |

The Vitest process emits existing Vue plugin-registration and Sass legacy-API
warnings from the test setup/toolchain; no test failed and no warning is caused by
the route behavior.

## Human Review / Visual Acceptance

- Verify the static/live distinction and exact download target.
- Verify the sample question, result, and compact download action in both locales at
  canonical desktop/mobile viewports and keyboard activation.

## Files

- `apps/web/src/views/analyst-agent/index.vue`
- `apps/web/tests/component/demo/AnalystAgentDemo.spec.ts`
- `apps/web/src/locales/langs/en-US.ts`
- `apps/web/src/locales/langs/zh-CN.ts`

## Reviewer Fix

- Removed the Analyst route's nested question/result card wrappers and surface
  styles; `AgentDemoShell` now owns the only pale question/result surfaces while
  the semantic `data-test` hooks remain on the slot content.
- Defined the sample question as one exact string and rendered it by interpolation,
  preserving the original opening-brace/quote adjacency and all three OBS paths.
- Strengthened the Analyst spec to assert the complete sample question, the static
  disclosure/task/result contracts, the bundled download path and filename, anchor
  cleanup, keyboard activation, Back navigation, and absence of route card classes.

### Reviewer-Fix Commands and Results

| Check | Command | Result |
|---|---|---|
| Focused reviewer suite | `cd apps/web && npx vitest run tests/component/demo/AnalystAgentDemo.spec.ts tests/component/demo/AgentDemoShell.spec.ts tests/unit/constants/agent-locales.spec.ts` | **PASS** — 3 files, 11 tests |
| TypeScript | `cd apps/web && npm run type-check` | **PASS** — `vue-tsc --noEmit` |
| Scoped lint | `cd apps/web && npx eslint src/views/analyst-agent/index.vue --no-fix` | **PASS** — exit 0 |
| Diff hygiene | `git diff --check` | **PASS** |
