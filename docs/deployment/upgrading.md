# Phytomni Web — `0.1.2` → `0.1.3` Upgrade Runbook

**This is the only active procedure for production already running `0.1.2`.**

Operators own backups, database changes, service restarts, smoke checks, and
rollback. This document records the Web-side release contract; it does not
grant permission to change Phytomni-Bot or production operations code.

> **Are you on `0.1.2`?** Confirm the running stack has the `apps/` layout,
> `phytomni-server` on `:8080`, the `phytomni` MySQL database with unprefixed
> plural tables, the `phytomni-server` connection-registry key, and `/api/v1/*`
> routes. If any prerequisite is missing, stop and complete the archived
> cutover/upgrade procedure first.

> **Release boundary.** Web local gates prove repository readiness only. Bot
> owner review, Bot CI, staging/live smoke evidence, and operations sign-off
> remain `External Pending` until their owners return an acceptance packet.

## 0. Conventions and contents

- Secrets are placeholders (`<JWT_SECRET>`, `<REDIS_PASSWORD>`, …). Substitute
  them out-of-band and never paste real values into this document or a ticket.
- `(verify on-server)` marks a fact that only the production operator can prove.
- “Current stack” means the deployed `0.1.2`; “this release” means `0.1.3`.
- Do not run the development `migrate all`/AutoMigrate path against production.
  Production DDL is additive and operator-controlled.
- Keep the 0.1.2 binary/dist and a database backup until smoke verification is
  complete.

**Contents.**

