# ENGRAM + CORTEX Synergy

ENGRAM and CORTEX are intentionally paired but separate.

- **ENGRAM governs memory**: durable context, decisions, lessons, preferences, and semantic recall.
- **CORTEX governs work**: present-state tasks, owners, blockers, retries, lifecycle events, and proof of completion.

Do not store active task state only in ENGRAM. Do not store long-form memory only in CORTEX.

## Agent operating loop

1. **Recall** — search ENGRAM before acting on prior decisions, preferences, or project history.
2. **Register work** — create or resume a CORTEX task for substantial work.
3. **Execute** — keep the CORTEX task updated with progress, step, owner, dependencies, and session key.
4. **Escalate** — use `needs-input`, `blocked`, or `failed` states rather than burying blockers in chat.
5. **Verify** — attach completion notes/evidence before marking done.
6. **Distill** — write durable lessons back to ENGRAM after completion when there is reusable knowledge.

## What belongs where

| Information | ENGRAM | CORTEX |
| --- | --- | --- |
| User preferences | yes | no |
| Architectural decisions | yes | optional link/note |
| Active task status | no | yes |
| Blockers / human input | no | yes |
| Test/build evidence | maybe summary | yes |
| Cross-session lessons | yes | no |
| Audit events | no | yes |

## Example: feature implementation

```bash
# 1. Recall context from ENGRAM first
node scripts/memory/mem-search.js "payments architecture" --json

# 2. Create operational state in CORTEX
cortex add "Implement payment retry policy" \
  --project payments \
  --assign carmack \
  --priority high \
  --tag backend \
  --due 2026-06-01

# 3. Update while working
cortex update 42 --status in-progress --progress 30 --step "tests-red"

# 4. Escalate explicitly if blocked
cortex input 42 "Which provider account should be used for staging?"

# 5. Close only after proof
cortex done 42 --notes "npm test passed; retry policy covered by payment-retry.test.js"
```

## Mission Control pattern

Mission Control should treat CORTEX as the source of truth for operational dashboards:

- queue health;
- blocked/failed/needs-input views;
- active owners and sessions;
- overdue tasks;
- recent audit events;
- completion evidence.

Mission Control should use ENGRAM for context panes and semantic history: “why did we choose this?”, “what standards apply?”, “what did we learn last time?”
