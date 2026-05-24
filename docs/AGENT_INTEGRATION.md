# CORTEX Agent Integration Guide

CORTEX is the operational ledger for agent work. Agents use it to make work visible, auditable, recoverable, and safe across chat turns, subagents, restarts, and VPS operations.

> ENGRAM remembers context. CORTEX governs current work.

## Core rules

1. **Create or resume a CORTEX task for substantial work.**
   - Substantial means implementation, debugging, deployment, review, publishing, multi-step research, or anything that may span turns/sessions.
   - Tiny one-shot answers do not need a task.

2. **Keep CORTEX state truthful.**
   - Do not leave work `in-progress` when it is blocked, failed, waiting on input, or done.
   - Update `step` and `progress` when the work meaningfully advances.

3. **Use blockers and input explicitly.**
   - `blocked` means progress cannot continue without an external condition changing.
   - `needs-input` means a human decision is required.
   - `failed` means the attempt failed and needs retry/replan.

4. **Mark done only with evidence.**
   - Include test/build/lint output, screenshots, HTTP checks, git commit hashes, or named inspection evidence.

5. **ENGRAM gets lessons; CORTEX gets operational state.**
   - Do not bury active blockers in memory.
   - Do not use CORTEX as long-term semantic memory.

## When to create a task

Create a task when any of these are true:

- Work changes files, repos, servers, databases, schedules, or external systems.
- Work needs tests, review, or deployment.
- Work may be delegated to a subagent.
- Work may be interrupted and resumed later.
- The user asks for status tracking, planning, or project progress.

Skip CORTEX for:

- Simple explanations.
- One-off commands with no follow-up state.
- Pure chat with no durable operational consequence.

## CLI workflow

### Create

```bash
cortex add "Implement API health endpoint" \
  --project cortex \
  --assign carmack \
  --priority high \
  --tag api \
  --due 2026-06-01
```

Use clear titles. Prefer verb + object: `Implement`, `Fix`, `Review`, `Publish`, `Deploy`, `Document`.

### Claim / start

```bash
cortex update 42 \
  --status in-progress \
  --progress 10 \
  --step "repo-inspection" \
  --session "agent:carmack:subagent:..."
```

Set `session_key` when a subagent or separate worker owns the task.

### Update progress

```bash
cortex update 42 --progress 45 --step "tests-red"
cortex update 42 --progress 70 --step "implementation-complete"
```

Progress is an operator hint, not a promise. Use it sparingly and honestly.

### Add notes/evidence

```bash
cortex update 42 --notes "npm test passes; added api-daemon.test.js coverage for /v1/health"
```

Notes are best for durable evidence and short audit details. Long design rationale belongs in docs and/or ENGRAM.

### Block

```bash
cortex block 42 "waiting for API token from operator"
```

Use `blocked` when work cannot safely continue without an external dependency.

### Request input

```bash
cortex input 42 "Should staging deploy target srv1391721 or a new VPS?"
```

Use `needs-input` for a specific human decision. Ask one clear question.

### Fail / retry

```bash
cortex fail 42 "migration test fails on missing legacy column"
cortex fail 42 "retrying after schema fix" --retry
```

A failure is not shameful. Silent failure is. Record the reason.

### Complete

```bash
cortex done 42 --notes "Committed 0601fc3; npm test 14/14; plugin client tests 2/2; pushed origin/main."
```

Only complete after verification evidence exists.

## JSON automation

Most critical commands support `--json`.

```bash
cortex add "JSON-safe task" --project cortex --json
cortex list --status in-progress --json
cortex get 42 --json
cortex status --project cortex --json
```

Use JSON output in scripts, OpenClaw tooling, Mission Control adapters, and subagent orchestration.

## HTTP API workflow

Run the daemon:

```bash
CORTEX_API_TOKENS='reader:read;writer:read,write' cortexd
```

Create task:

```bash
curl -s -X POST \
  -H 'Authorization: Bearer writer' \
  -H 'Content-Type: application/json' \
  -d '{"title":"API-created task","project":"cortex","priority":"high"}' \
  http://127.0.0.1:8777/v1/tasks
```

Update task:

```bash
curl -s -X PATCH \
  -H 'Authorization: Bearer writer' \
  -H 'Content-Type: application/json' \
  -d '{"status":"in-progress","progress":40,"step":"implementation"}' \
  http://127.0.0.1:8777/v1/tasks/42
```

Lifecycle actions:

