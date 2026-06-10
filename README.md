# Phytomni-Web

A web application for agricultural knowledge management: a Vue 3 frontend
(`chat-ai/`) talking to a Go API gateway (`nky_client_go/`). The gateway
serves `/query` by proxying to the Phytomni-Bot service over HTTP, and serves
`/v1/*` + `/auth/*` for auth, users, query history, gene data, and async
tasks.

## Prerequisites

### nky_client_go (Go API gateway)
- Go 1.23+ installed
- Port 8082 available

### chat-ai (frontend)
- Node 20+ and npm

## Installation & Setup

### Go gateway (nky_client_go)

```bash
cd nky_client_go
go mod tidy
go run main.go          # serve (default action) — :8082
```

Copy `config/app.yml.example` to `config/app.yml` and fill in real values
before the first run — DB, the Bot integration (`bot.base_url` /
`bot.user_api_key` / `bot.proxy_enabled`), Huawei OBS / EIHealth, SMTP, and
cron. The gateway forwards `/query` to Phytomni-Bot; the in-repo Python MCP
service that previously served `/query` has been removed.

### Frontend (chat-ai)

```bash
cd chat-ai
npm install
npm run dev             # Vite dev server (uses .env.dev)
```

The dev server proxies `/query`, `/v1`, and the base API to the Go gateway
(`http://localhost:8082` by default); override per-engineer via
`VITE_DEV_PROXY_API` / `VITE_DEV_PROXY_QUERY` in `chat-ai/.env.dev`.

## Port Configuration

| Service         | Port   | Description                                  |
| :-------------- | :----- | :------------------------------------------- |
| Go API gateway  | 8082   | Auth, users, history, gene data, `/query`    |
| Vite dev server | varies | Frontend (`VITE_PORT`)                       |

## Development

- Go code follows standard Go formatting (`gofmt`); validate with
  `gofmt -l .`, `go vet ./...`, `go build`, `go test ./...`.
- Frontend: `npm run type-check` && `npm run build` && `npm run lint`.

### Local pre-commit hooks (recommended)

After cloning, install the pre-commit hooks so every `git commit` runs the
same gates CI runs:

```bash
./scripts/install_git_hooks.sh
```

This sets `core.hooksPath` to `.githooks/`, so the pre-commit hook will run
`scripts/scan_secrets.py --staged` (catches literal credentials) and the
full G-1 / G0 / G1..G12 gates from `scripts/validate_web_local.sh`
(vue-tsc, eslint, vite build, gofmt, go vet, go build, go test, vitest)
before letting the commit land.

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
# Find the process using port 8082
lsof -i :8082
# Or on Windows:
netstat -ano | findstr :8082
```

### Go dependency issues

```bash
go clean -modcache
go mod tidy
```
