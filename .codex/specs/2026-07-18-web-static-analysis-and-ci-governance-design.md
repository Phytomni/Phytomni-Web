# Web Static-Analysis and CI Governance Design

- Status: **approved**
- Date: 2026-07-18
- Repository: Phytomni-Web
- Target branch: `release/0.1.4`

## Decision summary

Phytomni-Web will adopt the same static-analysis governance philosophy and
scope as Phytomni-Bot while using implementation paths appropriate for this
Vue and Go monorepo.

The repository will replace warning-tolerant and independently maintained
quality paths with:

- one deny-by-default, machine-readable exception registry;
- exact finding identities instead of aggregate warning counts;
- a fail-closed checker covering diagnostics and every suppression mechanism;
- shared scoped, full, hook, and CI gate implementations;
- deterministic generated documentation;
- zero unregistered or expired exceptions; and
- zero temporary exceptions before the `release/0.1.4` quality program closes.

Coverage policy is explicitly excluded and will be designed in a separate
specification.

Implementation will happen directly on `release/0.1.4`. This design does not
authorize a push, merge, tag, deployment, production mutation, or change to
Phytomni-Bot or Operations-owned code.

## Evidence baseline

The baseline was measured on 2026-07-18 at Web commit `a40ed43`.

The current ESLint command exits successfully with zero errors while reporting
1,919 warnings across 180 of 404 scanned files:

| Rule                                       | Total | Production `src/` | Tests | Other |
| ------------------------------------------ | ----: | ----------------: | ----: | ----: |
| `prettier/prettier`                        | 1,396 |               667 |   729 |     0 |
| `@typescript-eslint/no-explicit-any`       |   337 |                86 |   249 |     2 |
| `@typescript-eslint/no-non-null-assertion` |   151 |                17 |   134 |     0 |
| `@typescript-eslint/no-unused-vars`        |    35 |                23 |    11 |     1 |

This demonstrates that the current gate checks lint execution but does not
enforce a warning-free or exact-exception contract.

Additional repository observations:

- the frontend contains 191 tracked TypeScript or Vue source files and 184
  Vitest specification files;
- the Go service contains 209 Go files, including 96 test files;
- `.github/workflows/ci.yml` contains one monolithic `validate` job;
- CI runs for pull requests targeting `main` and pushes to `main`, but not for
  direct pushes to `release/**`;
- the tracked pre-commit hook scans secrets only, and there is no tracked
  pre-push hook; and
- `validate_web_local.sh` is already the authoritative full local gate and
  must remain the compatibility entry point.

The sibling Bot repository provides the governance reference through:

- `.codex/specs/2026-07-17-static-analysis-exemption-governance-design.md`;
- `.codex/plans/2026-07-17-static-analysis-exemption-governance-plan.md`;
- `static-analysis-exemptions.toml`;
- `scripts/check_static_analysis_exemptions.py`;
- `scripts/scoped_gate.sh` and `scripts/validate_local.sh`; and
- the generated `docs/development/lint-exemptions.md` ledger.

Web will reproduce the policy properties, not import or execute Bot code.

## Problem statement

The Web repository has substantial tests and several valuable domain-specific
contract gates. Its quality system is nevertheless weaker than the Bot system
in four important ways.

### Warning-tolerant lint

ESLint warnings are informational. A new explicit `any`, non-null assertion,
unused value, or formatting violation can land without making CI fail. A total
warning ceiling would not solve this because one removed warning could be
replaced by a new warning while the aggregate stayed unchanged.

### Narrow and implicit exception authority

Suppressions may exist in source comments, ESLint configuration, TypeScript
configuration, ignore files, shell commands, workflow steps, warning filters,
or future Go lint directives. The native mechanism currently authorizes itself;
there is no separate record proving why the exception is necessary.

### Slow and duplicated feedback

The only canonical gate is full-repository validation. CI runs the entire gate
inside one job, reducing failure attribution and parallelism. The repository
does not provide the Bot-style scoped/full Make targets or a full pre-push
hook.

### Incomplete repository hygiene

