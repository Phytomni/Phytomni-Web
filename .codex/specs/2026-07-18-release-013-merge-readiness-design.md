# Phytomni-Web 0.1.3 Merge and Production Readiness Design

> Status: Approved design
>
> Date: 2026-07-18
>
> Scope: Phytomni-Web repository documentation and release-readiness evidence
>
> Owners outside this scope: Phytomni-Bot, operations, production database, and
> deployment execution

## 1. Goal

Make the `release/0.1.3` branch ready to merge into the production-facing
`main` line and give the post-merge operator a current, rollback-safe
0.1.2-to-0.1.3 upgrade path. The work must reconcile release documentation with
the code and gates already present at Web HEAD without changing Bot or
operations code and without claiming external acceptance that has not been
returned.

## 2. Version anchors and evidence boundary

The merge comparison uses `origin/main`, not the stale local `main` checkout.
At the time of this design:

| Ref | Value | Meaning |
|---|---|---|
| `origin/main` | `657c2339e8e74f7b0650d35777b2eced565a87bd` | production 0.1.2 comparison base |
| local `main` | `dfcaa0a8c6ab5e064c682ed2a56dbfe759efeca7` | one commit behind `origin/main` |
| `release/0.1.3` HEAD | `f53e20773410f5be8567a623cad84a4a748f5be5` | current Web release candidate |

The Web local gate has already passed at the release candidate, including G13
through G17. That proves repository-local readiness only. Bot-owner review,
Bot CI, staging/live smoke evidence, and operations sign-off remain external
acceptance items and must remain `External Pending` until their owners return
evidence.

## 3. Chosen approach

Use a full documentation convergence rather than a checklist-only patch:

1. Freeze the existing 0.1.1-to-0.1.2 runbook as history.
2. Rebuild the active runbook for 0.1.2-to-0.1.3.
3. Synchronize release, deployment, configuration, operations, security, and
   gate-index documentation.
4. Preserve compatibility and activation matrices as evidence references,
   adding only the cross-links needed by the new runbook.
5. Keep all changes inside Phytomni-Web; do not modify or commit Bot/operations
   handoffs and do not execute merge or production actions.

This gives the operator one active upgrade document while preserving the
previous upgrade as an auditable historical record.

## 4. Documentation changes

### 4.1 Release record

Add a dated `[0.1.3] — 2026-07-18` entry at the top of `CHANGELOG.md`. Group
the release by externally meaningful capability rather than listing all
commits:

- frontend workspace, chat, responsive, localization, accessibility, and legal
  experience convergence;
- A2UI lifecycle, typed action relay, bounded body/audit handling, and secure
  default-off behavior;
- Bot HEAD compatibility: umbrella `run_id`, bounded revisioned projections,
  CAS persistence, history fallback/dual-read, canonical agent parity, remote
  product surfaces, stream/Expert compatibility, and artifact boundaries;
- interop capability/provenance controls with owner-scoped, allowlisted, and
  redacted output;
- security and authorization hardening plus G14 visual, G15 A2UI, G16
  compatibility, and G17 activation-evidence gates;
- additive database requirements and the fact that all new feature flags stay
  disabled pending external acceptance.

### 4.2 Active upgrade runbook

Move the current `docs/deployment/upgrading.md` to
`docs/deployment/history/upgrade-0.1.1-to-0.1.2.md` without rewriting its
historical facts. Recreate `docs/deployment/upgrading.md` as the
0.1.2-to-0.1.3 runbook with these sections:

1. **Scope and ownership** — Web repository release only; operators own
   production execution, backup, cutover, and rollback.
2. **Preflight** — verify the running release is 0.1.2, the applied 0.1.1
   layout/DB/port cutover is present, the `phytomni` database and
   `phytomni-server` registry key are in use, and backups plus a rollback
   binary/dist are available.
3. **Schema inspection** — check `question_agent_logs` for `bot_run_id`,
   `image_paths`, `mode`, `bot_projection_json`, and `bot_report_revision`, and
   check the projection revision index. If `mode` is absent, run the existing
   idempotent `add-mode` command before the new binary receives traffic.
4. **Mandatory additive projection migration** — before starting the 0.1.3
   binary, run:

   ```bash
   cd apps/server
   go run main.go migrate add-bot-projection
   ```

   The migration must add nullable `bot_projection_json` (`LONGTEXT`),
   non-null `bot_report_revision` (`BIGINT DEFAULT -1`), and
   `idx_question_agent_logs_bot_report_revision`. It is additive and must not
   drop legacy columns or rows. The runbook must point to
   `docs/reference/bot-web-compatibility.md` for the exact SQL fallback.
