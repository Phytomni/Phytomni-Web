# Phytomni-Web documentation

Repo-level documentation for the Phytomni-Web monorepo. Subproject-internal docs
live with their code (see [Where docs live](#where-docs-live) below).

## What is this repo?

A polyglot monorepo with **two independently-runnable subprojects** — there is no
top-level build:

| Path           | Stack                                            | Port                   | Role                                                |
| -------------- | ------------------------------------------------ | ---------------------- | --------------------------------------------------- |
| `apps/web/`    | Vue 3 + Vite + TypeScript + Element Plus + Pinia | Vite dev (`VITE_PORT`) | Frontend SPA                                        |
| `apps/server/` | Go 1.23 + Gin + GORM (MySQL) + Viper             | 8080                   | Business/data API (`/api/v1/*`) + chat relay to Bot |

The frontend talks to a single backend — the Go service on 8080 — which fronts
both the business API and a chat-orchestration relay to the sibling **Phytomni-Bot**
service. The Go service is the sole MySQL writer (`phytomni` database). See the
root [`README.md`](../README.md) for build/run instructions.

## Documentation map

| I want to…                                          | Read                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Deploy / upgrade production**                     | [`deployment/README.md`](deployment/README.md) — routes by version                   |
| **Upgrade a `0.1.2` prod to `0.1.3`** (current)     | [`deployment/upgrading.md`](deployment/upgrading.md)                                 |
| See the full release history                        | [`../CHANGELOG.md`](../CHANGELOG.md)                                                 |
| Look up a Go API endpoint                           | [`../apps/server/API_DOC.md`](../apps/server/API_DOC.md)                             |
| Understand the parallel-chat frontend state model   | [`../apps/web/docs/parallel-chat-state.md`](../apps/web/docs/parallel-chat-state.md) |
| Run / write frontend tests                          | [`../apps/web/tests/README.md`](../apps/web/tests/README.md)                         |
| Maintain the frontend visual system / run visual QA | [`frontend-design-system.md`](frontend-design-system.md)                             |
| Review proposed development quality tools           | [`development/quality-toolchain.md`](development/quality-toolchain.md)               |
| Read a design proposal / ADR                        | [`design/`](design/) — forward-looking, not-yet-implemented work                     |

## Where docs live

This repo places docs by **scope**, not by author:

- **`docs/`** (here) — repo-level, cross-subproject: deployment/ops (which touch
  frontend + backend + DB + nginx together), forward-looking design/ADRs
  ([`design/`](design/)), and this index.
- **`apps/server/`** — Go-API-specific: [`API_DOC.md`](../apps/server/API_DOC.md).
  The Go service has no README; the repo-root `CLAUDE.md` / `AGENTS.md` is its
  primary contributor doc.
- **`apps/web/`** — frontend-specific: [`README.md`](../apps/web/README.md),
  [`docs/parallel-chat-state.md`](../apps/web/docs/parallel-chat-state.md),
  [`docs/pages.md`](../apps/web/docs/pages.md),
  [`tests/README.md`](../apps/web/tests/README.md) — co-located with the code
  they describe.

**Rule of thumb for new docs:** if it spans both subprojects (or is ops-facing),
put it under `docs/`. If it describes one subproject's internals, co-locate it
with that subproject.