The current full gate does not provide Bot-equivalent Shell, workflow,
Markdown, YAML, JSON normalization, enhanced Go static-analysis, or race-test
coverage. Adding these tools without exact exception governance would simply
create another collection of ad hoc ignores.

## Goals

1. Make every static-analysis exception visible, exact, reviewable, and
   machine-enforced.
2. Block all new quality debt immediately after registry cutover.
3. Remove every temporary exception before the quality program closes.
4. Preserve runtime behavior while eliminating unjustified workarounds.
5. Give developers fast scoped feedback and an authoritative full gate.
6. Make local gates, Git hooks, and CI consume the same implementations.
7. Keep generated documentation synchronized with policy.
8. Improve frontend, Go, and repository-file quality without adding runtime
   dependencies.

## Scope

### Included

The registry and checker govern all static-analysis exceptions other than
coverage, including:

- ESLint diagnostics, inline disables, configured rule changes, overrides,
  and ignored paths;
- TypeScript directives and type-checking exclusions;
- Prettier ignore directives and excluded paths;
- Go diagnostics, `//nolint`, `//lint:ignore`, tool configuration, and command
  exclusions;
- ShellCheck, shfmt, actionlint, Markdown, YAML, JSON, formatter, and
  validation exclusions;
- warning filters and test-level suppression decorators;
- source, configuration, script, Git hook, and CI command suppressions;
- secret-scan allowlist markers;
- generated-document drift; and
- future static-analysis tools added to local or CI gates.

The implementation also includes:

- exact governance infrastructure;
- deterministic formatting cleanup;
- current frontend semantic-warning cleanup;
- correctness-oriented type-aware frontend rules;
- enhanced Go static analysis and race testing;
- repository-file linting;
- local scoped/full workflows;
- CI decomposition and trigger expansion; and
- documentation and final historical-risk auditing.

### Excluded

- Coverage thresholds, exclusions, file lists, reports, and per-module policy.
- Browser end-to-end test design.
- Runtime dependency or framework upgrades.
- General supply-chain vulnerability policy.
- Product features, API changes, database changes, auth or authorization
  changes, tenant-boundary changes, production configuration, deployment, and
  Operations code.
- Changes to Phytomni-Bot.
- GitHub branch-protection mutations; repository documentation may describe
  the required external settings, but activation requires separate evidence.
- Push, merge, tag, release, or deployment actions.

## Governing principle: no degradation, no exemption

An exception is not justified because remediation is expensive, inconvenient,
large, unfamiliar, or scheduled later. The applicant must answer this
counterfactual:

> If the ignore, disable, type escape, exclusion, or warning filter is removed
> and a reasonable compliant implementation is used, must the repository's
> overall engineering result become materially worse?

The evaluation covers:

- functional correctness and external-contract fidelity;
- security, privacy, authorization, and tenant isolation;
- reliability, cancellation, concurrency, and resource behavior;
- type fidelity;
- maintainability and future change risk;
- readability and cognitive complexity;
- test truthfulness and independent oracles;
- performance and compatibility; and
- operational observability.

The decision rules are strict:

1. If an equal or better compliant implementation exists, remove the
   exception.
2. If the before and after states are materially equivalent, remove the
   exception.
3. Cost or schedule can justify a bounded temporary migration record, never a
   structural exception.
4. A structural exception is eligible only when all reasonable compliant
   alternatives materially worsen the overall engineering result.
5. The applicant must evaluate reasonable alternatives, not one deliberately
   poor refactor.
6. Existing practice, precedent in another file, or precedent in another
   repository is not evidence of necessity.
7. Fake APIs, meaningless wrappers, broad parameter bags, duplicated state
   threading, swallowed errors, or tautological tests introduced only to
   satisfy a tool are forbidden.

## Counterfactual classifications

Every actual exception has exactly one outcome.

### Structural

Removing the exception necessarily produces a materially worse engineering
result after reasonable alternatives are considered. A structural approval
requires:

- the exact finding, source, target, and fingerprint;
- the reasonable alternatives evaluated;
- concrete degradation caused by each alternative;
- the risk of retaining the exception;
- tests protecting the relevant behavior;
- the narrowest possible authorization target;
- an owner; and
- a review date.

