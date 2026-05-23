# CORTEX Architecture

CORTEX is the local task operations core for AI-agent work.

It is designed to be deployed per VPS/client environment and remain authoritative locally, with optional upward sync to Mission Control.

## Current state

Current implementation is a Node.js CLI + minimal daemon, both backed by SQLite:

- `cortex.js` — CLI command surface
- `cortexd.js` — HTTP daemon entrypoint
- `lib/tasks.js` — task data access helpers
- `lib/api/*` — API routes, scoped auth, validation, envelopes
- `lib/display.js` — terminal formatting
- `db/schema.sql` — SQLite schema
- `db/cortex.db` — local operational database, ignored by git

Phase 2 introduces service-mode access (`/v1/health`, `/v1/status`, `/v1/tasks`) with scoped token auth and stable response envelopes.

## Target state

```text
Operator / OpenClaw / Agents
        │
        ├── cortexctl CLI
        ├── OpenClaw plugin
        └── Mission Control local UI
                  │
                  ▼
              cortexd
                  │
        ┌─────────┼─────────┐
        │         │         │
   lifecycle   reports     sync/export
    service    service      service
        │         │         │
        └─────────┴─────────┘
                  │
                  ▼
          SQLite operational ledger
```

## Local-first deployment

Each VPS should have one local CORTEX instance:

```text
~/.config/cortex/cortex.yaml
~/.local/share/cortex/cortex.sqlite
~/.local/bin/cortexd
~/.local/bin/cortexctl
```

For AILEUN/client deployments, the canonical path can become:

```text
/srv/aileun/clients/{client_slug}/runtime/db/cortex.sqlite
/srv/aileun/clients/{client_slug}/config/cortex.yaml
```

The local SQLite database is the source of truth for that environment.

## State vs event ledger

CORTEX should keep both:

- current state for fast task lookup and reporting;
- append-only events for audit, replay, sync, and debugging.

Example event:

```json
{
  "event_uid": "evt_01...",
  "task_uid": "task_01...",
  "event_type": "task.blocked",
  "actor_id": "isbe",
  "reason": "Waiting on client approval",
  "created_at": "2026-05-23T20:45:00Z"
}
```

## Integration boundaries

CORTEX should not directly execute dangerous external actions. It tracks work, state, approvals, and evidence. Execution remains owned by OpenClaw tools/agents/processes, with CORTEX receiving task/run updates.

## API principles

- HTTP API is localhost-first.
- Health endpoint can be unauthenticated for local liveness.
- Mutating endpoints require scoped tokens when auth is configured.
- API responses should be stable JSON and suitable for Mission Control.
- CLI should use the same service semantics as API.

## Sync model

Central sync should be optional and event-based:

1. local CORTEX records task events;
2. sync exporter reads unsynced events;
3. central Mission Control ingests summaries/events;
4. local CORTEX remains authoritative if central sync is unavailable.

## ENGRAM lessons applied

- Keep the core local and boring.
- Make install/backup/restore obvious.
- Use config + env overrides.
- Add health/status/report surfaces early.
- Prefer stable JSON contracts before UI work.
- Treat audit history as product functionality, not logging noise.
