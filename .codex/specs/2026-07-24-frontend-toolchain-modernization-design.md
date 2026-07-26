# Frontend Toolchain Modernization and Warning Elimination Design

Status: **Approved design; source-owned implementation through D8 complete; remote and production acceptance pending** (2026-07-26)

Date: 2026-07-24

Target branch: `release/0.1.4`

## Summary

Modernize the complete `apps/web` development toolchain to a mutually
compatible current-stable stack and remove the recurring Sass, intlify, Vue,
and Vite infrastructure warnings at their source.

The migration will use forward-only diagnostic checkpoints so failures can be
attributed to one toolchain layer at a time. Those checkpoints do not change
the final target: the final dependency set, configuration, tests, and build
output must be the same as a successful direct upgrade to the selected
current-stable versions.

The work must not silence warnings, lower quality gates, retain compatibility
shims, or change application behavior merely to complete the upgrade.

## Verified final implementation state

The source-owned migration through the warning-oracle/runtime gate is complete
on `release/0.1.4`. The supported frontend graph is Vite `8.1.5`, Vitest
`4.1.10`, TypeScript `6.0.3`, vue-tsc `3.3.8`, ESLint `10.7.0`, and Prettier
`3.9.6`, installed with Node `v26.5.0`/npm `11.17.0`. Vite explicitly targets
Chrome/Edge 111, Firefox 114, and Safari 16.4.

`npm ci`, `npm ls --all --json`, guarded build/test/coverage, and the complete
repository gate pass locally. The final Vite build keeps the lazy application
`zh-CN` locale entry and a separate `vue-i18n` chunk. The remaining direct-eval
and large-chunk messages are ordinary third-party/build diagnostics; they are
visible and are not warning-oracle exemptions. G12 coverage remains
90.06% statements, 85.98% branches, 92.21% functions, and 94.13% lines.

TypeScript `7.0.2` is a dependency-specific hard blocker, not a reason to hold
back independent upgrades: the current stable typescript-eslint peer range
rejects it in a clean graph. Retry only after a stable typescript-eslint release
officially supports TypeScript 7 and the complete repository gate passes.
Browser self-review, remote CI, Bot-owner acceptance, staging/live smoke, and
operations sign-off remain separate evidence boundaries; this document does
not claim them complete. The Vitest coverage configuration is now reconciled
with the supported Vitest 4 schema: `autoUpdate: false` is nested under
`coverage.thresholds`, the standalone config project is type-clean, and the
full Python contract suite passes without a bypass.

The latest verified local closure commit is `1e210119`; remote CI,
Bot/operations acceptance, staging/live smoke, and production deployment remain
separate evidence boundaries.

## Context and observed baseline

The following warning stream describes the pre-migration baseline; it is not a
claim about the current final graph. It exposed several independent
toolchain and test-runtime problems:

1. The root frontend build still resolves Vite 3, while the installed Vitest 2
   dependency graph expects a Vite 5 generation. `npm ls vite --all` reports
   the Vite instance consumed by `@vitest/mocker` as invalid.
2. Vite 3 invokes the deprecated Sass legacy JavaScript API. Sass has warned
   about that API since 1.79 and plans to remove it in Sass 2.
3. TypeScript Vite/Vitest configuration is currently loaded through the
   deprecated CommonJS Vite Node API path.
4. `tests/setup.ts` globally installs an i18n instance with empty `en-US` and
   `zh-CN` messages. Components render real translation keys, producing normal
   intlify missing-key and fallback warnings.
5. Individual tests frequently install another i18n, Pinia, or Element Plus
   instance on top of the global setup. Vue consequently reports duplicate
   component and directive registrations.
6. Some component tests omit the Pinia instance required by nested
   components, producing missing-injection warnings.

A representative Vitest run passes its assertions while emitting all four
warning families. Therefore a green test result is currently insufficient
evidence of a clean or internally consistent frontend toolchain.

At the pre-migration baseline the repository already used Node 26 locally and
in CI, while the quality approval packet still recorded Prettier 2.7.1. The
final approval packet now records Prettier 3.9.6 and the Vite 8 matrix above.

## Goals

1. Upgrade the complete frontend build, compiler, lint, formatting, and test
   toolchain to current stable releases selected at implementation time.
2. Reach Vite 8 and its modern browser baseline.
3. Produce a valid, reproducible npm dependency graph with one coherent Vite
   core.