Structural approval occurs in an exception-focused commit after explicit human
approval. Structural status is not permanent; review may later identify a
non-degrading compliant alternative.

### Temporary

The finding is real or necessity has not been proven, but safe removal requires
bounded migration work. A temporary record requires an owner, risk,
remediation identifier, tests, review date, and expiry date.

A temporary record is debt tracking, not exemption approval. It expires no
later than 2026-08-31 or the `release/0.1.4` quality-program closure, whichever
comes first. No temporary entry may survive final acceptance.

### Forbidden

The exception has an equal or better compliant alternative, hides a bug,
weakens a test, swallows an error without a defined degraded contract, creates
a fake interface, broadens future suppression authority, or exists only to
silence a tool. It must be removed rather than approved.

## Registry design

The root registry is:

```text
static-analysis-exemptions.toml
```

It is separate from ESLint, TypeScript, Go, and formatter configuration so tool
configuration cannot authorize itself.

The registry begins with a version and deny-by-default policy:

```toml
schema_version = 1

[policy]
default = "deny"
```

Each record has an immutable ID and an exact target. Required fields include:

- `id`;
- `tool` and normalized `rule`;
- `classification`;
- `mechanism`;
- `target_kind`;
- `path`;
- `symbol`, span, pair endpoint, configuration key, command target, or fixture
  identity as applicable;
- `fingerprint`;
- `owner`;
- `introduced_on` and `review_on`;
- `rationale` and `counterfactual`;
- `risk`; and
- linked `tests`.

Temporary records additionally require `expires_on` and `remediation`.

Supported target kinds are:

- `symbol`: one class, function, method, declaration, or Vue component node;
- `span`: one normalized source span when a stable symbol is unavailable;
- `pair`: two canonical endpoints for a cross-file finding;
- `config`: one exact tool, rule, path, and configuration key/value;
- `command`: one exact hook or workflow command option; and
- `fixture`: one exact intentional warning or security fixture.

Supported mechanisms are `diagnostic`, `inline`, `config`, `command`,
`decorator`, and `marker`.

No record may authorize every rule, an entire source tree, an unbounded path
pattern, a bare directive, or every future occurrence of a rule in a file.
Externally defined vendor or generated surfaces may use a bounded pattern only
when the matched paths and exact allowed rule set are validated.

Counts are informational output only. They never authorize findings.

## Checker architecture

The public entry point is:

```text
scripts/check_static_analysis_exemptions.py
```

The Web-local implementation is divided into testable modules:

```text
scripts/static_analysis/
├── __init__.py
├── model.py
├── fingerprints.py
├── inventory.py
├── report.py
└── collectors/
    ├── __init__.py
    ├── eslint.py
    ├── typescript.py
    ├── go.py
    ├── source.py
    ├── config.py
    ├── ci.py
    └── repository_tools.py
```

ESLint and Vue syntax need a Node-native bridge using the repository's installed
parser stack:

```text
apps/web/scripts/quality/eslint-inventory.mjs
```

Python owns registry loading, collector orchestration, reconciliation,
reporting, and cross-tool failure semantics. The Node bridge emits deterministic
structured findings and never authorizes them.

### Canonical finding model

Every collector emits:

- tool and normalized rule;
- mechanism and target kind;
- path and stable target;
- normalized diagnostic and source context;
- content fingerprint;
- display location;
- tool version; and
- collector evidence.

Actual findings and registry records are reconciled as sets. The checker fails
for an unregistered actual finding, stale registry record, duplicate identity,
duplicate authorization, malformed record, expired temporary record, or
unsupported schema.

### Fingerprints

Fingerprints use SHA-256 over normalized identity and source content.

- Line numbers are display metadata, not identity.
- ESLint diagnostics bind to the nearest stable TypeScript AST or Vue template
  node emitted by the Node bridge.
- TypeScript directives bind to the declaration or expression they suppress.
- Go directives bind to the nearest declaration or normalized source span.
- Configuration findings bind to the exact key/value and rule set.
- Hook and CI findings bind to workflow, job, step, executable, and exact
  option.
