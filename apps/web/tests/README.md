# apps/web tests

## Run

```bash
npm run test       # watch mode
npm run test:run   # one-shot, for CI/gate
npm run test:ui    # vitest --ui, view in browser
npm run coverage   # run + threshold check + HTML report
```

## Layout

```
tests/
├── setup.ts                  # global stubs (i18n / pinia / element-plus / localStorage + cookies reset)
├── unit/
│   ├── utils/                # pure func unit tests
│   └── api/                  # API client unit tests (axios mock)
└── component/                # Vue component mount tests (@vue/test-utils)
```

## Coverage policy

The current `vitest.config.ts` `coverage.include` lists 3 fully-tested files: `src/utils/auth-redirect.ts` / `src/utils/auth.ts` / `src/components/LangSwitch.vue`. Thresholds: lines/functions/statements 80%, branches 75%.

`src/api/chat.ts` has a spec file and runs (covering `getReactionType`), but is **not in coverage.include** — the file contains ~35 thin axios wrappers, and full coverage would force writing 30+ repetitive assertion templates. Once the reaction/collect test family grows (after TW-D10 / TW-D8 land), promote chat.ts into include.

**Ramp plan:**
- When adding new tests: if the new tests fully cover a new source file, expand `coverage.include` (list the newly covered files in the PR description)
- Trigger condition for promoting chat.ts into include: reaction / collect / chat lifecycle test family reaches ≥ 5 cases
- After 5-8 batches, try switching to `src/utils/**` full glob, keep thresholds at 80%
- After 10+ batches, expand to `src/api/**` + `src/components/**`
- Final goal: `src/**/*.{ts,vue}` all at 80%

## Adding a test

1. Decide the test type: pure func / DOM / Vue component / API mock
2. Place it under `tests/unit/<category>/` or `tests/component/`
3. File name `<source-basename>.spec.ts` (mirroring the src/ path)
4. If the new test covers a new source file, expand `vitest.config.ts` `coverage.include`
5. Run `npm run coverage` locally to confirm it passes and thresholds are met
