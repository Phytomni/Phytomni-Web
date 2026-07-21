# Contributing to Phytomni-Web

Thanks for your interest in contributing. This guide covers setup, the local
validation gate, testing conventions, the commit convention, and the dependency
policy. It intentionally does **not** duplicate the [README](README.md)
(build/run) or the architecture and invariant detail in the repo-root
`CLAUDE.md` — it links to them instead.

## Repository shape

A polyglot monorepo with **two independently-runnable subprojects** and no
top-level build. Always `cd` into the subproject first.

| Path           | Stack                                    | Role                             |
| -------------- | ---------------------------------------- | -------------------------------- |
| `apps/web/`    | Vue 3 + Vite + TypeScript + Element Plus | Frontend SPA                     |
| `apps/server/` | Go 1.23 + Gin + GORM (MySQL) + Viper     | Business API + chat relay to Bot |

## Setup

**`apps/server` (Go gateway):**

```bash
cd apps/server
go mod tidy
cp config/app.yml.example config/app.yml   # fill in real values before first run
go run main.go                             # serve (default action) — :8080
```

**`apps/web` (frontend):**

```bash
cd apps/web
npm install
npm run dev                                # Vite dev server (uses .env.dev)
```

See the [README](README.md) for ports, the dev proxy, and troubleshooting.

## The local gate

Use the entrypoint that matches the scope of the change. The full gate remains
the CI-equivalent release check; staged and range-scoped gates are intended for
fast local feedback:

```bash
./scripts/install_git_hooks.sh   # first-time: install the pre-commit hook
make precommit                    # staged index; used by pre-commit
make scoped                       # changed range; local iteration
make prepush                      # changed range; explicit pre-push opt-in
make full                         # complete repository gate
make push                         # git push wrapper; hooks still run
```

The hooks are fail-closed. `pre-commit` scans staged files for secrets and
then runs `make precommit`. `pre-push` runs `make full` by default; setting
`PHYTOMNI_SCOPED_GATE=1` explicitly opts into `make prepush`, and any other
value is rejected. The direct equivalent of `make full` is
`./scripts/validate_web_local.sh`.

These local checks cover the repository-owned gates. They do not prove
external GitHub required checks, branch-protection policy, CODEOWNERS review,
Bot-owner acceptance, staging/live smoke evidence, or operations sign-off.
This quality-toolchain work does not modify Bot, operations, or deployment
code.

`validate_web_local.sh` runs these G-checks (no G8–G10; the numbering is
historical):

| Check  | What it enforces                                                       |
| ------ | ---------------------------------------------------------------------- |
| `G-1`  | staged/unstaged secret scan                                            |
| `G0`   | `git diff` whitespace check                                            |
| `G-0`  | exact static-analysis registry and ledger reconciliation               |
| `G1`   | `apps/web` TypeScript diagnostics through exact reconciliation         |
| `G2`   | `apps/web` ESLint diagnostics through exact reconciliation (read-only) |
| `G3`   | `apps/web` vite build                                                  |
| `G4`   | `apps/server` `go mod tidy`                                            |
| `G5`   | `apps/server` `gofmt -l` (must be empty)                               |
| `G6`   | `apps/server` `go vet`                                                 |
| `G7`   | `apps/server` `go build`                                               |
| `G7.5` | `apps/server` `go test ./...`                                          |
| `G11`  | `apps/web` `SET_LOGIN_STATUS` invariant                                |
| `G12`  | `apps/web` vitest run + coverage threshold                             |
| `G13`  | i18n hardcoded-copy scanner (strict mode)                              |
| `G14`  | frontend visual contract and modality evidence                         |
| `G15`  | A2UI activation-readiness contract                                     |
| `G16`  | Bot/Web compatibility contract                                         |
| `G17`  | activation evidence and external-acceptance boundary                   |

> **Frontend lint commands are explicit:** `npm run lint` performs the exact
> read-only ESLint reconciliation; `npm run lint:raw` emits diagnostic JSON only;
> `npm run format:write` is the only broad formatter write command.

G15–G17 are local readiness checks. They do not authorize a production flag
change or replace Bot-owner, CI, staging/live, or operations acceptance.

## Testing

- **`apps/web`** uses **vitest**. `npm run coverage` is the enforcing gate (G12);
  a green `npm run test:run` does **not** enforce thresholds. Name specs
  `*.spec.ts` / `*.test.ts` next to the covered module.
- **`apps/server`** uses `go test ./...` (gated as G7.5). Name tests `*_test.go`.
  DB tests run on **in-memory SQLite**, never MySQL — open `glebarez/sqlite` and
  hand-write a minimal `CREATE TABLE` (do **not** `AutoMigrate` the GORM models;
  their `type:enum` tags break SQLite AutoMigrate). Mirror the `setupTestDB`
  helpers already in `service/api_service/`.

## Commit convention

Subjects follow the `<emoji> Category: Capitalized imperative` form with a
**required** `- ` bullet body (first bullet = the gap/why, then what the change
does). English only; **no** `Co-Authored-By` trailer; **no** local plan/phase
tokens in commit messages or source.

```text
📝 Docs: Add contributing, security, and style guides

- The team-level conventions lived only in the gitignored CLAUDE.md, so
  contributors and CI could not see them.
- Extract the shareable subset into tracked CONTRIBUTING/SECURITY/STYLE files.
```

Common categories: `✨ Add`, `🐛 Fix`, `📝 Docs`, `🧪 Tests`, `♻️ Reorg`,
`🎨 Style`. See [STYLE.md](STYLE.md) for the full vocabulary and the
single-language policy, and the [CHANGELOG](CHANGELOG.md) for how releases are
grouped.

## Pull requests

Describe the changed area, list the verification commands you ran, link issues,
and attach screenshots for UI changes. A local `validate_web_local.sh` pass is a
likely-green CI.

## Dependency policy

Before adding a dependency, explain in the PR why it is needed, whether an
existing alternative exists, its license, maintenance activity, security risk,
and its size/performance impact. Do not add large dependencies casually.

## Security-sensitive changes

Auth, permissions, user-data read/write, DB schema, audit logging, and external
integrations are high-risk. The standing security invariants live in the
repo-root `CLAUDE.md` and are summarized publicly in [SECURITY.md](SECURITY.md);
keep them green and never weaken a test to pass the gate. Report vulnerabilities
privately per [SECURITY.md](SECURITY.md), not as a public issue.
