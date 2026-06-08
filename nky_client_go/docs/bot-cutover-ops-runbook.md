# Bot Cutover Ops Runbook

Operator procedures for the Web Go ↔ Phytomni-Bot `/query` cutover
(candidate-A: Web Go is the single gateway, Bot is internal-only). All
examples are scrubbed — never paste real keys, tokens, or DSNs into this
file or into commits.

Architecture reference: `1.phytomni/.claude/reference/Web-Bot-目标架构.md`.
The gateway is dormant until `bot.proxy_enabled=true`.

## 1. Bot service token (ops-only)

The Bot **service token** mints and revokes user keys. It is ops-only:
it never enters `app.yml`, source, or git. It lives only in the ops
secrets channel and on the Bot side. Web Go holds a **user key**, not the
service token, and contains no key-mint/revoke code.

## 2. First deploy — mint the `ptm_<web>` user key

One Web app = one Bot principal (`user_id="web"`). Mint once at deploy:

```bash
curl -X POST <bot-base-url>/v1/api-keys \
  -H "Authorization: Bearer <SERVICE_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"web","name":"chat-ai-web-app"}'
```

Take the one-time `api_key` from the response and write it to production
`app.yml` `bot.user_api_key` (secure config delivery, not git). Set
`bot.base_url` to the internal Bot URL (e.g. `http://bot.internal:8000`).

## 3. 90-day key rotation (ops procedure, not a Web Go cron)

1. Mint a new `ptm_<web>` key via the curl in §2.
2. Write it to production `app.yml`.
3. Rolling-restart Web Go (no downtime).
4. Revoke the old key once in-flight requests drain:

```bash
curl -X DELETE <bot-base-url>/v1/api-keys/<old-prefix> \
  -H "Authorization: Bearer <SERVICE_TOKEN>"
```

Logs must redact the key to its prefix only (`bot.key_audit_redact=true`).

## 4. Topology constraint

Bot is internal-only; Web Go is the sole internet-facing service. chat-ai
never reaches Bot directly. `/query` and `/query/analyst/update_log` are
served by Web Go at the root path (not under `/v1`) with the standard JWT
auth chain.

## 5. Real-user isolation (must stay covered)

Bot always sees `user_id="web"`. Real-user isolation is 100% Web Go's job:
every read that joins Bot data filters on the Web identity. `ApiAnswerCheck`
(B-5) and `ApiQuery` (B-4) scope by `user_name` (the JWT-decoded user).
Any future Bot-proxy endpoint must do the same — never trust a client-sent
user id.

## 6. Cutover sequence (Push #2 — gated)

Preconditions: Bot deploy URL provided; `ptm_<web>` minted (§2); Bot e2e
green; Bot deep_genome NL resolver live; three-party sign-off.

1. Deploy Web Go with the gateway code (dormant, `proxy_enabled=false`).
2. Staging: set `proxy_enabled=true` + point `/query` at Web Go (set
   `VITE_DEV_PROXY_QUERY` / nginx), run the agent smoke matrix against the
   live Bot, confirm chat-ai is unaffected.
3. Production cutover commit (the defining act):
   - `git rm -rf nky_client_python/`
   - flip `app.yml` `bot.proxy_enabled` to `true`
   - point production `/query` at Web Go (nginx)
   - remove the Python systemd unit (ops)
4. Run `go run main.go migrate add-bot-run-id` against production once
   (idempotent) if the column is not yet present.
5. Rotate/retire the old OBS credentials in the Huawei console the same day.

## 7. Phase 6 ETL trigger (Option Y only — currently deferred)

Historical-row backfill is deferred (Option X). If/when Option Y is
chosen: three-party sign-off → Web provides a read-only production MySQL
DSN over a secure channel → Bot ops runs a dry-run + reconciliation →
production ETL → Web runs the `bot_run_id` backfill. Not required for
cutover; old rows read MySQL legacy fields via the B-5 fallback.

## 8. Rollback

1. Flip `app.yml` `bot.proxy_enabled` back to `false` (gateway dormant).
2. If already cut over: `git revert` the cutover commit to restore the
   Python service from history, repoint `/query` at the Python port, and
   restart. The `bot_run_id` column stays (harmless).
3. `ApiAnswerCheck` automatically serves MySQL legacy fields while the
   gateway is off, so history replay keeps working.

## 9. Degraded mode (Bot unavailable)

- Startup: with `proxy_enabled=true`, Web Go fails fast if Bot `/v1/agents`
  is unreachable or missing a required slug. With `proxy_enabled=false`,
  Web Go boots without contacting Bot.
- Runtime: `/query` returns a 5xx with an operator-actionable log when Bot
  is down; `/v1/answer/check` degrades to MySQL legacy fields rather than
  failing. Web Go itself never crashes on Bot trouble.
