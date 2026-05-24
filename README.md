# CORTEX

[![CI](https://github.com/isbe-bot/cortex/actions/workflows/ci.yml/badge.svg)](https://github.com/isbe-bot/cortex/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

CORTEX is a local-first task operations core for AI-agent work.

It gives OpenClaw agents, Mission Control dashboards, and operator scripts a durable SQLite-backed ledger for task state, handoffs, blockers, dependencies, audit trails, and lifecycle governance.

> **ENGRAM governs memory. CORTEX governs work.**

## Why CORTEX exists

AI agents lose work when task state lives only in chat history, shell scrollback, or somebody's memory. CORTEX gives agents and operators a small, local operational ledger for:

- what work exists;
- who or what owns it;
- what state it is in;
- why it changed;
- what is blocked, failed, stale, or waiting for human input;
- what evidence proves completion.

CORTEX is not a generic SaaS task app. It is infrastructure for AI labor: local-first, scriptable, auditable, and easy to run on a VPS.

## Recommended quick start: Docker Compose

Docker Compose is the easiest deployment path for a VPS or Mission Control host.

```bash
git clone https://github.com/isbe-bot/cortex.git
cd cortex
cp configs/cortex.env.example configs/cortex.env
```

Edit `configs/cortex.env`:

```bash
CORTEX_DB_PATH=/var/lib/cortex/cortex.db
CORTEX_API_HOST=0.0.0.0
CORTEX_API_PORT=8777
CORTEX_API_AUTH_REQUIRED=true
CORTEX_API_TOKENS='reader:read;writer:read,write'
CORTEX_API_RATE_LIMIT_WINDOW_MS=60000
CORTEX_API_RATE_LIMIT_MAX=120
CORTEX_API_REQUEST_LOGGING=true
```

Start it:

```bash
docker compose up -d
docker compose logs -f cortex
curl -s http://127.0.0.1:8777/v1/health
```

The daemon auto-initializes the database on first boot. Keep it bound to localhost or behind a trusted reverse proxy/VPN unless you explicitly harden the deployment.

## ENGRAM + CORTEX together

Use both systems deliberately:

- **ENGRAM** stores durable memory: user preferences, decisions, standards, lessons, semantic history.
- **CORTEX** stores operational state: tasks, owners, blockers, progress, lifecycle events, completion evidence.

Agent loop:

1. Search ENGRAM before relying on prior context.
2. Create/resume a CORTEX task for substantial work.
3. Update CORTEX while work progresses.
4. Use `blocked`, `failed`, or `needs-input` instead of hiding problems in chat.
5. Mark `done` only after test/build/inspection evidence exists.
6. Distill reusable lessons back into ENGRAM.

See [`docs/ENGRAM-CORTEX.md`](docs/ENGRAM-CORTEX.md).

## Features

- SQLite-backed task ledger.
- Stable task identity (`task_uid`, `instance_id`, `client_slug`, `project_slug`) for local authority and portability.
- Append-only `task_events` audit ledger for lifecycle, retention, import, and restore traces.
- Lifecycle transition validation with explicit command-level event emission (`create/update/block/fail/input/done/cancel/archive/import/restore/retention`).
- CLI for task creation, status, blockers, retries, input requests, dependencies, subtasks, recurring metadata, and due dates.
- JSON output for automation-safe workflows.
- Canonical JSONL import/export for portable task data.
- Operator backup/restore and retention/compaction commands.
- Deterministic migrations tracked in `schema_migrations`.
- Minimal `cortexd` HTTP API with scoped bearer-token auth.
- API rate limiting and structured request logs.
- Stable response envelopes for UI/plugin consumers.
- Expanded OpenClaw plugin example.
- Node test suite and GitHub Actions CI.

## Local CLI quick start

```bash
npm install
cortex init
npm test
```

Create and inspect a task:

```bash
cortex add "Ship first feature" --project cortex --assign isbe --priority high
cortex list --project cortex
cortex status
```

Use a custom database path:

```bash
CORTEX_DB_PATH=~/.local/share/cortex/cortex.sqlite cortex init
CORTEX_DB_PATH=~/.local/share/cortex/cortex.sqlite cortex status
```

## Daemon API

Start manually:

```bash
cortex init
CORTEX_API_TOKENS='reader:read;writer:read,write' npm run daemon
```

Config env vars:

- `CORTEX_DB_PATH` — SQLite path; default `./db/cortex.db`.
- `CORTEX_API_HOST` — bind host; default `127.0.0.1`.
- `CORTEX_API_PORT` — bind port; default `8777`.
- `CORTEX_API_AUTH_REQUIRED` — `true`/`1` by default; use `0` only for local smoke testing.
- `CORTEX_API_TOKENS` — scoped token list, e.g. `reader:read;writer:read,write`.
- `CORTEX_API_TOKEN` + `CORTEX_API_SCOPES` — single-token shortcut.
- `CORTEX_API_RATE_LIMIT_WINDOW_MS` — default `60000`.
- `CORTEX_API_RATE_LIMIT_MAX` — default `120`.
- `CORTEX_API_REQUEST_LOGGING` — default `true`.

Current endpoints:

- `GET /v1/health` — public liveness check.
- `GET /v1/status` — requires `read`.
- `GET /v1/tasks` — requires `read`.
- `GET /v1/tasks/:id` — requires `read`.
- `POST /v1/tasks` — requires `write`.
- `PATCH /v1/tasks/:id` — requires `write`.
- `DELETE /v1/tasks/:id` — cancel task, requires `write`.
- `POST /v1/tasks/:id/block` — requires `write`.
- `POST /v1/tasks/:id/input` — requires `write`.
- `POST /v1/tasks/:id/done` — requires `write`.
- `GET /v1/reports/summary` — Mission Control summary, requires `read`.
- `GET /v1/reports/blocked` — blocked tasks, requires `read`.
- `GET /v1/reports/overdue` — overdue tasks, requires `read`.

Example:

```bash
curl -s http://127.0.0.1:8777/v1/health
curl -s -H 'Authorization: Bearer reader' http://127.0.0.1:8777/v1/status
curl -s -X POST \
  -H 'Authorization: Bearer writer' \
  -H 'Content-Type: application/json' \
  -d '{"title":"API created task","project":"cortex","priority":"high"}' \
  http://127.0.0.1:8777/v1/tasks
```

All API responses use stable envelopes:

```json
{ "success": true, "data": {}, "meta": {} }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "title is required" } }
```

See [`docs/API.md`](docs/API.md) and [`docs/OPENAPI.md`](docs/OPENAPI.md).

## CLI usage

Common commands:

```bash
cortex add "Title" --desc "description" --assign isbe --project cms --priority high --step "phase-1/init"
cortex list --tree
cortex get 1
cortex update 1 --status in-progress --progress 40 --step "phase-2" --notes "extra details" --session ABC123
cortex block 1 "waiting on API keys"
cortex fail 1 "test failure"
cortex fail 1 "flaky test" --retry
cortex input 1 "Need approval to proceed"
cortex done 1 --notes "completed and validated"
cortex cancel 1
cortex status --project cortex
cortex orphans
```

Automation-safe JSON:

```bash
cortex add "JSON task" --project cortex --json
cortex list --project cortex --json
cortex get 1 --json
cortex status --project cortex --json
cortex stats --json
```

Critical commands with JSON output include `add`, `list`, `get`, `update`, `block`, `fail`, `input`, `done`, `cancel`, `status`, `stats`, `overdue`, `backup`, `restore`, `import`, and `retention`.

## OpenClaw integration

The expanded example plugin lives in [`plugins/openclaw`](plugins/openclaw).

It exposes read/reporting tools (`cortex.status`, `cortex.list`, `cortex.report.summary`, etc.) and write/lifecycle tools (`cortex.add`, `cortex.update`, `cortex.block`, `cortex.done`, `cortex.input`, `cortex.cancel`).

## Security model

CORTEX is localhost-first by default.

- Bind to `127.0.0.1` unless you intentionally expose it behind proper network controls.
- Use scoped bearer tokens for API access.
- Prefer read-only tokens for dashboards and reporting consumers.
- Use write tokens only for trusted agents/tools.
- Keep request logging on for operational auditability.
- Do not commit local database files, `.env` files, secrets, or credentials.

## Operator docs

- [`DEVELOPMENT_PLAN.md`](DEVELOPMENT_PLAN.md) — enterprise roadmap and execution phases.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — current and target architecture.
- [`docs/RUNBOOK.md`](docs/RUNBOOK.md) — install, operations, backup, and restore.
- [`docs/API.md`](docs/API.md) — daemon API and auth scopes.
- [`docs/ENGRAM-CORTEX.md`](docs/ENGRAM-CORTEX.md) — memory/work operating model.
- [`docs/AGENT_INTEGRATION.md`](docs/AGENT_INTEGRATION.md) — OpenClaw/agent task lifecycle guide.
- [`docs/OPENAPI.md`](docs/OPENAPI.md) — lightweight OpenAPI sketch.
- [`configs/example.yaml`](configs/example.yaml) — future daemon/config baseline.

## Development

```bash
npm install
npm test
node --check cortex.js
node --check cortexd.js
```

Before opening a PR or pushing a release, verify:

```bash
npm test
cortex status
cortex status --json
```

## Roadmap

High-value next steps:

- machine-readable `openapi.json` generated from route metadata;
- persistent rate-limit state or reverse-proxy integration for exposed deployments;
- richer event query endpoints for audit timelines;
- first-class webhook/event stream for Mission Control;
- optional multi-VPS sync.

## License

MIT. See [`LICENSE`](LICENSE).
