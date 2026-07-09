# Dependency Next-Batch Hygiene — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `release/0.1.3`, close the inventory “Next batch”: retire dead `snowflake` usage, delete the unused Redis `*Default` client path, harden JWT env injection so an empty `PHYTOMNI_JWT_SECRET` cannot clobber the file secret, and align the Element Plus semver declare with the locked install.

**Architecture:** Four independent hygiene fixes in one plan. JWT secret injection is rewritten to the same non-empty `os.Getenv` pattern already used for `PHYTOMNI_DB_DSN` / `PHYTOMNI_REDIS_PASSWORD` (replacing `viper.BindEnv`, which treats set-empty as an override). Dead code is deleted, not deprecated. EP change is declare-only (`package.json`); lockfile already resolves `2.10.1`.

**Tech Stack:** Go 1.23, Viper, go-redis v8, Element Plus (declare only), existing vitest/go test gates.

**Design doc:** `.codex/specs/2026-07-10-dependency-research-remaining-inventory-design.md` §2.1

## Global Constraints

- **Branch:** develop directly on `release/0.1.3`. No feature branches.
- **Out of scope:** Go `a2ui-actions`, golang-jwt v5, gofpdf, axios progress, Bot Q3–Q5, XMarkdown, pinia/vue-i18n declare bumps, CHANGELOG/PR close window.
- **JWT semantics after fix:** unset env → file wins; non-empty env → env wins; **empty env → file wins** (same as Redis/DSN).
- **Do not** reintroduce `viper.BindEnv` for `jwt.secret_key` after the switch to explicit non-empty override.
- **Do not** call or keep `InitFromViperDefault` / `NewClientDefault` / `ClientDefault` / `ClientAndErrDefault`.
- **Do not** wire `SnowflakeGenUUID` — delete it and drop `github.com/bwmarrin/snowflake`.
- **EP declare:** set `"element-plus": "^2.10.1"` only; do **not** run a broad `npm update`; lockfile already has `2.10.1`.
- **Single-language policy:** comments, string literals, tests, docs in **English**.
- **Commit style (sssxie):** `<emoji> Category: Capitalized imperative` subject + REQUIRED `- ` bullet body. English. No `Co-Authored-By`. No planning tokens in commit subjects/bodies.
- **`git add` explicit paths only**, never `-A`.
- **Local gate:** final task runs `./scripts/validate_web_local.sh`.

---

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `apps/server/utils/comm.go` | 1 | Remove `SnowflakeGenUUID` + snowflake import/node |
| `apps/server/go.mod` / `go.sum` | 1 | Drop `github.com/bwmarrin/snowflake` via `go mod tidy` |
| `apps/server/utils/snowflake_retired_test.go` | 1 | Hygiene: `go.mod` must not contain `bwmarrin/snowflake` |
| `apps/server/cache/client.go` | 2 | Delete `NewClientDefault` / `ClientDefault` / `ClientAndErrDefault` |
| `apps/server/cache/redis.go` | 2 | Delete `clientDefault` + `InitFromViperDefault` |
| `apps/server/main.go` | 2 | Shorten Redis boot comment (no Default path) |
| `apps/server/utils/config.go` | 3 | Replace `BindEnv` with non-empty `applyEnvJWTSecret` |
| `apps/server/utils/config_test.go` | 3 | Keep env-set / unset tests; add empty-string → file wins |
| `docs/deployment/configuration.md` | 3 | Document empty JWT env ignored (file wins) |
| `docs/deployment/upgrading.md` | 3 | Same empty-env wording |
| `apps/web/package.json` | 4 | `"element-plus": "^2.10.1"` |
| `.codex/specs/2026-07-10-dependency-research-remaining-inventory-design.md` | 5 | Mark Next-batch items Closed (local) |
| `.codex/specs/2026-07-06-development-roadmap.md` | 5 | Progress banner (local) |

---

### Task 1: Retire snowflake dead code

**Files:**
- Modify: `apps/server/utils/comm.go`
- Modify: `apps/server/go.mod`, `apps/server/go.sum` (via tidy)
- Create: `apps/server/utils/snowflake_retired_test.go`

**Interfaces:**
- Consumes: none
- Produces: no public `SnowflakeGenUUID`; `go.mod` free of `bwmarrin/snowflake`

- [ ] **Step 1: Confirm zero callers (must stay zero)**

Run from repo root:

```bash
rg -n 'SnowflakeGenUUID|bwmarrin/snowflake' apps/server --glob '*.go'
```

Expected: only `apps/server/utils/comm.go` (definition + import). If any other caller appears, **stop** and ask — do not delete a live path.

- [ ] **Step 2: Write the failing hygiene test**