```bash
curl -s -X POST -H 'Authorization: Bearer writer' \
  -H 'Content-Type: application/json' \
  -d '{"reason":"waiting on deploy window"}' \
  http://127.0.0.1:8777/v1/tasks/42/block

curl -s -X POST -H 'Authorization: Bearer writer' \
  -H 'Content-Type: application/json' \
  -d '{"question":"Which VPS should receive this?"}' \
  http://127.0.0.1:8777/v1/tasks/42/input

curl -s -X POST -H 'Authorization: Bearer writer' \
  -H 'Content-Type: application/json' \
  -d '{}' \
  http://127.0.0.1:8777/v1/tasks/42/done
```

## OpenClaw tool contract

The OpenClaw plugin exposes these tools:

Read/reporting:

- `cortex.health`
- `cortex.status`
- `cortex.list`
- `cortex.get`
- `cortex.report.summary`
- `cortex.report.blocked`
- `cortex.report.overdue`
- `cortex.next`

Write/lifecycle:

- `cortex.add`
- `cortex.update`
- `cortex.block`
- `cortex.done`
- `cortex.input`
- `cortex.cancel`

Recommended OpenClaw behavior:

1. Use `cortex.status` or `cortex.next` before claiming background work.
2. Use `cortex.add` before spawning a specialist subagent for substantial work.
3. Store the subagent/session key on the task with `cortex.update`.
4. Use `cortex.block` / `cortex.input` rather than ending with vague status.
5. Use `cortex.done` only after verification.

## Subagent handoff protocol

Parent/orchestrator:

1. Create a CORTEX task.
2. Prepare a brief with objective, scope, files, constraints, and verification gates.
3. Spawn the subagent.
4. Update task `session_key`.
5. Monitor completion events.
6. Review output and close/update the task.

Subagent:

1. Read the brief.
2. Verify repo state before changes.
3. Keep changes scoped to the task.
4. Run the smallest meaningful test/build/lint gate.
5. Return evidence, changed files, risks, and next steps.

Example parent flow:

```bash
TASK_JSON=$(cortex add "Fix upload validation" --project files --assign carmack --priority high --json)
TASK_ID=$(node -e 'let x="";process.stdin.on("data",d=>x+=d).on("end",()=>console.log(JSON.parse(x).id))' <<< "$TASK_JSON")
cortex update "$TASK_ID" --status in-progress --step "delegated-to-carmack" --session "agent:carmack:subagent:..."
```

## Lifecycle states

| State | Meaning | Agent action |
| --- | --- | --- |
| `todo` | Work exists but is not active | Claim or leave queued |
| `in-progress` | Someone is actively working | Keep `step/progress/session_key` current |
| `blocked` | External dependency prevents progress | Record clear reason |
| `needs-input` | Human decision needed | Ask one specific question |
| `failed` | Attempt failed | Record failure, retry or replan |
| `done` | Complete with evidence | Include verification notes |
| `cancelled` | Intentionally stopped | Keep audit trail |
| `archived` | Retained historical record | No active work |

## Evidence standards

Good completion notes:

- `npm test 14/14; node --check cortexd.js; pushed 0601fc3 to origin/main.`
- `Playwright smoke passed for /dashboard and /settings; screenshot saved at artifacts/settings.png.`
- `curl /v1/health returned 200; systemctl status cortexd active.`

Weak completion notes:

- `done`
- `should work`
- `implemented`
- `looks fine`

## Prompt snippets for agent workspaces

Add this to agent workspace protocol docs:

```text
Use CORTEX for active work state. For substantial tasks, create or resume a task before implementation. Keep status, step, progress, blockers, input requests, session key, and completion evidence current. Mark done only after verification. ENGRAM is for memory/lessons; CORTEX is for operational state.
```

Subagent task footer:

```text
Before final response: update the CORTEX task if you were assigned one, run the smallest meaningful verification gate, and report changed files, evidence, risks, and follow-up tasks.
```

## Recovery patterns

### Interrupted work

```bash
cortex orphans
cortex get 42
cortex resume 42
```

Resume from CORTEX state, then inspect git/files live. Do not trust stale chat alone.

### Dead subagent

1. Mark task `failed` with reason or `in-progress` with retry note.
2. Preserve any useful output in task notes.
3. Spawn a fresh subagent with the CORTEX brief and current repo state.

### Deployment uncertainty

Use `needs-input` if the user must decide; use `blocked` if waiting on infrastructure or credentials.

## Mission Control expectations

Mission Control should use CORTEX APIs for:

- queue overview;
- blocked/failed/needs-input inboxes;
- active sessions and owners;
- stale/orphan detection;
- per-project progress;
- completion evidence;
- audit/event timelines.

Mission Control should not infer active work state from chat transcripts when CORTEX has authoritative task data.
