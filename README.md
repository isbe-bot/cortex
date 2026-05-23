# CORTEX

CORTEX is a local-first task operations core for AI-agent work.

It began as a lightweight SQLite + Node.js CLI for ISBE agent coordination. It is now being evolved with the same principles established for ENGRAM: local authority, durable SQLite state, auditability, clear operator tooling, service/API readiness, portable installs, and future Mission Control integration.

> ENGRAM governs memory. CORTEX governs work.

## What CORTEX does

- Tracks tasks, blockers, failures, input requests, dependencies, and subtasks.
- Coordinates OpenClaw agents and subagent handoffs.
- Preserves task context across session restarts and compactions.
- Surfaces what is in progress, blocked, failed, stale, or waiting on Godfather/client input.
- Provides the future task/state substrate for per-VPS Mission Control.

## Current architecture

Current implementation:

- `cortex.js` — CLI command surface
- `lib/tasks.js` — task data access helpers
- `lib/display.js` — terminal formatting
- `db/schema.sql` — SQLite schema
- `db/cortex.db` — local operational DB, ignored by git
- `db/migrations/` — deterministic migration files tracked in `schema_migrations`
- `tests/` — Node test suite

Target v2 architecture is documented in [`DEVELOPMENT_PLAN.md`](DEVELOPMENT_PLAN.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Setup

```bash
npm install
node db/init.js
npm test
```

## Common usage

```bash
node cortex.js add "Title" --desc "description" --assign isbe --project cms --priority high --step "phase-1/init"
node cortex.js list --tree
node cortex.js get 1
node cortex.js get 1 --json
node cortex.js update 1 --status in-progress --progress 40 --step "phase-2" --notes "extra details" --session ABC123
node cortex.js block 1 "waiting on API keys"
node cortex.js fail 1 "test failure"
node cortex.js fail 1 "flaky test" --retry
node cortex.js input 1 "Need approval to proceed"
node cortex.js done 1 --notes "completed and validated"
node cortex.js cancel 1
node cortex.js status --project cortex
node cortex.js status --project cortex --json
node cortex.js orphans
node cortex.js seed
```

## Useful filters and metadata

```bash
node cortex.js add "Ship feature" --tag backend --tag api --depends 12 --due 2026-06-01
node cortex.js list --project cortex --tag backend
node cortex.js list --status blocked
node cortex.js get 42
```

## Operator docs

- [`DEVELOPMENT_PLAN.md`](DEVELOPMENT_PLAN.md) — enterprise roadmap and execution phases.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — current/target architecture.
- [`docs/RUNBOOK.md`](docs/RUNBOOK.md) — install, operations, backup/restore.
- [`configs/example.yaml`](configs/example.yaml) — future daemon/config baseline.

## Notes

- `db/init.js` initializes fresh databases and applies deterministic migrations to existing databases. Set `CORTEX_DB_PATH=/path/to/cortex.sqlite` to use a non-default database path.
- Critical commands support `--json` for automation: `add`, `list`, `get`, `update`, `block`, `fail`, `input`, `done`, `cancel`, `status`, `stats`, and `overdue`.
- Default `list` output excludes tasks that are `done` or `cancelled` unless a `--status` filter is specified.
- `--tree` output indents subtasks beneath parent tasks.
- `status` highlights needs-input, failed, blocked, in-progress, todo, and tasks done today.
- Local database files are intentionally ignored by git.

## Future direction

CORTEX v2 will add:

- `cortexd` daemon and `cortexctl` CLI split;
- scoped local HTTP API;
- append-only task event ledger;
- explicit lifecycle transition validation;
- JSONL import/export and backup/restore;
- native OpenClaw plugin;
- Mission Control UI contracts;
- optional multi-VPS sync.
