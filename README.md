# Phytomni-Web

A web application for agricultural knowledge management: a Vue 3 frontend
(`apps/web/`) talking to a Go API gateway (`apps/server/`). The gateway
serves `/query` by proxying to the Phytomni-Bot service over HTTP, and serves
`/v1/*` + `/auth/*` for auth, users, query history, gene data, and async
tasks.

## Prerequisites

### apps/server (Go API gateway)

- Go 1.23+ installed
- Python 3.12+ installed for repository quality gates
- Port 8080 available

### apps/web (frontend)

- Node 26+ and npm

## Installation & Setup

### Go gateway (apps/server)

```bash
cd apps/server
go mod tidy
go run main.go          # serve (default action) — :8080
```

Copy `config/app.yml.example` to `config/app.yml` and fill in real values
before the first run — DB, the Bot integration (`bot.base_url` /
`bot.user_api_key` / `bot.proxy_enabled`; Huawei OBS is reached only through
the Bot relay, so the Web service holds no Huawei keys), SMTP, and cron. The
gateway forwards `/query` to Phytomni-Bot; the in-repo Python MCP service that
previously served `/query` has been removed.

### Frontend (apps/web)

```bash
cd apps/web
npm install
npm run dev             # Vite dev server (uses .env.dev)
```

The dev server proxies `/query`, `/v1`, and the base API to the Go gateway
(`http://localhost:8080` by default); override per-engineer via
`VITE_DEV_PROXY_API` / `VITE_DEV_PROXY_QUERY` in `apps/web/.env.dev`.

## Port Configuration

| Service         | Port   | Description                               |
| :-------------- | :----- | :---------------------------------------- |
| Go API gateway  | 8080   | Auth, users, history, gene data, `/query` |
| Vite dev server | varies | Frontend (`VITE_PORT`)                    |

## Development

- Go code follows standard Go formatting (`gofmt`); validate with
  `gofmt -l .`, `go vet ./...`, `go build`, `go test ./...`.
- Frontend: `npm run type-check` && `npm run build` && `npm run lint`.

### Local pre-commit hooks (recommended)

After cloning, install the hooks so commits and pushes use the repository's
fail-closed quality entrypoints:

```bash
./scripts/install_git_hooks.sh
```

This sets `core.hooksPath` to `.githooks/`. The pre-commit hook runs
`scripts/scan_secrets.py --staged` (catches literal credentials), then
`make precommit` over the staged index. The pre-push hook runs `make full` by
default; set `PHYTOMNI_SCOPED_GATE=1` only when an explicit changed-range
`make prepush` check is appropriate. Other values are rejected.

The Makefile entrypoints are:

| Command          | Scope                                      |
| ---------------- | ------------------------------------------ |
| `make precommit` | staged index (the pre-commit hook)         |
| `make scoped`    | changed range for local iteration          |
| `make prepush`   | changed range for explicit pre-push opt-in |
| `make full`      | complete CI-equivalent repository gate     |
| `make push`      | `git push` wrapper; hooks still run        |

The full gate covers vue-tsc, eslint, vite build, gofmt, go vet, go build, go
test, vitest/coverage, strict i18n, visual contract, A2UI readiness, Bot/Web
compatibility, and activation evidence. Local checks do not prove external
GitHub required checks, branch-protection policy, CODEOWNERS review, Bot-owner
acceptance, staging/live smoke evidence, or operations sign-off. This
quality-toolchain work does not modify Bot, operations, or deployment code.

The hook is opt-in (no auto-install on clone) by design — it keeps a
bare-clone workflow simple. If you skip it, the `.github/workflows/ci.yml`
GitHub Actions workflow runs the same checks on every PR and push to
`main`, so anything you miss locally still gets caught before merge.

To run the full gate manually without committing:

```bash
./scripts/validate_web_local.sh
```

## Troubleshooting

### Port already in use

```bash
# Find the process using port 8080
lsof -i :8080
# Or on Windows:
netstat -ano | findstr :8080
```

### Go dependency issues

```bash
go clean -modcache
go mod tidy
```
