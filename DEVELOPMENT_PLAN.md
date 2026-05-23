# CORTEX Enterprise Development Plan

CORTEX is evolving from a lightweight local task CLI into a local-first task operations core for AI labor.

The guiding principle mirrors ENGRAM:

> ENGRAM governs memory. CORTEX governs work.

CORTEX should remain simple to operate on a single VPS, but gain the architecture needed for client installs, Mission Control integration, OpenClaw plugins, auditability, and safe distribution.

## Product positioning

CORTEX is not a generic SaaS task app. It is a per-environment operational ledger for AI-agent work:

- what work exists;
- who/what owns it;
- what state it is in;
- why it changed;
- what evidence/artifacts prove completion;
- what needs human input;
- what should sync upward to Mission Control.

## Non-negotiable principles

1. **Local-first authority** — each VPS/client install has its own local CORTEX database and can operate without central connectivity.
2. **SQLite operational ledger** — SQLite stores state, event history, relationships, and audit metadata.
3. **Daemon + CLI** — `cortexd` owns API/runtime behavior; `cortexctl` owns operator workflows.
4. **Append-only audit events** — state changes must be reconstructable from task events.
5. **Explicit lifecycle rules** — task transitions are validated, not just convention.
6. **Scoped tokens** — localhost-friendly by default, but ready for networked use.
7. **Portable movement** — JSONL import/export, backup/restore, and instance IDs are first-class.
8. **Mission Control ready** — APIs and reports should be UI-consumable before UI work begins.
9. **OpenClaw native** — OpenClaw gets a plugin/tools surface instead of shell-only integration.
10. **No fake telemetry** — health, metrics, and reports must reflect real local data.

## Target architecture

```text
OpenClaw / Agents / Operators
          │
          ├── cortexctl CLI
          │
          ├── OpenClaw Cortex plugin
          │
          ▼
      cortexd daemon
          │
          ├── HTTP API /v1
          ├── auth/scopes
          ├── lifecycle transition service
          ├── audit/event service
          ├── report/quality service
          ├── sync/export service
          ▼
   local SQLite cortex.sqlite
          │
          └── optional summary/event sync → Mission Control / central Postgres
```

## Core data model v2

Keep the local integer `id` for CLI ergonomics, but add globally safe identity fields.

### Tables

- `tasks`
  - current task state and indexed query fields
  - add `task_uid`, `instance_id`, `client_slug`, `project_slug`
- `task_events`
  - append-only lifecycle/audit log
  - every create/update/transition/comment/artifact/action records an event
- `task_dependencies`
  - existing dependency graph
- `task_artifacts`
  - file paths, URLs, commit SHAs, reports, screenshots, run outputs
- `task_comments`
  - human/agent notes separate from description
- `task_runs`
  - OpenClaw session/subagent/process linkage
- `task_approvals`
  - approval requests and outcomes
- `task_sync_state`
  - central sync cursor, last exported event, conflict markers
- `schema_migrations`
  - deterministic DB migrations

## Lifecycle model

Valid status states:

- `todo`
- `in_progress`
- `needs_input`
- `blocked`
- `failed`
- `done`
- `cancelled`
- `archived`

Transitions should be explicit and audited:

- `todo → in_progress`
- `in_progress → done`
- `in_progress → blocked`
- `blocked → in_progress`
- `in_progress → failed`
- `failed → in_progress`
- `in_progress → needs_input`
- `needs_input → in_progress`
- `done/cancelled → archived`

Future policy can allow operator/admin overrides, but overrides must be logged.

## HTTP API shape

Initial local API:

- `GET /v1/health`
- `GET /v1/status`
- `GET /v1/tasks`
- `POST /v1/tasks`
- `GET /v1/tasks/{id_or_uid}`
- `POST /v1/tasks/{id_or_uid}/transition`
- `POST /v1/tasks/{id_or_uid}/log`
- `POST /v1/tasks/{id_or_uid}/artifacts`
- `GET /v1/tasks/{id_or_uid}/events`
- `GET /v1/reports/quality`
- `GET /metrics`

Auth scopes:

- `read`
- `write`
- `assign`
- `approve`
- `sync`
- `admin`

## OpenClaw plugin target

Tools:

- `cortex_status`
- `cortex_add`
- `cortex_get`
- `cortex_update`
- `cortex_transition`
- `cortex_done`
- `cortex_block`
- `cortex_input`
- `cortex_next`
- `cortex_report`

The plugin should use HTTP first and CLI fallback, matching the ENGRAM integration pattern.

## Mission Control contract

Mission Control should consume CORTEX through stable data contracts:

- work queue / kanban cards;
- blocker list;
- needs-input inbox;
- agent workload;
- task detail inspector;
- event/audit timeline;
- dependency graph;
- stale/orphaned run detector;
- per-VPS/client task health summary.

No dashboard should be built until these contracts are stable enough to avoid throwaway UI.

## Development phases

### Phase 1 — Repo hardening and operator baseline

- [x] Strengthen `.gitignore`.
- [x] Commit existing metadata/lifecycle CLI helpers.
- [ ] Add CI test workflow.
- [ ] Add architecture/development/runbook docs.
- [ ] Add config example and repo install prompt.
- [x] Add JSON output mode to critical commands.
- [x] Make schema/migrations deterministic and idempotent.

### Phase 2 — Identity, audit, lifecycle

- Add `task_uid`, `instance_id`, `client_slug`, `project_slug`.
- Add append-only `task_events`.
- Refactor status changes into a lifecycle service.
- Validate transitions.
- Emit task events for create/update/block/fail/input/done/cancel/archive.
- Add artifacts/comments/runs tables.

### Phase 3 — `cortexctl` and packaging

- Split CLI into `cmd/cortexctl` or package bin entry.
- Add `cortexctl init`.
- Add config file support with env overrides.
- Add backup/restore.
- Add canonical JSONL import/export.
- Add retention/archive report.
- Add release artifacts and install script.

### Phase 4 — `cortexd` daemon/API

- Add local HTTP server.
- Add scoped API tokens.
- Add health/status/metrics endpoints.
- Add task CRUD/lifecycle endpoints.
- Add report endpoints.
- Add systemd service.
- Add Dockerfile/docker-compose.

### Phase 5 — OpenClaw native integration

- Add native OpenClaw plugin package.
- Register tools for task operations.
- Add prompt/corpus supplements if useful.
- Add plugin tests and smoke script.
- Document safe fallback behavior.

### Phase 6 — Multi-VPS sync and Mission Control

- Add instance identity.
- Add event export cursor.
- Add sync package for central ingestion.
- Add conflict policy.
- Define Mission Control JSON contracts.
- Add per-VPS quality/status report.

## Quality gates

Every slice should pass:

```bash
npm test
node cortex.js status
node cortex.js status --json
node cortex.js list --project cortex
```

Future gates:

```bash
npm run lint
npm run typecheck
npm run smoke
cortexctl health --config ./configs/example.yaml
```

## Definition of done for CORTEX v2 foundation

CORTEX can be installed on a fresh VPS, started as a local service, used from OpenClaw through a plugin, backed up/restored/exported, and inspected through stable API/report contracts without relying on a central server.
