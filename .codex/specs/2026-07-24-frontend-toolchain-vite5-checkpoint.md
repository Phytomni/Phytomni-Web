# Frontend Toolchain Vite 5 Diagnostic Checkpoint

Status: **Diagnostic only — not releasable**

Date recorded: 2026-07-25

Branch: `release/0.1.4`

This document is a reproducible evidence boundary for the temporary Vite 5
toolchain. It proves that the dependency graph and production build are
internally coherent before the framework/compiler/test-runtime work in later
tasks. It is not a supported release target and must not be used to authorize
deployment.

## Environment and installation

The checkpoint was run from `apps/web/` after a clean lockfile install:

| Item | Value |
| --- | --- |
| Node | `v26.5.0` |
| npm | `11.17.0` |
| Install command | `npm ci` |
| Install result | exit `0`; 602 packages added |
| Vite | `5.4.21` |
| `@vitejs/plugin-vue` | `6.0.8` |
| `@vitejs/plugin-vue-jsx` | `5.1.6` |
| Vitest | `2.1.9` |
| `@vitest/coverage-v8` | `2.1.9` |
| Sass | `1.101.7` |
| Vue | `3.5.18` |
| Pinia | `2.0.18` |
| vue-i18n | `9.14.4` |
| Element Plus | `2.10.1` |
| TypeScript | `4.7.4` |
| vue-tsc | `0.39.5` |
| `@types/node` | `20.19.31` |
| `@vue/test-utils` | `2.4.10` |
| happy-dom | `15.11.7` |
| ESLint | `8.22.0` |
| Prettier | `2.7.1` |
| `unplugin-auto-import` | `21.0.0` |
| `vite-plugin-compression2` | `2.5.3` |
| `npm-run-all2` | `9.0.2` |

`npm ci` printed package deprecation and npm 11 pending-install-script
advisories for the existing graph. They did not change the exit status and are
not counted as Vue, intlify, Sass, or Vite runtime warnings in this
checkpoint.

## Vite dependency graph

`npm ls vite --all` exited `0` and resolved one coherent Vite core:

```text
phytomni-web@0.0.0
├─┬ @vitejs/plugin-vue-jsx@5.1.6
│ └── vite@5.4.21 deduped
├─┬ @vitejs/plugin-vue@6.0.8
│ └── vite@5.4.21 deduped
├── vite@5.4.21
└─┬ vitest@2.1.9
  ├─┬ @vitest/mocker@2.1.9
  │ └── vite@5.4.21 deduped
  ├─┬ vite-node@2.1.9
  │ └── vite@5.4.21 deduped
  └── vite@5.4.21 deduped
```

The Vite configuration explicitly selects `css.preprocessorOptions.scss.api:
"modern"`. The production build remains behind the shell-free warning oracle;
the raw command is retained as `build-only:raw` for diagnosis only.

## Required command evidence

All commands below exited `0` unless a result is explicitly described
otherwise.

```bash
cd apps/web
npm ci
npm ls vite --all
npm run type-check
npm run lint
npm run format:check
npm run test:warning-oracle
npm run test:run -- --reporter=dot
npm run coverage
npm run build
cd ../..
python3 -m pytest -q \
  scripts/tests/test_vite_config_contract.py \
  scripts/tests/test_prettier_contract.py \
  scripts/tests/test_eslint_policy.py
```

Results:

- `vue-tsc --noEmit`: PASS.
- Static-analysis lint reconciliation: PASS; 0 findings, 0 unregistered, 0
  stale, 0 duplicate, and 0 expired entries.
- Prettier: PASS; all matched files use the configured style. Node printed an
  unrelated experimental `localStorage` warning because no
  `--localstorage-file` was supplied.
- Warning-oracle tests: PASS, 11/11. The expected unknown-mode probe returned
  exit `64`; the prohibited-warning fixture returned exit `86`.
- Full Vitest run: 205 files passed and 2,709 tests passed.
- Coverage: 205 files passed and 2,709 tests passed; statements `94.18%`,
  branches `86.94%`, functions `96.87%`, and lines `94.18%`.
- `npm run build`: PASS. The parallel type-check and production build both
  completed; Vite transformed 2,240 modules.
- The three Python contract suites: PASS.

## Warning-family checkpoint

The following are raw line-occurrence counts from the full Vitest output and
are intentionally retained as baseline evidence for the later framework/test
runtime cleanup. Counts are not unique-warning counts; the 32 missing-Pinia
injection lines are also included in the 1,386 Vue-warning lines.

| Family | Occurrences | Vite 5 checkpoint interpretation |
| --- | ---: | --- |
| Sass legacy JS API (`DEPRECATION WARNING [legacy-js-api]`) | 30 | Still present on the Vitest path; not suppressed |
| Vue warnings (`[Vue warn]`) | 1,386 | Includes 1,281 duplicate-registration lines and 32 missing-Pinia injection lines |
| intlify missing/fallback (`[intlify]`) | 4,395 | Still present on the Vitest path; not suppressed |
| Pinia injection subset | 32 | First-party test-context cleanup remains later work |
| Vite CJS Node API warning | 0 | Cleared by the native ESM config boundary |

The warning oracle is intentionally applied only to the production build at
this checkpoint. Test and coverage commands remain visible and green while
the known Vue/intlify/Pinia/Sass test-runtime warnings are repaired in later
tasks.

## Build artifact evidence

The default production build (`npm run build`) produced 185 files:

| Artifact | Count | Bytes |
| --- | ---: | ---: |
| JavaScript | 65 | 2,720,873 |
| CSS | 44 | 596,703 |
| HTML | 1 | 5,588 |
| Total files | 185 | (including fonts and other static assets) |

The compression plugin is opt-in through `VITE_BUILD_COMPRESS`. The explicit
verification command below exercised both configured formats without deleting
the originals:

```bash
VITE_BUILD_COMPRESS=gzip,brotli npm run build-only
```

That build also exited `0` and produced 405 files in total: the same 65
JavaScript, 44 CSS, and 1 HTML originals, plus 110 `.gz` files (977,152 bytes)
and 110 `.br` files (819,806 bytes). The default build therefore has no
compressed files, while the explicit compression path proves both formats are
available.

The build kept non-framework diagnostics visible: the existing 3dmol `eval`
warning and Vite's chunk-size warning were printed. The warning oracle found
zero prohibited Sass, Vue, intlify, or Vite-CJS categories in both production
build logs.

## Boundary and follow-up

This checkpoint establishes a valid Vite 5.4 graph and a clean production
warning boundary. It does **not** establish a releasable toolchain because the
test runtime still emits the characterized Sass/intlify/Vue/Pinia warnings and
the direct dependencies remain intermediate versions. Later tasks must remove
those warning sources, upgrade the framework/compiler/test/quality ecosystem,
and re-run the final Vite 8 gate before any release decision.