Create `apps/server/utils/snowflake_retired_test.go`:

```go
package utils_test

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestSnowflakeRetiredFromGoMod(t *testing.T) {
	_, file, _, _ := runtime.Caller(0)
	modPath := filepath.Join(filepath.Dir(file), "..", "go.mod")
	body, err := os.ReadFile(modPath)
	if err != nil {
		t.Fatalf("read go.mod: %v", err)
	}
	if strings.Contains(string(body), "github.com/bwmarrin/snowflake") {
		t.Fatal("go.mod still references github.com/bwmarrin/snowflake")
	}
}
```

- [ ] **Step 3: Run test — expect FAIL**

```bash
cd apps/server && go test ./utils/ -run TestSnowflakeRetiredFromGoMod -count=1
```

Expected: FAIL with `go.mod still references github.com/bwmarrin/snowflake`.

- [ ] **Step 4: Delete snowflake from `comm.go`**

In `apps/server/utils/comm.go`, remove:

- the `"github.com/bwmarrin/snowflake"` import
- `var node, _ = snowflake.NewNode(1)`
- the entire `SnowflakeGenUUID` function

Leave `GenDefaultPwd`, `GetStructRequiredMsg`, `SliceOffset`, `ReplaceHtml`, `FormatSliceUintString`, and `Contains` unchanged.

- [ ] **Step 5: `go mod tidy`**

```bash
cd apps/server && go mod tidy
```

Confirm `go.mod` no longer lists `github.com/bwmarrin/snowflake`.

- [ ] **Step 6: Run test — expect PASS**

```bash
cd apps/server && go test ./utils/ -run TestSnowflakeRetiredFromGoMod -count=1
```

Expected: PASS.

Also:

```bash
cd apps/server && go test ./utils/ -count=1
```

Expected: all utils tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/utils/comm.go apps/server/utils/snowflake_retired_test.go apps/server/go.mod apps/server/go.sum
git commit -m "$(cat <<'EOF'
♻️ Reorg: Drop unused snowflake UUID helper

- SnowflakeGenUUID had zero callers; remove it and bwmarrin/snowflake from go.mod
- Lock the retirement with a go.mod hygiene test
EOF
)"
```

---

### Task 2: Delete Redis `*Default` dead path

**Files:**
- Modify: `apps/server/cache/client.go`
- Modify: `apps/server/cache/redis.go`
- Modify: `apps/server/main.go` (comment only)

**Interfaces:**
- Consumes: production boot already uses `InitFromViper` + `NewClient` only (`main.go`)
- Produces: package `cache` exports only the UniversalClient path (`InitFromViper`, `NewClient`, `Client`, `ClientAndErr`, `optionsFromConfig`, `applyEnvRedisPassword`)

- [ ] **Step 1: Confirm zero production callers**

```bash
rg -n 'InitFromViperDefault|NewClientDefault|ClientDefault|ClientAndErrDefault|clientDefault' apps/server --glob '*.go'
```

Expected hits only in `cache/client.go`, `cache/redis.go`, and the warning comment in `main.go`. If any other caller exists, **stop**.

- [ ] **Step 2: Delete Default APIs from `client.go`**

Remove from `apps/server/cache/client.go`:

- `NewClientDefault`
- `ClientDefault`
- `ClientAndErrDefault`

Keep `optionsFromConfig`, `NewClient`, `Client`, `ClientAndErr` unchanged.

- [ ] **Step 3: Delete Default init from `redis.go`**

In `apps/server/cache/redis.go`, remove:

- `var clientDefault map[string]*redis.Client`
- the entire `InitFromViperDefault` function

Keep `InitFromViper`, `applyEnvRedisPassword`, and `Config` unchanged.

- [ ] **Step 4: Update `main.go` comment**

Replace the Redis boot comment block that mentions `InitFromViperDefault` with:

```go
	// Redis user/product layer (token revocation, rate-limit, OBS-listing cache).
	// FAIL-OPEN: a Redis outage must NOT block boot — features degrade instead.
	// InitFromViper fills the "clients" map read by cache.Client.
```

Do not change the `InitFromViper()` call or fail-open behavior.

- [ ] **Step 5: Compile + test cache package**

```bash
cd apps/server && go test ./cache/ -count=1 && go build -o /dev/null .
```

Expected: PASS / build OK. If anything still references Default symbols, the compile fails — fix by completing the deletion.

- [ ] **Step 6: Commit**

```bash
git add apps/server/cache/client.go apps/server/cache/redis.go apps/server/main.go
git commit -m "$(cat <<'EOF'
♻️ Reorg: Remove unused Redis Default client path