5. **Configuration preservation** — retain `proxy_enabled` and keep
   `expert_enabled`, `stream_enabled`, `a2ui_actions_enabled`,
   `interop_enabled`, `research_enabled`, `design_enabled`,
   `network_enabled`, and `history_dual_read` false unless the matching
   external acceptance record exists.
6. **Deployment order** — backup, apply additive migrations, deploy the Go
   service and frontend, verify readiness, then run smoke checks. Do not run
   production `migrate all` as a shortcut.
7. **Smoke checks** — verify `/readyz`, authentication, blocking chat,
   history replay, async analyst/deep-genome reconciliation, artifact/download
   boundaries, remote-agent permission behavior, and the Web capability
   manifest. With flags off, A2UI actions and interop discovery must remain
   unavailable according to their documented responses and stream traffic must
   not be enabled accidentally.
8. **Rollback** — redeploy the 0.1.2 binary/dist, leave additive columns and
   index in place, keep new flags off, and retain legacy answer/status/history
   columns. Do not drop the projection schema during rollback.
9. **Evidence record** — capture command output, release SHAs, migration
   result, smoke results, and any external pending rows without storing secrets,
   credentials, or real biological data.

### 4.3 Deployment and configuration indexes

- `docs/deployment/README.md`: make 0.1.2-to-0.1.3 the active upgrade, add the
  0.1.3 release-map row dated 2026-07-18, and map the archived 0.1.1-to-0.1.2
  document.
- `docs/deployment/configuration.md`: set the current release to 0.1.3 and
  document every Bot flag, including `history_dual_read`; describe false as
  the default legacy/blocked behavior and require evidence before enabling.
- `docs/deployment/operations.md`: update dark-launch guidance to 0.1.3 and
  add A2UI, remote product surfaces, interop, and history dual-read activation
  gates with owner/CI/staging/live evidence requirements.
- `docs/README.md`: point the current upgrade link to 0.1.2-to-0.1.3.

### 4.4 Project entry points and local agent guidance

- `README.md` and `CONTRIBUTING.md`: include G14, G15, G16, and G17 in the
  documented gate list while preserving existing gate semantics.
- `SECURITY.md`: mark 0.1.3 as the supported current version and versions
  below 0.1.3 as unsupported, consistent with the repository's current support
  policy.
- `AGENTS.local.md`: update the local “next upgrade” context to 0.1.2 to
  0.1.3, then regenerate ignored `AGENTS.md` with the repository compose
  script. Never hand-edit the generated file.

### 4.5 References that remain authoritative

Keep `docs/reference/bot-web-compatibility.md` and
`docs/reference/bot-web-activation-matrix.md` as the compatibility contract and
activation evidence record. Add a runbook cross-link to the projection
migration only if the link is not already present. Keep historical cutover
documents unchanged.

## 5. Verification design

After the documentation edits:

1. Run a path/link and version-drift scan over the changed documentation.
2. Run `git diff --check` and inspect the staged diff for accidental secrets,
   production values, or Bot/operations paths.
3. Run the authoritative local gate with writable temporary Go cache and temp
   directories:

   ```bash
   GOCACHE=/tmp/phytomni-web-doc-gocache \
   GOTMPDIR=/tmp/phytomni-web-doc-gotmp \
   ./scripts/validate_web_local.sh
   ```

4. Confirm `git diff origin/main...HEAD`, branch status, and the release SHA
   used for the evidence record. Do not claim merge or production deployment.

## 6. Non-goals and safety boundaries

- No changes to Phytomni-Bot, operations scripts, production configuration,
  production database, secrets, or deployment infrastructure.
- No feature-flag activation based only on local tests or endpoint presence.
- No deletion of legacy columns, history rows, or rollback artifacts.
- No merge, force-push, production deploy, or handoff commit in this design.

## 7. Expected deliverables

- This approved design spec under `.codex/specs/`.
- A bite-sized implementation plan under the repository's approved plan
  location, with each task naming exact files, verification commands, and a
  narrow English commit boundary.
- Updated release/deployment/project documentation after the plan is approved
  and executed.
- A final verification record that distinguishes local Web gates from external
  Bot/operations acceptance.