4. Remove Sass legacy API, Vite CommonJS API, intlify missing/fallback, Vue
   duplicate-registration, and Pinia injection warnings from normal test and
   build paths.
5. Preserve warning visibility by failing on unexpected framework and
   infrastructure warnings.
6. Preserve product behavior, quality thresholds, security invariants, and
   existing repository gates.
7. Produce an implementation plan detailed enough for a lower-capability
   development team to execute safely.

## Non-goals

- No Go server behavior or dependency changes.
- No Phytomni-Bot or operations repository changes.
- No production deployment, merge, or push authorization.
- No broad application-library refresh unrelated to toolchain compatibility.
- No UI redesign or intentional product behavior change.
- No coverage-threshold reduction.
- No replacement of real defects with warning filters, stderr redirection,
  `--force`, `--legacy-peer-deps`, permanent npm overrides, broad `any`,
  `@ts-ignore`, or new lint disables.
- No adoption of prerelease Vue, Vite, TypeScript, or related packages merely
  because a prerelease version is newer.

## Constraints and governing decisions

### Upgrade scope

The modernization covers:

- Vite and official Vue/JSX plugins;
- Vitest, its coverage provider, Vue Test Utils, and the DOM test runtime;
- Vue 3, Pinia, vue-i18n, and Element Plus;
- TypeScript and vue-tsc;
- ESLint, Vue/TypeScript ESLint integration, and Prettier;
- Sass and build-related plugins;
- repository-owned Vite plugins and Node-side build/test configuration.

Application dependencies enter scope only when they block the target
toolchain or fail its production build/runtime validation.

### Version policy

- Resolve the exact current stable version matrix at implementation start.
- Use no prereleases.
- Attempt the newest stable release first even when migration work is
  substantial.
- A large diff, test repair effort, lockfile churn, or migration duration is
  not a blocker.
- Fall back only for a documented hard blocker as defined below.
- A stale peer range alone is not sufficient evidence when the stack installs
  cleanly and passes all verification. Conversely, an `npm ci` failure or an
  invalid dependency graph cannot be waived.
- Record exact resolved versions and integrity metadata in the lockfile.
- Use `npm ci` as the authoritative local and CI installation path.

### Runtime support

- Retain Node 26 and the repository's npm 11 baseline.
- Adopt the Vite 8 default browser baseline: Chrome/Edge 111, Firefox 114, and
  Safari 16.4 or newer.
- Document the browser baseline as a repository contract instead of relying
  on an undocumented build-tool default.

## Alternatives considered

| Approach                     | Description                                                              | Advantages                                                                                              | Costs and risks                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Forward diagnostic migration | Use temporary compatible checkpoints, ending on the current-stable stack | Isolates failures, keeps commits reviewable, and is suitable for a lower-capability implementation team | Requires more checkpoints and verification                                                      |
| Direct all-at-once upgrade   | Change every toolchain dependency and configuration together             | Reaches the first full result quickly                                                                   | Intermixes compiler, bundler, test-runtime, and lint regressions; difficult to review and debug |
| Warning-only repair          | Stop on an older Vite generation and suppress or narrowly patch warnings | Smallest immediate diff                                                                                 | Does not meet the modernization goal and creates lasting exemptions                             |

The approved approach is the forward diagnostic migration. Its final state
must be identical to the direct-upgrade destination. Warning-only repair is
not an authorized primary approach.

## Target architecture

### Dependency graph

The final installation must have:

- one coherent Vite core accepted by Vitest and all Vite plugins;
- current stable official Vue Vite plugins;
- mutually compatible Vue, compiler-sfc, vue-tsc, and TypeScript versions;
- mutually compatible ESLint core and Vue/TypeScript integrations;
- no invalid, extraneous, or unexplained duplicate core tool packages;
- no permanent dependency override used to conceal a peer incompatibility.

`package.json` and `package-lock.json` always change together in dependency
commits. The lockfile is reviewed for source, integrity, unexpected packages,
and duplicate core versions.

### ESM boundary

Vite and Vitest configuration, plus repository-owned modules imported directly
by those configurations, will use native ESM.

The preferred boundary is explicit `*.mts` configuration entry points. This
removes the deprecated Vite CommonJS Node API without changing the module
interpretation of unrelated Node scripts. CommonJS-only tool configuration may
remain explicitly named `*.cjs` when that tool's supported configuration model
requires it.