- InitFromViperDefault bypassed pool knobs and env password override
- Production boot already uses InitFromViper only; delete the parallel map
EOF
)"
```

---

### Task 3: JWT empty-string env hardening (L2)

**Files:**
- Modify: `apps/server/utils/config.go`
- Modify: `apps/server/utils/config_test.go`
- Modify: `docs/deployment/configuration.md`
- Modify: `docs/deployment/upgrading.md`

**Interfaces:**
- Consumes: `LoadConfigInFile` already loads YAML then binds secrets
- Produces: `applyEnvJWTSecret()` — overrides `jwt.secret_key` only when `PHYTOMNI_JWT_SECRET` is **non-empty**; called at end of `LoadConfigInFile`

- [ ] **Step 1: Write the failing empty-env test**

Append to `apps/server/utils/config_test.go`:

```go
// TestLoadConfigInFile_JWTSecret_EmptyEnvKeepsFileValue asserts that a set-but
// empty PHYTOMNI_JWT_SECRET must NOT clobber the file secret (parity with
// PHYTOMNI_DB_DSN / PHYTOMNI_REDIS_PASSWORD non-empty guards).
func TestLoadConfigInFile_JWTSecret_EmptyEnvKeepsFileValue(t *testing.T) {
	cfgPath := writeTestConfig(t, "file-secret-value")
	t.Setenv("PHYTOMNI_JWT_SECRET", "")
	viper.Reset()
	t.Cleanup(viper.Reset)

	if err := LoadConfigInFile(cfgPath); err != nil {
		t.Fatalf("LoadConfigInFile: %v", err)
	}
	got := viper.GetString("jwt.secret_key")
	if got != "file-secret-value" {
		t.Fatalf("jwt.secret_key = %q, want %q (empty env must not clobber file)", got, "file-secret-value")
	}
}
```

Keep the existing `TestLoadConfigInFile_JWTSecret_EnvOverride` and `TestLoadConfigInFile_JWTSecret_FileValueWhenEnvUnset` tests — they must still pass after the fix.

- [ ] **Step 2: Run test — expect FAIL under BindEnv**

```bash
cd apps/server && go test ./utils/ -run 'TestLoadConfigInFile_JWTSecret_' -count=1
```

Expected: `TestLoadConfigInFile_JWTSecret_EmptyEnvKeepsFileValue` FAIL (`jwt.secret_key = ""` or similar). The other two JWT tests should still PASS.

- [ ] **Step 3: Replace BindEnv with non-empty override**

In `apps/server/utils/config.go`, replace the BindEnv block at the end of `LoadConfigInFile` with:

```go
	// Override jwt.secret_key from PHYTOMNI_JWT_SECRET only when the env var is
	// non-empty. Empty or unset env leaves the file value in place — same
	// contract as PHYTOMNI_DB_DSN / PHYTOMNI_REDIS_PASSWORD. (viper.BindEnv would
	// treat a set-empty env as an override and wipe the file secret.)
	applyEnvJWTSecret()

	return nil
```

Add this helper in the same file (package `utils`):

```go
func applyEnvJWTSecret() {
	if v := os.Getenv("PHYTOMNI_JWT_SECRET"); v != "" {
		viper.Set("jwt.secret_key", v)
	}
}
```

Ensure `"os"` is imported if not already. **Remove** the `_ = viper.BindEnv("jwt.secret_key", "PHYTOMNI_JWT_SECRET")` call entirely.

- [ ] **Step 4: Run JWT config tests — expect PASS**

```bash
cd apps/server && go test ./utils/ -run 'TestLoadConfigInFile_JWTSecret_' -count=1
```

Expected: all three PASS (env override, unset → file, empty → file).

- [ ] **Step 5: Update operator docs**

In `docs/deployment/configuration.md`, replace the paragraph that says do **not** set an empty value (because it overrides with a blank secret) with:

```markdown
Three secrets can be injected from the environment instead of `app.yml`, for
12-factor / secret-manager delivery. **When the env var is unset or empty, the
`app.yml` value wins** — leaving the environment untouched (or setting an empty
string) keeps file-based config. Only a **non-empty** env value overrides the file.
```

Keep the three-row table; change the JWT mechanism cell from `viper.BindEnv` to `explicit non-empty os.Getenv` (or `applyEnvJWTSecret`).

In `docs/deployment/upgrading.md` §2.1 (secret injection), replace:

```markdown
**Unset ⇒ the `app.yml` value wins ⇒ behavior byte-identical.** Set these only to
keep secrets out of the file. Do **not** set an empty value — an empty
`PHYTOMNI_JWT_SECRET` overrides the file with a blank secret.
```

with:

```markdown
**Unset or empty ⇒ the `app.yml` value wins ⇒ behavior byte-identical.** Set these
only to a non-empty value when keeping secrets out of the file. An empty
`PHYTOMNI_JWT_SECRET` is ignored (same as unset).
```

Update the JWT row mechanism from `viper.BindEnv` to match configuration.md.

If `docs/deployment/history/python-to-go-cutover.md` still warns that empty JWT env blanks the secret, add one clarifying sentence that **current** behavior ignores empty (historical note may remain as past tense) — do not rewrite the whole history doc.

- [ ] **Step 6: Commit**

```bash
git add apps/server/utils/config.go apps/server/utils/config_test.go \
  docs/deployment/configuration.md docs/deployment/upgrading.md
