# Phytomni Web — `0.1.3` → `0.1.4` Upgrade Addendum

This is the focused operator addendum for a production deployment already
running `0.1.3`. The complete `0.1.2` → `0.1.3` procedure remains in the active
[`upgrading.md`](../upgrading.md) runbook; confirm the deployed SHA before
choosing this addendum.

## Release boundary

- This is a Web-only compatibility and quality follow-up.
- It adds no production database migration or configuration key beyond the
  `0.1.3` baseline.
- Bot, operations, deployment automation, secrets, and live feature activation
  remain outside this repository change.
- `RC-WEB-001` through `RC-WEB-007` and `RC-LIVE-001` remain **External
  Pending** until an authorized acceptance packet is reviewed.

## Preflight

1. Verify the running service is the `0.1.3` deployment and record its SHA.
2. Preserve the running `0.1.3` Go binary, frontend `dist/`, configuration, and
   a verified database backup for rollback.
3. Confirm the additive `0.1.3` projection schema exists:
   `bot_projection_json`, `bot_report_revision`, and
   `idx_question_agent_logs_bot_report_revision` on
   `question_agent_logs`. If any item is missing, stop and follow the
   `0.1.2` → `0.1.3` procedure first; do not invent a new DDL path here.
4. Confirm `/readyz` and the current core Web smoke checks pass before the
   replacement binary is started.

## What changes in `0.1.4`

- Native Bot responses accept the compatible top-level identity form while
  preserving the Web `run_id` contract and rejecting conflicts.
- New-chat failure and ambiguity handling retains temporary dialogue identity
  until the server returns an authoritative Web dialogue id.
- Typed Bot upstream failures preserve 504 timeout behavior, map other Bot 5xx
  responses to safe 502 errors, and keep Web failures at 500.
- The local quality gate and static-analysis closure are refreshed for the
  release candidate. The human-reviewed visual package is local evidence only.
- The frontend build uses Vite `8.1.5` and targets Chrome/Edge 111, Firefox 114,
  and Safari 16.4 or newer. Hashed frontend filenames may change even though
  no Go configuration, database schema, Bot code, or operations code changes.

## Configuration and flags

Preserve the `0.1.3` configuration. Keep every new capability dark by default:

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

Do not add a migration, flip a flag, or change the Bot key as part of this
addendum. A flag change requires its own reviewed acceptance row and operator
authorization.

## Deploy and smoke

1. Build or copy the Web Go binary and matching frontend `dist/` from the
   reviewed `0.1.4` SHA. If building the frontend from source, use Node 26.x
   and npm 11.x, run `npm ci` in `apps/web`, then run `npm run build`.
2. Publish the complete new `dist/` directory atomically; do not mix old HTML
   with new hashed assets or publish only changed files.
3. Preserve the production port, database/registry key, Bot URL, and existing
   secret delivery. Restart using the approved operations procedure.
4. Check `/readyz` and service logs for startup, configuration, or Bot relay
   errors.
5. With a non-production test account, verify login, blocking chat, same-title
   new-chat failure recovery, Bot timeout/5xx error mapping, history replay,
   owner isolation, and existing artifact behavior.
6. Keep all Bot-facing capabilities disabled and record the smoke result with
   the deployed SHA. Local G13–G17 output does not replace Bot, CI, staging,
   live, or operations acceptance.

## Rollback

If readiness, smoke, or data correctness fails:

1. Stop the `0.1.4` service using the approved operations procedure.
2. Restore the saved `0.1.3` binary, frontend `dist/`, and configuration.
3. Keep the additive projection columns and index in place; `0.1.3` can use
   them and no schema rollback is needed.
4. Keep every capability flag false, restart, and repeat `/readyz` plus the
   core smoke checks.
5. Preserve sanitized logs and results without secrets, credentials, cookies,
   or real user/biological data.

## Repository-local evidence

The current Web closure record is `1e210119` on `release/0.1.4`; operators must
record the exact selected SHA in deployment evidence rather than relying on a
branch name. `./scripts/validate_web_local.sh` passes locally, including
G13–G17, with 207 frontend test files and 2724 tests. This is repository
evidence only; no production deployment or external acceptance is claimed by
this addendum.
