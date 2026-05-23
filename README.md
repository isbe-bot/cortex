# CORTEX

[![CI](https://github.com/isbe-bot/cortex/actions/workflows/ci.yml/badge.svg)](https://github.com/isbe-bot/cortex/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

CORTEX is a local-first task operations core for AI-agent work.

It began as a lightweight SQLite + Node.js CLI for ISBE agent coordination. It is now evolving into a durable local service for task state, handoffs, blockers, audit trails, API access, and future Mission Control/OpenClaw integrations.

> ENGRAM governs memory. CORTEX governs work.

## Why CORTEX exists

AI agents lose work when task state lives only in chat history, shell scrollback, or somebody's memory. CORTEX gives agents and operators a small, local operational ledger for:

- what work exists;
- who or what owns it;
- what state it is in;
- why it changed;
- what is blocked, failed, stale, or waiting for human input;
- what evidence proves completion.

CORTEX is not trying to be a generic SaaS task app. It is infrastructure for AI labor: local-first, scriptable, auditable, and easy to run on a VPS.

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
- Stable response envelopes for UI/plugin consumers.
- Node test suite and GitHub Actions CI.
- Docs for architecture, API, operations, and the enterprise roadmap.

## Project status

CORTEX is early but usable.

Current implementation:

- `cortex.js` — CLI command surface.
- `cortexd.js` — local daemon/API surface.
- `lib/tasks.js` — task data access helpers.
- `lib/display.js` — terminal formatting.
- `db/schema.sql` — SQLite schema.
- `db/migrations/` — deterministic SQL migrations.
- `tests/` — Node test suite.

Target v2 architecture is documented in [`DEVELOPMENT_PLAN.md`](DEVELOPMENT_PLAN.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Requirements

- Node.js 20+
- npm
- SQLite-compatible local filesystem

## Quick start

```bash
git clone https://github.com/isbe-bot/cortex.git
cd cortex
npm install
node db/init.js
npm test
```

Create and inspect a task:

```bash
node cortex.js add "Ship first feature" --project cortex --assign isbe --priority high
node cortex.js list --project cortex
node cortex.js status
```

Use a custom database path:

```bash
CORTEX_DB_PATH=~/.local/share/cortex/cortex.sqlite node db/init.js
CORTEX_DB_PATH=~/.local/share/cortex/cortex.sqlite node cortex.js status
```

## CLI usage

Common commands:

```bash
node cortex.js add "Title" --desc "description" --assign isbe --project cms --priority high --step "phase-1/init"
node cortex.js list --tree
node cortex.js get 1
node cortex.js update 1 --status in-progress --progress 40 --step "phase-2" --notes "extra details" --session ABC123
node cortex.js block 1 "waiting on API keys"
node cortex.js fail 1 "test failure"
node cortex.js fail 1 "flaky test" --retry
node cortex.js input 1 "Need approval to proceed"
node cortex.js done 1 --notes "completed and validated"
node cortex.js cancel 1
node cortex.js status --project cortex
node cortex.js orphans
```

Useful metadata and filters:

```bash
node cortex.js add "Ship feature" --tag backend --tag api --depends 12 --due 2026-06-01
node cortex.js list --project cortex --tag backend
node cortex.js list --status blocked
node cortex.js get 42
node cortex.js export --format jsonl --out ./exports/cortex-tasks.jsonl
node cortex.js import --file ./exports/cortex-tasks.jsonl
node cortex.js backup --out ./backups/cortex-$(date -u +%Y%m%dT%H%M%SZ).sqlite
node cortex.js retention report --json
```

Automation-safe JSON:

```bash
node cortex.js add "JSON task" --project cortex --json
node cortex.js list --project cortex --json
node cortex.js get 1 --json
node cortex.js status --project cortex --json
node cortex.js stats --json
```

Critical commands with JSON output include `add`, `list`, `get`, `update`, `block`, `fail`, `input`, `done`, `cancel`, `status`, `stats`, `overdue`, `backup`, `restore`, `import`, and `retention`.

## Daemon API

CORTEX ships a minimal local daemon with a versioned REST API.

Start the daemon:

```bash
node db/init.js
CORTEX_API_TOKENS='reader:read;writer:write,read' node cortexd.js
```

Config env vars:

- `CORTEX_DB_PATH` — SQLite path; default `./db/cortex.db`.
- `CORTEX_API_HOST` — bind host; default `127.0.0.1`.
- `CORTEX_API_PORT` — bind port; default `8777`.
- `CORTEX_API_AUTH_REQUIRED` — `1` default, or `0` for local smoke testing.
- `CORTEX_API_TOKENS` — scoped token list, e.g. `token:scope1,scope2;token2:scope1`.
- `CORTEX_API_TOKEN` + `CORTEX_API_SCOPES` — single-token shortcut.

Current endpoints:

- `GET /v1/health` — public liveness check.
- `GET /v1/status` — requires `read`.
- `GET /v1/tasks` — requires `read`.
- `GET /v1/tasks/:id` — requires `read`.
- `POST /v1/tasks` — requires `write`.

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

All API responses use a stable envelope:

```json
{ "success": true, "data": {} }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "title is required" } }
```

See [`docs/API.md`](docs/API.md) for request/response examples.

## Security model

CORTEX is localhost-first by default.

- Bind to `127.0.0.1` unless you intentionally expose it behind proper network controls.
- Use scoped bearer tokens for API access.
- Prefer read-only tokens for dashboards, plugins, and reporting consumers.
- Do not commit local database files, `.env` files, secrets, or credentials.

## Operator docs

- [`DEVELOPMENT_PLAN.md`](DEVELOPMENT_PLAN.md) — enterprise roadmap and execution phases.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — current and target architecture.
- [`docs/RUNBOOK.md`](docs/RUNBOOK.md) — install, operations, backup, and restore.
- [`docs/API.md`](docs/API.md) — daemon API and auth scopes.
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
node cortex.js status
node cortex.js status --json
```

## Roadmap

CORTEX v2 next steps:

- `cortexd` daemon and `cortexctl` CLI split;
- native OpenClaw plugin;
- Mission Control UI contracts;
- optional multi-VPS sync.

## License

MIT. See [`LICENSE`](LICENSE).