- Pair findings canonicalize endpoints before hashing.

Unrelated line insertion must not invalidate an entry. Moving a finding to a
different target, changing the normalized target, expanding its scope,
changing its mechanism, or changing a paired endpoint must invalidate it.

### Collectors

Collectors cover:

1. ESLint structured diagnostics and inline directives.
2. TypeScript directives and relevant configuration exclusions.
3. Go structured diagnostics, directives, and tool configuration.
4. Source-level suppression markers across tracked first-party files.
5. ESLint, TypeScript, Prettier, ignore-file, and repository-tool
   configuration.
6. Git hooks, gate scripts, and GitHub Actions commands.
7. Shell, workflow, Markdown, YAML, JSON, formatter, warning-filter, and
   secret-scan exception mechanisms.

Native tool suppressions are execution mechanisms only. A directive may be
required so the native tool exits cleanly, but the directive remains forbidden
unless the registry authorizes its exact identity.

### Necessity probes

Authorization proves review, not continued necessity. The checker uses the
strongest available reverse test:

- ESLint reports unused disable directives.
- `vue-tsc` detects unused `@ts-expect-error` directives.
- `@ts-ignore` and `@ts-nocheck` are forbidden unless an independently
  approved structural case proves no narrower mechanism exists.
- Configuration-disabled rules are restored against their exact target where
  the tool supports a reliable probe.
- Go directives are checked against live diagnostics.
- Configuration and command exceptions are invalidated by any target change
  and carry review dates when no safe reverse probe exists.

An exception that no longer suppresses a real finding is stale and fails. Its
ID is never reused.

## Fail-closed behavior

The following conditions are fatal:

- required executable missing;
- no tracked input files during a full scan;
- unexpected exit code or status bits;
- malformed, truncated, empty, or mixed-format output;
- unknown rule identifier;
- collector exception;
- missing or unsupported tool-version metadata;
- registered finding disappearing without a registry edit;
- generated ledger drift;
- policy/schema parse failure; and
- a policy path that falls back to success.

The checker must understand each tool's exit semantics. It may not infer success
from empty standard output, and shell wrappers may not use `|| true` to conceal
collector failure.

## Gate architecture

`./scripts/validate_web_local.sh` remains the full compatibility entry point.
Actual commands are factored into composable gate groups used by local, hook,
and CI entry points:

- `hygiene`;
- `frontend-static`;
- `frontend-runtime`;
- `server-static`;
- `server-runtime`; and
- `contracts`.

The default full command runs every group sequentially and retains all existing
G-1 through G17 contracts. Gate refactoring must not silently renumber, remove,
or weaken those contracts.

### Developer entry points

A root `Makefile` exposes:

- `make precommit`: staged-file scope;
- `make scoped`: upstream-to-worktree scope;
- `make prepush`: the same range scope with pre-push semantics;
- `make full`: authoritative full validation; and
- `make push`: a normal push wrapper that retains the pre-push hook.

The tracked hooks become:

- pre-commit: secret scan plus staged scoped gate; and
- pre-push: full gate by default.

An explicit environment variable may select scoped pre-push behavior for local
iteration. Documentation must state that release pushes require the full gate.

### Scoped execution

The scoped gate resolves either staged files or the upstream/merge-base change
region plus untracked, non-ignored files. It partitions paths by file kind.

- TypeScript or Vue changes run changed-file Prettier/ESLint, complete
  `vue-tsc`, repository-wide suppression scanning, and related Vitest tests.
- Go changes run formatting and static analysis plus affected-package tests;
  shared foundation changes expand to the complete Go suite.
- Shell, Markdown, YAML, JSON, and workflow changes run their corresponding
  tools.
- Registry, checker, tool configuration, gate, hook, or workflow changes force
  the complete policy check.
- Relevant domain-contract changes run the corresponding G11-G17 checks.

An empty file set skips explicitly with a reason. It must never be passed to a
tool whose empty argument behavior could scan the entire repository or report a
false success.

Cross-file rules always run at the smallest scope that preserves their full
identity. Scope optimization may not weaken correctness.