# If you touched the history cutover note:
# git add docs/deployment/history/python-to-go-cutover.md
git commit -m "$(cat <<'EOF'
🔒 Fix: Ignore empty PHYTOMNI_JWT_SECRET for file fallback

- BindEnv treated set-empty as an override and could wipe jwt.secret_key
- Match DSN/Redis: only a non-empty env value overrides the file secret
EOF
)"
```

---

### Task 4: Align Element Plus semver declare

**Files:**
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: lockfile already resolves `element-plus@2.10.1`
- Produces: `"element-plus": "^2.10.1"` in `dependencies`

- [ ] **Step 1: Confirm lockfile version**

```bash
cd apps/web && node -e "const l=require('./package-lock.json'); console.log(l.packages['node_modules/element-plus'].version)"
```

Expected: `2.10.1`. If different, **stop** and ask before changing the declare.

- [ ] **Step 2: Update `package.json`**

Change:

```json
"element-plus": "^2.2.28",
```

to:

```json
"element-plus": "^2.10.1",
```

Do **not** change other dependencies. Do **not** run `npm update`.

- [ ] **Step 3: Sanity — lock still matches**

```bash
cd apps/web && npm ls element-plus --depth=0
```

Expected: `element-plus@2.10.1` (or compatible under `^2.10.1`). If npm wants to rewrite the lockfile, discard lockfile churn unless the declare alone is insufficient — prefer declare-only commit.

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json
git commit -m "$(cat <<'EOF'
♻️ Reorg: Align element-plus semver declare with lockfile

- package.json still declared ^2.2.28 while the lock resolved 2.10.1
- Declare ^2.10.1 so the range matches the installed line
EOF
)"
```

---

### Task 5: Local docs banner + full gate

**Files:**
- Modify (local, gitignored): `.codex/specs/2026-07-10-dependency-research-remaining-inventory-design.md`
- Modify (local, gitignored): `.codex/specs/2026-07-06-development-roadmap.md`
- Optional commit: this plan file if not already tracked

**Interfaces:**
- Consumes: Tasks 1–4 green
- Produces: inventory Next-batch rows marked Closed; roadmap banner updated

- [ ] **Step 1: Mark Next-batch items Closed in the inventory design**

In `.codex/specs/2026-07-10-dependency-research-remaining-inventory-design.md` §2.1, mark snowflake / EP declare / JWT empty env / InitFromViperDefault as **Closed** (one-line status each). Do not rewrite Appendix A history — add “Closed” in the swimlane column or a short progress note at the top.

- [ ] **Step 2: Update roadmap progress banner**

In `.codex/specs/2026-07-06-development-roadmap.md`, note that the inventory Next batch is closed; remaining schedule starts at Go `a2ui-actions` then jwt v5.

- [ ] **Step 3: Full local gate**

```bash
./scripts/validate_web_local.sh
```

Expected: ALL GATES PASS.

- [ ] **Step 4: Commit the plan (if untracked) — not `.codex/`**

```bash
git add docs/superpowers/plans/2026-07-10-dependency-next-batch-hygiene.md
git commit -m "$(cat <<'EOF'
📝 Docs: Add dependency next-batch hygiene implementation plan

- Covers snowflake retirement, Redis Default deletion, JWT empty-env harden, EP declare align
EOF
)"
```

Do **not** `git add` `.codex/` or `AGENTS.md`.

---

## Self-Review (plan author)

| Spec §2.1 item | Task |
|---|---|
| snowflake dead code | Task 1 |
| EP package.json declare align | Task 4 |
| JWT empty-string env hardening | Task 3 |
| InitFromViperDefault / NewClientDefault dead paths | Task 2 |
| Optional pinia/vue-i18n declare | **Out of scope** (design: not required) |

Placeholder scan: none. JWT helper name `applyEnvJWTSecret` is consistent across Task 3 steps and docs. Empty-env contract matches Redis/DSN.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-10-dependency-next-batch-hygiene.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute in this session with checkpoints  

Which approach?