CommonJS globals such as `__dirname` must be replaced with `import.meta.url`
and URL/file-path conversion at the ESM boundary.

### Vite plugin policy

Each existing build plugin must be evaluated against Vite 8 and Rolldown:

1. Upgrade a maintained compatible plugin.
2. If incompatible, select a maintained equivalent after documenting need,
   alternatives, license, maintenance, security, download/install size, and
   build/runtime cost.
3. If the behavior is simple, replace the plugin with a Vite-native or small
   repository-owned implementation.
4. Remove obsolete plugins rather than retaining no-op compatibility packages.

The audit must cover:

- Vue and Vue JSX transforms;
- SVG icon generation;
- auto-import behavior;
- compression output;
- component-name/setup extension behavior;
- PostCSS processing;
- manual chunking and lazy chunks;
- aliases and asset paths;
- dev proxy behavior, including the chat/SSE route.

## Migration architecture

### Checkpoint 1: reproducible baseline

- Start from a clean worktree.
- Run `npm ci`.
- Capture `npm ls`, tool versions, static checks, tests, coverage, build output,
  warning output, and representative bundle metadata.
- Record the exact commands and distinguish pre-existing output from new
  regressions.

### Checkpoint 2: valid Vite/Vitest baseline

- Align the existing Vitest generation with a compatible Vite 5.4 checkpoint.
- Convert Vite/Vitest configuration entry points to ESM.
- Enable the modern Sass API explicitly only at this checkpoint to verify the
  source of the legacy API warning.
- Prove that the dependency graph is valid and relevant tests/builds still
  work.

This checkpoint is diagnostic. It is not a supported release target.

### Checkpoint 3: Vue and compiler ecosystem

- Upgrade Vue, Pinia, vue-i18n, and Element Plus.
- Upgrade TypeScript and vue-tsc.
- Resolve actual type errors and removed APIs.
- Do not reduce compiler strictness or add broad suppressions.
- Verify locale lazy loading, Element Plus runtime locale switching, Pinia
  stores, router guards, and SFC compilation.

### Checkpoint 4: test and quality ecosystem

- Upgrade Vitest, coverage tooling, Vue Test Utils, and the DOM test runtime.
- Upgrade ESLint and its Vue/TypeScript integrations.
- Upgrade Prettier and migrate supported configuration formats.
- Preserve or strengthen every existing lint and coverage contract.
- Update the quality-toolchain approval packet so it no longer claims that
  Prettier 2.7.1 is the active baseline.

### Checkpoint 5: Rolldown compatibility

- Use the official Rolldown compatibility path before final Vite 8 adoption.
- Exercise every repository-owned and third-party Vite plugin.
- Resolve plugin-hook, chunking, asset, CSS, and proxy differences while the
  source of each failure remains isolated.

This is also diagnostic and must not become a supported release target.

### Checkpoint 6: final Vite 8 state

- Upgrade to Vite 8 and matching official plugins.
- Remove intermediate aliases, compatibility packages, explicit transitional
  Sass options, and diagnostic-only configuration.
- Regenerate and audit the final lockfile.
- Re-run the complete validation and browser matrix.

## Warning-free test runtime

### Problem with the current global setup

A stateful i18n instance with empty messages and a global Element Plus install
make every mount inherit incomplete production services. Tests that install
their own services then create duplicate application plugins. This setup
simultaneously hides dependency intent and generates false warning noise.

### New setup boundary

`tests/setup.ts` will contain only stateless environment facilities:

- DOM/browser API polyfills;
- deterministic environment defaults;
- shared mock cleanup;
- non-application test lifecycle cleanup.

It will not install i18n, Pinia, Element Plus, or Router.

### Test application-context factory

Add a shared test helper such as `createTestAppContext` and/or `mountWithApp`.
It must:

- create a fresh Pinia per test;
- create exactly one i18n instance per test application;
- install Element Plus at most once and only when requested;
- create a memory router when requested;
- set the active Pinia consistently for direct store access and mounted
  components;
- return the wrapper and created services to the caller;
- accept explicit locale, router, initial-store, mount, slot, stub, and provide
  options without allowing duplicate core plugins.

The helper will use real `createPinia()` instead of adding
`@pinia/testing`. This keeps production semantics and avoids a new dependency.

The default test i18n instance statically loads the complete real `en-US` and
`zh-CN` message packs. Static loading is test-only; production keeps its
existing lazy zh-CN pack. `missingWarn` and `fallbackWarn` remain enabled so
real key defects are visible.

