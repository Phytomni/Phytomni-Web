# Security Policy

## Supported Versions

Phytomni-Web ships dated snapshots of `main`. Security fixes land on `main`;
there is no separate maintenance branch.

| Release           | Supported |
| ----------------- | --------- |
| `0.1.2` (current) | yes       |
| `< 0.1.2`         | no        |

See the [CHANGELOG](CHANGELOG.md) for what each release contains.

## Reporting a Vulnerability

Please report suspected vulnerabilities privately to the maintainer:

**Shang Xie — <xieshang0608@gmail.com>**

Do not open a public GitHub issue for a vulnerability report. Include enough
detail to reproduce the issue and, if known, its impact. You should expect an
initial response acknowledging the report; a fix timeline depends on severity
and complexity.

## Security Posture

These are the standing, test-locked defenses in the codebase. Each is an
invariant — a regression is treated as a security bug, not a style nit.

- **XSS defense at `v-html` sinks.** Agent-influenced markdown (Bot-relayed,
  RAG-sourced, so attacker-influenceable) reaches `v-html` only through
  `@/utils/sanitize-markup`: a tokenizer with an attribute-**name** allow-list
  and a scheme-checked `href`, never an `on*` denylist. A regex-reentrancy vault
  stops a later render pass from re-scanning an earlier pass's emitted HTML.
  Locked by `tests/unit/utils/sanitize-markup.spec.ts` and `markdown-inline.spec.ts`.
- **Server-side session revocation.** Logout / logout-all revoke JWTs through a
  three-layer check — token blacklist, per-user epoch, and a `password_change_at`
  floor. JWT verification is pinned to HS256, so algorithm-confusion (e.g. an
  HS384-signed forgery) is rejected at the keyfunc.
- **Audit-log redaction.** The Go service is the sole writer of two audit tables
  (`user_operation_logs`, `sql_operation_logs`). Request bodies and query strings
  are redacted by content-type; SQL is parameterized, so audit rows store `?`
  placeholders rather than literal emails or PII.
- **Server-side access control.** Audit-log and cron-entry reads are admin-gated
  (`403` for non-admins); async-task surfaces are owner-scoped, so an
  auto-increment id cannot be enumerated across users.
- **Secret hygiene.** A pre-commit hook (`scripts/scan_secrets.py --staged`) and
  CI scan every push for committed credentials. The Web service holds no Huawei
  Cloud / OBS keys — all object storage is reached through the Phytomni-Bot
  relay, so cloud credentials never live in this repo.

## Scope

This policy covers the `apps/web` Vue frontend and the `apps/server` Go gateway
in this repository. The chat-orchestration backend is a separate service —
report vulnerabilities in agent or tool behavior to
[Phytomni-Bot](https://github.com/Phytomni/Phytomni-Bot). Vulnerabilities in
upstream dependencies should be reported to their respective maintainers.