## CI architecture

CI runs for:

- every pull request;
- pushes to `main`; and
- pushes to `release/**`.

The workflow uses six parallel jobs matching the shared gate groups. Jobs call
the shared group scripts rather than restating commands. Stable job names make
required-check configuration possible.

CI also provides:

- minimum `contents: read` permissions unless a narrower job requires less;
- per-job timeouts;
- dependency caches;
- concurrency cancellation for superseded branch runs;
- structured test or diagnostic artifacts where they materially aid failure
  analysis; and
- a gate-contract test verifying local/full/CI parity.

The parity contract asserts:

- all gate groups are represented in CI;
- scoped, full, hooks, and CI call the shared checker;
- workflows contain no independent disable, numeric baseline, or fallback
  success path;
- the default full entry point executes the complete group set; and
- local and CI tool options do not drift.

Branch protection, required checks, and CODEOWNERS are external controls. The
repository records the desired settings and requires current external evidence
before claiming they are active.

## Tool policy

### Frontend

- Prettier becomes a standalone format check instead of an ESLint diagnostic.
- ESLint emits structured output to the exact checker.
- Unused suppressions are errors.
- Existing explicit `any`, non-null assertion, and unused-variable debt is
  removed or explicitly approved as structural under the governing principle.
- After current debt reaches zero temporary entries, correctness-oriented
  type-aware rule families are enabled in bounded batches. These include
  Promise handling, invalid await use, Promise condition misuse, and unsafe
  type propagation.
- Purely subjective naming, style, and decomposition rules are not added merely
  to increase rule count.
- Final ESLint output has zero warnings. Necessary structural cases use the
  narrowest registered native mechanism.

### Go server

The existing `gofmt`, `go vet`, `go test`, and `go build` checks remain. The
quality program adds:

- `go mod verify`;
- a pinned `staticcheck` runner; and
- `go test -race ./...` in CI and at the relevant full-gate checkpoint.

Every Go directive, tool exclusion, and command disable is governed by the same
registry.

### Repository files

The repository adopts:

- ShellCheck and shfmt for tracked shell and hook files;
- actionlint for GitHub Actions;
- Prettier plus semantic Markdown checks;
- YAML formatting, parsing, and workflow-semantic checks;
- JSON parsing and deterministic normalization;
- generated-document idempotency; and
- whole-tree plus commit-range secret scanning.

### Dependency constraints

- No runtime dependency is added.
- New development tools are pinned and installed through cacheable runners.
- Bot's proven actionlint and shfmt runner pattern is preferred where it fits.
- Each added tool must document need, alternatives, license, maintenance
  source, install size, CI-time impact, security implications, and rollback.
- Tool upgrades use standalone commits with before/after inventories and
  explicit approval.
- Framework and language-toolchain upgrades are separate work.

## Migration and delivery sequence

The detailed implementation plan will split work into nine delivery groups of
approximately five to ten commits each. The plan must not pad groups with empty
or unrelated commits.

### Group 1: Exact governance engine

Implement registry models, fingerprints, collectors, reconciliation, CLI,
reports, and fail-closed fixture tests. Run the checker in observation mode; do
not change the current gate yet.

### Group 2: Deterministic formatting normalization

Pin the Prettier contract and exact exclusions, then clean the 1,396 current
format findings in domain-sized, format-only commits. Activate standalone
format checking after the tracked first-party scope is clean.

This Web-specific bootstrap avoids generating 1,396 short-lived policy records.
It is permitted only for deterministic formatter output, not semantic lint.

### Group 3: Inventory and gate cutover

Generate and review the remaining exact finding and suppression inventory,
seed bounded temporary entries, generate the ledger, wire scoped/full/CI paths
additively, prove parity and failure handling, then remove legacy warning-tolerant
paths.

### Group 4: Low-risk direct removals

Remove unused variables, stale suppressions, unjustified TypeScript directives,
broad configuration ignores, simple test workarounds, and repository-file
hygiene findings.

### Group 5: Production frontend type governance