Tests with specialized plugin-installation behavior may mount directly, but
must own a complete isolated application context and must not depend on
stateful global setup.

### Expected negative-path warnings

If a test intentionally verifies warning behavior, it must:

1. install a local spy immediately before the expected call;
2. capture the exact warning;
3. assert message/category and call count;
4. restore the console method in cleanup;
5. prevent the expected warning from escaping into suite output.

This is an assertion of a deliberate side effect, not an allowlist. There will
be no global warning suppression.

## Warning regression oracle

Vitest-internal hooks alone cannot observe every Vite startup or Sass compiler
warning. Add a small Node ESM command runner around the real build/test
commands.

The runner must:

- spawn the known local command without a shell;
- stream stdout and stderr unchanged to the parent process;
- retain bounded output for warning analysis;
- propagate the child exit code;
- fail after an otherwise successful command if it observes:
  - a Vue framework warning;
  - an intlify warning;
  - a Sass deprecation warning;
  - a Vite deprecation or CommonJS API warning;
- avoid matching ordinary application messages merely because they contain the
  word "warning";
- contain no warning allowlist;
- print the matched category and concise evidence when it fails.

Use the oracle for the real test, coverage, and production-build paths. The
repository gate must therefore exercise the same behavior locally and in CI.

Add focused tests for:

- clean output and zero exit;
- each prohibited warning category;
- child-process failure propagation;
- ordinary business output that must not be misclassified;
- output chunk boundaries so a warning split across chunks is still detected;
- bounded buffering on large output.

## Verification strategy

### Dependency and supply chain

- Clean `npm ci`.
- Record exact Node, npm, and direct tool versions.
- `npm ls` with no invalid or extraneous dependency.
- Review lockfile source and integrity changes.
- Compare license and security-audit results against the baseline.
- Do not introduce an unexplained new high/critical issue.

### Static checks

- `npm run type-check`
- full non-mutating ESLint invocation;
- formatting checks;
- repository ignore/disable governance checks;
- no new TypeScript, lint, or warning suppressions.

### Tests and coverage

- `npm run test:run`
- `npm run coverage`
- all existing coverage thresholds retained;
- warning oracle clean on both paths;
- focused tests for the new test context and warning oracle.

### Build and repository gate

- `npm run build`
- warning oracle clean on the production build;
- compare entry points, asset paths, lazy locale chunks, compression output,
  manual chunks, workers/WASM if present, and total bundle characteristics;
- run `./scripts/validate_web_local.sh`;
- keep the Go side unchanged while proving the repository-wide contract remains
  green.

Chunk names or boundaries may change under Rolldown. They are acceptable only
when lazy loading, caching intent, runtime loading, and bundle duplication
remain correct and there is no unexplained material size regression.

### Browser smoke matrix

Validate the production preview rather than relying only on the development
server.

Use `agent-browser` with sanitized local fixtures to check:

- login;
- terms and privacy routes and their independent scroll roots;
- language switching and lazy zh-CN loading;
- theme switching;
- base route navigation and guards;
- a safely simulated Chat shell;
- static assets and dynamic imports;
- browser console framework/runtime warnings and asset-load failures.

Do not contact production services or use real accounts, cookies, biological
data, or credentials. The executing agent must inspect every screenshot before
offering it for human visual review.

## Hard-blocker policy

A hard blocker exists only when all of the following are true:

1. A minimal reproduction demonstrates the failure on a clean installation.
2. The newest stable package combination still reproduces it.
3. Official migration and support documentation has been checked.
4. Project-code migration has been attempted.
5. Maintained plugin upgrades or replacements have been evaluated.
6. A native Vite implementation has been evaluated when the affected behavior
   is simple enough.
7. The unresolved failure prevents a required production behavior, a valid
   install, or a mandatory gate.

Diff size, time, test repair effort, lockfile churn, changed diagnostics, or
undocumented but working peer support are not hard blockers.

When a hard blocker is proven, record:

- the exact package/version combination;
- the minimal reproduction and command;
- the complete relevant error;
- the required behavior it prevents;
- alternatives attempted and why they fail;
- the selected highest compatible stable version;
- an upstream issue or other retry trigger.

Fallback is dependency-specific. A TypeScript blocker may pin only the
TypeScript/vue-tsc group; it does not authorize abandoning a verified Vite 8 or
Vitest upgrade. A Vite 8 blocker may select the highest verified stable Vite
generation while preserving all independent upgrades.