1. [What changed](#1-what-changed-vs-012)
2. [Preflight](#2-preflight-and-backup)
3. [Configuration](#3-configuration-surface)
4. [Operator actions](#4-operator-actions-and-schema)
5. [Deploy sequence](#5-deploy-sequence)
6. [Verification and smoke](#6-verification-and-smoke)
7. [Rollback](#7-rollback)
8. [Activation gates](#8-dark-launch-activation-gates)

## 1. What changed vs `0.1.2`

| Area | `0.1.2` | `0.1.3` | Operator action |
|---|---|---|---|
| Bot run identity | Legacy/task-compatible identity | Umbrella `run_id` stored as `bot_run_id` | Apply the additive projection migration before new traffic (§4.2) |
| Bot reports | Legacy answer/status columns | Sanitized revisioned projection with CAS persistence | Apply projection columns and index; keep legacy columns (§4.2) |
| History | Legacy Web rows | Projection-first read with legacy fallback; dual-read is optional | Keep `history_dual_read=false` until external evidence (§8.4) |
| A2UI actions | No production action uplink | Typed, owner-scoped action relay | Keep `bot.a2ui_actions_enabled=false`; enable only after acceptance (§8.1) |
| Remote product surfaces | Core Web agents only | Research, Design, and Network compatibility surfaces | Keep each remote flag false until resolver/attachment/permission evidence (§8.2) |
| Interop | No browser-facing capability discovery | Allowlisted capability/provenance discovery | Keep `bot.interop_enabled=false` until security and external review (§8.3) |
| Expert and AG-UI streaming | Dark in `0.1.2` | Compatibility and lifecycle hardening | Keep both flags false unless their existing acceptance rows are complete |
| Frontend | Existing chat/workspace experience | Responsive, visual, accessibility, localization, and legal convergence | Deploy the matching Web frontend with the Go service |
| Local release evidence | G13 baseline | G13, G14 visual, G15 A2UI, G16 compatibility, G17 activation evidence | Record local output; do not treat it as external acceptance |

The release is additive when every new flag remains false. Existing blocking
chat, legacy history, ownership checks, and rollback columns remain available.

## 2. Preflight and backup

Complete these checks on the production host before changing the database or
stopping the service. A failed check is a stop condition.

### 2.1 Confirm the running release (verify on-server)

```bash
git rev-parse --verify HEAD
./phytomni-server --version 2>/dev/null || true
ss -ltnp | grep ':8080'
mysql -e "SHOW DATABASES LIKE 'phytomni';"
mysql phytomni -e "SHOW TABLES LIKE 'question_agent_logs';"
curl -fsS http://127.0.0.1:8080/readyz
```

Record the running SHA and confirm that the service is the production `0.1.2`
stack described in the opening block. Do not infer the deployed version from a
local checkout.

### 2.2 Preserve rollback artifacts (verify on-server)

1. Create a timestamped backup of the `phytomni` database using the approved
   operations procedure.
2. Copy the currently deployed 0.1.2 `phytomni-server` binary, frontend `dist/`,
   and configuration template to the release directory.
3. Confirm the backup can be read and the previous binary starts in a staging
   or isolated rollback check.

Never record credentials, DSNs, tokens, cookies, or real biological data in the
release evidence.

## 3. Configuration surface

The complete key reference is [`configuration.md`](configuration.md). Preserve
existing `proxy_enabled`, database, Redis, JWT, OBS, and cron values. The
following Bot switches must remain false for the initial 0.1.3 deployment:

```yaml
bot:
  expert_enabled: false
  stream_enabled: false
  a2ui_actions_enabled: false
  interop_enabled: false
  research_enabled: false
  design_enabled: false
  network_enabled: false
  history_dual_read: false
```

`history_dual_read=false` keeps history on the legacy/projection fallback path
without an active Bot history read. It is an observation/compatibility switch,
not a migration substitute. Do not add a flag or flip one to true because an
endpoint exists; the matching acceptance row and owner evidence are required.

## 4. Operator actions and schema

### 4.1 Inspect the existing columns and index

```bash
mysql phytomni -e "SHOW COLUMNS FROM question_agent_logs;"
mysql phytomni -e "SHOW INDEX FROM question_agent_logs;"
```

Before the new binary receives traffic, confirm these Web columns exist:

- `bot_run_id`
- `image_paths`
- `mode`
- `bot_projection_json`
- `bot_report_revision`

Also confirm the index `idx_question_agent_logs_bot_report_revision` exists. If
any item is absent, apply the corresponding idempotent additive command below
and repeat the inspection.

### 4.2 Mandatory additive projection migration

From the repository root of the deployed release, run:

```bash
cd apps/server
go run main.go migrate add-bot-projection
```

The command is idempotent and applies these statements in order:

```sql
ALTER TABLE question_agent_logs
  ADD COLUMN bot_projection_json LONGTEXT NULL
  COMMENT 'sanitized Bot run projection' AFTER bot_run_id;
ALTER TABLE question_agent_logs
  ADD COLUMN bot_report_revision BIGINT NOT NULL DEFAULT -1
  COMMENT 'last Bot report revision' AFTER bot_projection_json;
CREATE INDEX idx_question_agent_logs_bot_report_revision
  ON question_agent_logs(bot_report_revision);
```

This migration must complete successfully before the 0.1.3 Go service starts
serving traffic. It is additive: do not drop, rename, or rewrite legacy answer,
status, task, server, artifact, or identity columns. The compatibility reference
contains the same [projection schema and precedence rules](../reference/bot-web-compatibility.md#old-and-new-column-mapping).

Or the idempotent CLI (safe to re-run; no-op if the column already exists):

```bash
cd apps/server && go run main.go migrate add-mode
```

> **Do not skip this when deploying a binary that writes `mode`.** Without the
> column, every chat send returns 500 (`Unknown column 'mode'`), the same class
> of failure as a missing `image_paths` column.

Existing rows get `'instant'`. Until Expert is fully activated (§7.1), the SPA
disables the Expert pill and the gateway returns **503** for any `mode=expert`
request — no Bot call.

### 4.3 Mode-column preflight

The production comparison base contains an idempotent `add-mode` migration
command, while the release branch adds `add-bot-projection` in the same CLI
subcommand area. During the branch merge, resolve any `migrate.go` conflict by
retaining **both** subcommands, then verify the merged binary exposes them. The
target `main` line includes an idempotent `add-mode` migration command for
the 0.1.2 Expert selector. If the inspection in §4.1 shows that `mode` is
missing, run the command exposed by the merged target binary:

```bash
cd apps/server
go run main.go migrate add-mode
```

If the merged binary does not expose `add-mode`, stop and use the operator's
approved equivalent additive DDL; do not invent a destructive migration. Repeat
§4.1 after the command and keep `bot.expert_enabled=false`.

## 5. Deploy sequence

1. Confirm the backup and rollback artifacts from §2.
2. Apply the `mode` preflight and the mandatory projection migration from §4.
3. Build or copy the 0.1.3 Go binary and matching frontend `dist/` from the
   reviewed release SHA.
4. Preserve the production config, explicitly retaining all flags in §3 as
   false and preserving `proxy_enabled`.
5. Stop and start the service using the approved operations procedure; do not
   change the public port or database/registry key.
6. Check `/readyz` and service logs for migration, configuration, or Bot relay
   errors before allowing normal traffic.
7. Perform the smoke checks in §6.

Do not flip a feature flag during the deploy window. A flag change is a separate
operator action that requires the evidence gates in §8.

## 6. Verification and smoke

Record the command, timestamp, release SHA, and sanitized result for each check.

### 6.1 Core Web behavior

```bash
curl -fsS http://127.0.0.1:8080/readyz
```

Using a non-production test account, verify:

1. Login and authenticated route access succeed.
2. Blocking chat submission returns the existing Web response shape.
3. A conversation reload returns its legacy history and does not expose another
   user's row.
4. Async Analyst and DeepGenome reconciliation returns the latest non-empty
   report and does not replace it with an empty revision.
5. Validated artifacts/downloads remain owner-scoped; malformed or private Bot
   paths are not exposed.

### 6.2 Dark-launch behavior

With every new flag still false, verify:

- A2UI action submission remains disabled according to the documented Web
  response and does not call Bot.
- Interop capability discovery remains hidden/disabled and returns no raw Bot
  payload.
- Research, Design, and Network remote surfaces do not call Bot when their
  local flags are false.
- AG-UI SSE remains off and blocking chat is still the active path.
- Expert mode remains unavailable unless the existing accepted Expert gate is
  separately reviewed.

Do not use a 404/403/503 response alone as acceptance evidence; capture the
owner/CI/staging/live result required by the activation matrix.

### 6.3 Local release evidence

The Web repository gate is run before merge, not on the production host:

```bash
GOCACHE=/tmp/phytomni-web-doc-gocache \
GOTMPDIR=/tmp/phytomni-web-doc-gotmp \
./scripts/validate_web_local.sh
```

G13–G17 passing is local Web evidence. It does not mark RC-WEB-001 through
RC-WEB-007, RC-LIVE-001, or operations acceptance as passed.

## 7. Rollback

If `/readyz`, core smoke, or data correctness fails:

1. Stop the 0.1.3 service using the approved operations procedure.
2. Restore the 0.1.2 Go binary, frontend `dist/`, and config from §2.2.
3. Keep `bot_projection_json`, `bot_report_revision`, and their index in place;
   the 0.1.2 binary can ignore additive columns.
4. Keep all new flags false and preserve the legacy `answer`, `status`, task,
   server, and artifact columns.
5. Restart 0.1.2, check `/readyz`, and repeat the core smoke checks.
6. Preserve the failed 0.1.3 logs and migration result for diagnosis, without
   including secrets or user/biological data.

Do not drop the projection columns or restore a pre-migration schema as part of
rollback. A later forward deployment can reuse the additive schema.

## 8. Dark-launch activation gates

All rows below remain **External Pending** until an authorized acceptance packet
is returned and reviewed. Local Web gates and endpoint presence are necessary
but not sufficient.

### 8.1 A2UI actions (`bot.a2ui_actions_enabled`)

Prerequisites: Web G15 pass; Bot emit and action-accept evidence; owner review;
staging/live action, expiry, ownership, and retry checks. Operator change:
enable the Web flag only after those records are linked. Smoke: submit a
synthetic valid action and verify the same `dialogue_id`, owner, and `run_id`.
Rollback: set the flag false and restart; the blocking path remains unchanged.

### 8.2 Remote product surfaces

`research_enabled`, `design_enabled`, and `network_enabled` each require
resolver, attachment, permission, bounded-result, and Bot/operations smoke
evidence. Enable one surface at a time, record its owner and release SHAs, and
set only that flag. Roll back by setting the individual flag false; do not
enable all three as a proxy for acceptance.

### 8.3 Interop (`bot.interop_enabled`)

Prerequisites: security review of allowlists, owner scoping, capability and
provenance redaction, Bot owner acceptance, and staging/live evidence. Keep the
endpoint hidden/off otherwise. Never expose raw Bot envelopes, provider
diagnostics, private paths, credentials, or unredacted provenance.

### 8.4 History dual-read (`bot.history_dual_read`)

This is an observation/compatibility mode, not a replacement for the persisted
projection. Before enabling, compare projection-first, legacy fallback, and Bot
history results for owner-scoped synthetic rows; record no data loss, no older
revision overwrite, and a tested flag rollback. Keep false until RC-WEB-007 and
RC-LIVE-001 evidence is reviewed.

### 8.5 Existing Expert and streaming gates

`expert_enabled` and `stream_enabled` retain their previous acceptance process.
`stream_enabled` requires Bot real-answer persistence and the matching frontend
flag; with it false, the blocking path must remain byte-compatible. Do not turn
either flag on as part of the 0.1.3 deploy.

## 9. Evidence and ownership

The release record should include:

- deployed Web SHA and comparison baseline;
- backup and migration result (sanitized);
- `/readyz`, core smoke, and dark-launch smoke results;
- local G13–G17 gate output;
- links to any returned Bot-owner, CI, staging/live, and operations acceptance
  rows, or an explicit `External Pending` status.

This Web repository change does not run production DDL, merge branches, push a
release, deploy services, or modify Phytomni-Bot/operations code.