Process API DTOs, stores, routing, shared components, chat state, streaming
events, and dynamic agent payloads. Add behavior characterization before each
boundary change. Prefer `unknown`, explicit discriminated contracts, and
runtime validation over `any`.

### Group 6: Frontend test type governance

Introduce narrow typed fixtures, mock builders, and invalid-input helpers.
Remove test `any` without importing production logic to generate expected
values or otherwise making tests tautological.

### Group 7: Type-aware correctness rules

Enable correctness rule families one batch at a time. Inventory each batch,
remove all resulting temporary findings, and preserve asynchronous behavior,
cancellation, and error propagation.

### Group 8: Go and repository-level hardening

Add enhanced Go, Shell, workflow, Markdown, YAML, and JSON tools through pinned
runners. Reconcile their exception mechanisms and remove all temporary
findings.

### Group 9: Structural approval and closure

Audit every structural candidate under the governing principle. Remediate or
approve each exact case, reach zero temporary records, regenerate all derived
documentation, run complete gates and parity checks, and perform the final
historical-risk audit.

## Commit and checkpoint discipline

- Every implementation commit runs `make scoped` immediately before commit.
- Full validation runs at gate cutover, high-risk production type boundaries,
  enhanced Go-tool activation, and final closure rather than after every small
  commit.
- Gate changes, format changes, exception approvals, and behavioral refactors
  remain separate commits.
- Each structural approval is an exception-focused commit after explicit human
  approval.
- Registry edits regenerate and stage the derived ledger in the same commit.
- Each detailed task names exact files, the failing test, implementation
  requirements, commands, expected output, staging paths, and commit template.
- No implementation commit may use a wildcard registry target, numeric
  baseline, broadened ignore, weakened test, swallowed error, or fallback
  success.
- No push, merge, tag, release, or deployment occurs without explicit user
  direction.

## Test strategy

### Registry and model tests

Cover:

- schema versions and unknown keys;
- default-deny policy;
- temporary lifecycle requirements;
- structural requirements;
- duplicate IDs and duplicate authorization;
- malformed fingerprints and targets;
- expired records; and
- forbidden wildcard authority.

### Fingerprint tests

Cover:

- stable identity across unrelated line shifts;
- invalidation after target movement or expansion;
- Vue script and template targets;
- TypeScript directive ownership;
- Go declaration and span ownership;
- configuration key/value changes;
- command-option changes; and
- pair endpoint canonicalization.

### Collector tests

Use deterministic fixtures for:

- registered and unregistered ESLint findings;
- inline, file-level, and configuration suppressions;
- `@ts-expect-error`, `@ts-ignore`, and `@ts-nocheck`;
- Go diagnostics and directives;
- ignore files and generated/vendor boundaries;
- shell, workflow, Markdown, YAML, and JSON exceptions;
- warning filters and secret markers; and
- local and CI command suppressions.

### Failure tests

Prove that tool absence, tool crash, unexpected exit status, empty output,
malformed output, truncated output, unknown rules, collector exceptions, and
version drift fail closed.

At least one test must reproduce the dangerous false-success case where a tool
fails and emits no parseable findings.

### Gate integration tests

Assert that:

- scoped, full, hooks, and CI call the shared checker;
- policy-file changes force a full policy scan;
- cross-file rules retain complete identity;
- empty scopes skip safely;
- all CI jobs map to shared groups;
- the generated ledger is idempotent; and
- legacy baselines and warning-tolerant commands are absent after cutover.

### Behavior characterization

Before semantic lint refactors, lock the relevant behavior, especially:

- auth redaction and navigation;
- per-chat state isolation;
- upload cancellation and transfer progress;
- streaming event order, abort behavior, and degraded outcomes;
- A2UI lifecycle and default-off activation;
- markdown sanitization and citation rendering;
- Go authorization, tenant ownership, audit redaction, task identity, and
  external Bot projection; and
- public HTTP and frontend data-shape compatibility.

### Final historical-risk audit

After all gates pass, scan and adjudicate:

- `TODO` and `FIXME` markers;
- stubs and placeholder success paths;
- skip, xfail, and weakened assertions;
- empty catches and broad swallowed errors;
- fallback-masked failures;
- fake interfaces created for lint; and
- documentation and gate drift.