## Rollback strategy

- Keep each dependency and configuration commit installable and internally
  coherent.
- Commit `package.json` and `package-lock.json` together.
- Revert the smallest related commit when a checkpoint regresses.
- Do not use destructive reset/clean operations.
- Do not publish or deploy intermediate Vite generations.
- Do not retain a failed experiment as an undocumented compatibility shim.
- Do not push until the complete local gate and browser review pass and the
  user separately authorizes push.

## Documentation impact

Update only documents whose operational contract changes:

- frontend Node/npm/browser support matrix;
- frontend setup and gate commands;
- `CHANGELOG.md`;
- the active 0.1.4 upgrade/deployment documentation when operator behavior
  changes;
- the quality-toolchain approval packet, including the new Prettier version and
  evidence;
- generated agent guidance only through its documented source and compose
  process if commands or invariants change.

Do not add local execution labels to collaborator-facing commit messages,
release notes, or pull request text.

## Risk analysis

| Risk                                    | Consequence                                       | Mitigation                                                                   |
| --------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------- |
| Rolldown plugin incompatibility         | Broken build hooks, asset generation, or chunking | Isolated compatibility checkpoint and per-plugin audit                       |
| TypeScript/compiler API change          | New diagnostics or SFC type failures              | Upgrade compiler group coherently and fix source errors without suppressions |
| ESLint configuration migration          | Rules silently stop applying or widen scope       | Compare resolved config and known-rule fixtures before and after             |
| Test-helper migration changes semantics | False positives, state leakage, or over-stubbing  | Fresh real services per mount and focused helper contract tests              |
| Real locale packs increase test work    | Slower tests or hidden shared state               | Fresh i18n instance per test and measured runtime comparison                 |
| Warning oracle overmatches              | Valid negative-path tests fail                    | Capture expected warnings locally and test category-specific matching        |
| Warning oracle undermatches             | Infrastructure warnings return unnoticed          | Test startup/build patterns and chunk-split output                           |
| Lockfile expansion                      | Supply-chain or install-cost regression           | Lockfile, license, size, integrity, and security review                      |
| Build-output changes                    | Lazy-load or caching regression                   | Production preview and bundle comparison                                     |

## Acceptance criteria

The modernization is complete only when:

1. The selected current-stable version matrix is documented.
2. `npm ci` succeeds without force, legacy peer handling, or invalid packages.
3. Vite 8 is active unless a fully documented hard blocker proves otherwise.
4. Vite/Vitest configuration uses the approved ESM boundary.
5. The Sass legacy API and Vite CommonJS API warnings are absent.
6. Normal tests emit no Vue or intlify framework warnings.
7. Expected warning behavior is locally captured and asserted.
8. The warning oracle is tested and active for test, coverage, and build.
9. Type checking, lint, formatting, tests, coverage, build, and the complete
   repository gate pass without weakened rules or thresholds.
10. Production-preview browser smoke passes with no new console/runtime error.
11. Dependency, support-matrix, quality-approval, changelog, and applicable
    upgrade documentation reflects the final state.
12. No unrelated product, Go server, Bot, operations, or production
    configuration change is included.

## Implementation-plan requirements

The follow-on implementation plan must:

- divide work into dependency-ordered phases of approximately 5-10 commits;
- name exact files and commands for every task;
- identify the expected failing observation before each corrective change;
- specify tests added or changed before production/configuration changes where
  practical;
- give each commit an independently verifiable acceptance condition;
- include rollback and hard-blocker evidence templates;
- preserve English-only collaborator-facing commit messages;
- end with the full gate, browser self-review, documentation reconciliation,
  user-authorized push, and remote CI verification as distinct boundaries.

## Primary references

- [Vite 8 announcement](https://vite.dev/blog/announcing-vite8)
- [Vite migration guide](https://vite.dev/guide/migration.html)
- [Sass legacy JavaScript API migration](https://sass-lang.com/documentation/breaking-changes/legacy-js-api/)
- [Vue Test Utils API and global configuration](https://test-utils.vuejs.org/api/)
- [Pinia component testing guidance](https://pinia.vuejs.org/cookbook/testing.html)
- [Vue I18n fallback behavior](https://vue-i18n.intlify.dev/guide/essentials/fallback)
- [Vitest migration guide](https://vitest.dev/guide/migration.html)
