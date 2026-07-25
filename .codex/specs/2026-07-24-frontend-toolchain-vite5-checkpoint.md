# Frontend Toolchain Quality Checkpoint

Status: **Local upgrade evidence; not a deployment or remote-CI authorization**

Date recorded: 2026-07-25

Branch: `release/0.1.4`

This checkpoint supersedes the historical Vite 5 diagnostic record. It records
the clean-install result for the current Web toolchain and keeps the boundary
between local evidence and Bot/operations/Expert/production acceptance.

## Environment and installed versions

The checkpoint was run from `apps/web/` after a clean lockfile install:

| Item | Version / result |
| --- | --- |
| Node / npm | `v26.5.0` / `11.17.0` |
| Install | `npm ci`, exit `0` (617 packages added) |
| Vite | `7.3.6` |
| `@vitejs/plugin-vue` / JSX | `6.0.8` / `5.1.6` |
| Vitest / coverage-v8 | `4.1.10` / `4.1.10` |
| Sass | `1.101.7` |
| Vue / Pinia / vue-i18n | `3.5.40` / `4.0.2` / `11.4.7` |
| Vue Router | `5.2.0` |
| Element Plus / vue-element-plus-x | `2.14.3` / `1.3.2` |
| TypeScript / vue-tsc | `6.0.3` / `3.3.8` |
| `@types/node` | `26.1.1` |
| `@vue/test-utils` / happy-dom | `2.4.11` / `20.11.1` |
| ESLint / Prettier | `10.7.0` / `3.9.6` |
| ESLint Vue/TS config | `eslint-plugin-vue 10.10.0`; `@vue/eslint-config-typescript 14.9.0`; `@vue/eslint-config-prettier 10.2.0`; `typescript-eslint 8.60.0` |
| Build helpers | `unplugin-auto-import 21.0.0`; `vite-plugin-compression2 2.5.3`; `npm-run-all2 9.0.2` |

`npm ci` printed existing package-deprecation and npm 11 pending-install-script
advisories. They did not change the exit status and are not counted as Vue,
intlify, Sass, or Vite runtime warnings.

## Vite dependency graph

`npm ls vite --all` exited `0` and resolved one Vite core:

```text
phytomni-web@0.0.0
├─┬ @vitejs/plugin-vue-jsx@5.1.6
│ └── vite@7.3.6 deduped
├─┬ @vitejs/plugin-vue@6.0.8
│ └── vite@7.3.6 deduped
├── vite@7.3.6
├─┬ vitest@4.1.10
│ ├─┬ @vitest/mocker@4.1.10
│ │ └── vite@7.3.6 deduped
│ └── vite@7.3.6 deduped
└─┬ vue-router@5.2.0
  ├─┬ unplugin@3.3.0
  │ └── vite@7.3.6 deduped
  └── vite@7.3.6 deduped
```

The production build remains behind the shell-free warning oracle; the raw
command remains available as `build-only:raw` for diagnosis.

## Required command evidence

Commands run from `apps/web/`:

```bash
npm ci
npm ls vite --all
npm run type-check
npm run lint
npm run format:check
npm run test:warning-oracle
npm run test:run -- --reporter=dot
npm run coverage
npm run build
npm run build-only:raw
```

Results:

- `npm ci`, dependency-tree resolution, type-check, static-analysis lint, and
  Prettier format check: PASS.
- Warning-oracle tests: PASS. The fixture still proves unknown-mode and
  prohibited-warning handling; it does not claim a warning-free test runtime.
- Full Vitest run: **205 files, 2,713 tests passed**.
- Coverage: **90.06% statements, 85.98% branches, 92.21% functions, 94.13%
  lines** (205 files, 2,713 tests).
- `npm run build`: PASS. The wrapper runs type-check and the warning-oracle
  production build.
- `build-only:raw`: PASS; Vite 7.3.6 transformed 2,435 modules in 9.51s.

The raw build retains non-blocking third-party diagnostics: two misplaced
`@vueuse/core` `/* #__PURE__ */` annotations, the existing `3dmol` `eval`
warning, and the chunk-size warning for large generated assets. These are
visible diagnostics, not suppressed failures.

## Warning-family boundary

The historical Vite 5 raw counts (Sass 30, Vue 1,386, intlify 4,395, Pinia
subset 32) remain historical baseline data only. They must not be reused as
current post-upgrade counts, and this checkpoint does not claim that Sass,
intlify, Vue duplicate-registration, or Pinia test-context warnings have been
eliminated. The current warning-oracle contract checks its fixtures and the
production build boundary; test-runtime warning cleanup remains separately
auditable.

## Cross-language verification boundary

`PYTHONPATH=. uv run pytest -q scripts/tests` was run after the clean install.
The suite exposed two fixture-copy tests that iterated a generated
`__pycache__`, plus a TypeScript 6 diagnostic-family change and a separate
configuration-project failure caused by the concurrent unstaged
`apps/web/vitest.config.mts` `thresholdAutoUpdate` edit. The fixture tests now
ignore directories, and the TypeScript 6 expected declaration family has been
re-recorded. The remaining configuration-project failure is intentionally not
changed here because that file is concurrent work and is not ours to commit.

The final cross-language gate therefore remains **pending that concurrent
configuration edit**; no bypass or `--no-verify` path is acceptable.

## Boundary and follow-up

This record establishes a coherent local Vite 7.3.6/Vitest 4.1.10 toolchain and
green frontend type/lint/format/test/coverage/build evidence. It does not claim
Vite 8, warning-free tests, remote CI, Bot/operations activation, Expert
activation, or production deployment. Re-run the Python suite and the full
repository gate after the concurrent Vitest configuration change is resolved.