A green full gate is necessary evidence, not the end of the audit.

## Documentation and ownership

`docs/development/lint-exemptions.md` becomes generated output from the root
registry. It includes policy, exact records, owners, review and expiry dates,
remediation references, linked tests, fingerprints, and informational counts.
It must not be edited as an independent policy source.

The implementation updates:

- developer gate and CI documentation;
- `AGENTS.local.md`, followed by regeneration of local composed `AGENTS.md`;
- `CHANGELOG.md` for the `0.1.4` developer-quality changes; and
- an external-verification checklist for branch protection and required
  checks.

Long-term memory is not updated unless the user explicitly requests it.

## Error handling and rollback

- Gate migration is additive. The existing path remains until the new checker
  and parity tests pass the authoritative full gate.
- Gate hardening, tool installation, deterministic formatting, exception
  approval, and behavior refactoring are separate and independently revertible.
- CI may temporarily return to one job calling the same full gate if sharding
  itself fails; the check scope may not shrink.
- A failed refactor is fixed or reverted. The registry is not widened and an
  expiry is not extended to make it pass.
- Tool-version finding changes use a standalone inventory migration or a
  version rollback.
- Generated documentation can fail the gate but cannot change policy; policy
  originates only in the registry.
- Formatting commits contain no intended behavior change and are verified by
  typecheck, tests, and build at their checkpoint.

## Stop conditions

Stop and report evidence instead of continuing when:

- the active branch is not `release/0.1.4`;
- unrelated tracked edits overlap the current task;
- a collector crashes or produces malformed, empty, or unknown output;
- progress would require a wildcard, count baseline, fallback success, or
  unapproved finding;
- behavior, security, tenant, task, report, or configuration contracts change;
- a focused test, scoped gate, mandatory full gate, or exact checker fails;
- a refactor requires a broad type bag, fake API, swallowed error, weakened
  test, skip, or widened warning filter;
- structural approval is absent or the live fingerprint differs from the
  approved packet;
- temporary work remains at final closure; or
- work would modify Bot, Operations, production, deployment, auth, database,
  or other out-of-scope surfaces.

## Acceptance criteria

1. Prettier reports zero findings over the governed scope.
2. ESLint reports zero warnings; every retained native suppression has one
   approved structural record.
3. `vue-tsc` and the approved type-aware correctness rules pass.
4. Go formatting, module verification, vet, staticcheck, race tests, unit
   tests, and build pass.
5. Shell, workflow, Markdown, YAML, JSON, generated-document, and secret checks
   pass.
6. Every actual exception maps to exactly one registry entry, and every entry
   maps to an actual, still-necessary exception.
7. No stale, wildcard, duplicate, expired, aggregate, or unregistered
   authorization exists.
8. No temporary entry remains.
9. Every structural entry has explicit counterfactual approval under the
   no-degradation principle.
10. Scoped, full, hooks, and CI share one policy and pass parity tests.
11. CI runs on every pull request and pushes to `main` and `release/**`.
12. All existing G-1 through G17 contracts remain active.
13. The generated ledger is current and byte-identical after regeneration.
14. The authoritative `./scripts/validate_web_local.sh` gate passes.
15. The final historical-risk audit contains no unresolved blocker.
16. Developer documentation, `AGENTS.local.md`, generated local agent guidance,
    and `CHANGELOG.md` describe the live workflow.
17. Required external GitHub settings are either verified with current evidence
    or explicitly reported as needing verification.
18. No runtime, API, auth, tenant, database, deployment, Bot, or Operations
    behavior changes as a side effect of lint governance.

## Non-goals

- No arbitrary diagnostic-count target.
- No exemption merely because remediation is expensive or time-consuming.
- No abstraction introduced solely to reduce a lint number.
- No coverage-policy redesign.
- No framework or runtime dependency upgrade.
- No browser E2E or supply-chain program in this specification.
- No external-repository, GitHub-setting, or production mutation.
- No automatic push, merge, release, or deployment.
