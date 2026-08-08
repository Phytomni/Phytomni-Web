# Phytomni Web — `0.1.3` → `0.1.4` Upgrade Addendum

This is the focused operator addendum for a production deployment already
running `0.1.3`. The complete `0.1.2` → `0.1.3` procedure remains in the active
[`upgrading.md`](../upgrading.md) runbook; confirm the deployed SHA before
choosing this addendum.

## Release boundary

- This Web release consumes an extended Research input contract. Compatible Bot
  delivery plus operator-owned storage and proxy work are deployment
  preconditions, not changes executed from this repository.
- The Web configuration surface adds `bot.max_query_chars`; use only scrubbed
  examples in source control and preserve live values through approved secret
  delivery.
- Bot code, production DDL, reverse-proxy configuration, deployment automation,
  secrets, and live execution remain owned by their respective teams.
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
4. The `question_agent_logs` `query` and `answer` columns must both be
   `MEDIUMTEXT` before new Web traffic. Confirm both live types through the
   separately transferred operator procedure; do not run AutoMigrate against
   production.
5. Confirm the effective reverse-proxy request-body allowance covers the
   configured query maximum plus bounded history, attachment metadata, and
   multipart framing. This allowance does not permit file-body relay through
   Web Go.
6. Confirm `/readyz` and the current core Web smoke checks pass before the
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
- Research accepts the complete raw user query plus opaque managed attachments;
  pasted paper text and dataset paths remain in the same ordinary query. No
  layer silently truncates an accepted query or adds a path/description field.
- Web requires `research_input_resolution_v1` version `1` and compatible
  advertised query, attachment, path, reference, and scientific-format limits.
  Missing or incompatible metadata fails Research closed.
- The frontend build uses Vite `8.1.5` and targets Chrome/Edge 111, Firefox 114,
  and Safari 16.4 or newer. Hashed frontend filenames may change; the browser
  support floor is unchanged.

## Configuration and flags

Preserve unrelated `0.1.3` configuration and add the bounded query key:

```yaml
bot:
  max_query_chars: 131072
```

The default query limit is 131,072 Unicode code points and the hard maximum is
1,048,576. Extended Research input does not add a new input flag or cohort:
every user already authorized for Research receives the same negotiated
contract. Preserve the deployed values of existing product flags; any unrelated
flag change still requires its own reviewed acceptance row and operator
authorization.

## Deploy and smoke

After the database and proxy preflight, Bot deployment must complete before Web
deployment. Use this order:

1. Deploy the compatible Bot resolver and verify
   `research_input_resolution_v1` version `1` plus its bounded descriptor.
2. Build or copy the Web Go binary and matching frontend `dist/` from the
   reviewed `0.1.4` SHA. If building the frontend from source, use Node 26.x
   and npm 11.x, run `npm ci` in `apps/web`, then run `npm run build`.
3. Publish the complete new `dist/` directory atomically; do not mix old HTML
   with new hashed assets or publish only changed files.
4. Preserve the production port, database/registry key, Bot URL, and existing
   secret delivery. Restart using the approved operations procedure.
5. Check `/readyz` and service logs for startup, configuration, or Bot relay
   errors.
6. With a non-production Research-authorized account, verify the three supported
   forms: uploaded PDF plus uploaded data; uploaded PDF plus paths pasted into
   the query; and paper text plus paths pasted into the query. Also verify
   lifecycle truthfulness, refresh, history replay, and owner isolation.
7. Record the Bot and Web SHAs plus sanitized smoke results. Local repository
   output does not replace Bot CI, paired runtime, staging, live, or operations
   acceptance.

## Rollback

If readiness, smoke, or data correctness fails:

1. Stop the `0.1.4` service using the approved operations procedure.
2. Restore the saved `0.1.3` binary, frontend `dist/`, and configuration before
   reverting Bot, so active Web never depends on a missing protocol.
3. Keep the additive projection columns and index in place; `0.1.3` can use
   them and no schema rollback is needed.
4. Rollback keeps `query` and `answer` widened as `MEDIUMTEXT`; never narrow
   columns that may contain already accepted rows. The larger safe proxy
   allowance may remain because application limits still bound requests.
5. Preserve existing product-flag values, restart, and repeat `/readyz` plus
   the core smoke checks. Do not delete uploads, Research runs, or user history.
6. Preserve sanitized logs and results without secrets, credentials, cookies,
   or real user/biological data.

## Repository-local evidence

Record the exact selected Web and Bot SHAs, check date, command, exit code, and
the final `./scripts/validate_web_local.sh` result rather than copying volatile
test counts into this rolling addendum. Repository checks are Web evidence only;
Bot delivery, operator DDL/proxy execution, paired runtime, staging, and
production acceptance remain **External Pending** until their owners return
reviewable evidence.
