# Phytomni Web — deployment & operations docs

Start here. Docs are organized by **concern × lifecycle**, not by migration event.

## Which document do I read?

| I want to…                                                        | Read                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Upgrade production to the current release**                     | **[`upgrading.md`](upgrading.md)** — the active upgrade runbook (now `0.1.2`→`0.1.3`) |
| Look up what an `app.yml` / env key does                          | [`configuration.md`](configuration.md) — full current-state reference                 |
| Mint/rotate the Bot key, flip a dark-launch flag, handle Bot-down | [`operations.md`](operations.md) — recurring operational procedures                   |
| Roll back a past migration / rebuild from scratch                 | [`history/`](history/) — frozen point-in-time cutovers                                |
| See the full release history                                      | [`../../CHANGELOG.md`](../../CHANGELOG.md)                                            |

## The four categories (and their boundaries)

Each doc has one job. If you're adding docs, keep these lines sharp:

- **`upgrading.md`** — the **active** upgrade: only the _delta_ for the current
  release jump. Config details defer to `configuration.md`. When a new release
  ships, its delta lands here and the previous jump is archived to `history/`.
- **`configuration.md`** — **evergreen**: what every `app.yml`/env key does, at
  the current release. The single source of truth for config; no steps.
- **`operations.md`** — **evergreen**: recurring operational actions not bound to
  a version — Bot key rotation, dark-launch activation gates, degraded mode,
  rollback conventions.
- **`history/`** — **frozen**: each file is a completed point-in-time cutover,
  kept as a rollback reference. Never edited except to correct a factual error.

```
deployment/
  README.md          ← you are here
  upgrading.md       ← active upgrade (0.1.2 → 0.1.3)
  configuration.md   ← evergreen config reference
  operations.md      ← evergreen Bot/ops procedures
  history/
    repo-reorg-cutover.md      ← archived: → 0.1.1 (has the 0.1.1 rollback SQL)
    upgrade-0.1.1-to-0.1.2.md  ← archived: 0.1.1 → 0.1.2
    python-to-go-cutover.md    ← archived: Python→Go/Bot baseline
```

## Release → cutover map

| Version     | Date       | Headline                                                                                                  | Cutover doc                                                                      |
| ----------- | ---------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **`0.1.3`** | 2026-07-18 | Web experience convergence, A2UI lifecycle, Bot projection compatibility, interop controls, G14–G17 gates | [`upgrading.md`](upgrading.md)                                                   |
| **`0.1.2`** | 2026-07-06 | i18n, Instant/Expert (dark), SSE streaming (dark), gene obsfs, backend hardening                          | [`history/upgrade-0.1.1-to-0.1.2.md`](history/upgrade-0.1.1-to-0.1.2.md)         |
| **`0.1.1`** | 2026-06-27 | `apps/` layout, `/api/v1`, Redis subsystem, auth hardening                                                | [`history/repo-reorg-cutover.md`](history/repo-reorg-cutover.md) _(applied)_     |
| baseline    | earlier    | Python→Go/Bot migration, bcrypt, first-login gate                                                         | [`history/python-to-go-cutover.md`](history/python-to-go-cutover.md) _(applied)_ |

## Conventions (all deployment docs)

- **Secrets are placeholders** (`<JWT_SECRET>`, `<DB_PASSWORD>`, …) — substituted
  out-of-band on the server. Never commit or paste real values.
- **(verify on-server)** marks facts that live only on the production host
  (`/root/...` paths, DB host, TLS cert paths) — confirm in place.
- Destructive steps (DDL, flag flips, service teardown) are **operator-only** and
  run by ops on the production host, never from the repo or by an agent.
