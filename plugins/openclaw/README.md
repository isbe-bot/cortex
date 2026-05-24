# CORTEX OpenClaw Plugin

Native OpenClaw plugin example for the CORTEX task operations core.

The plugin talks to `cortexd` over the local HTTP API and exposes task-governance tools to OpenClaw/Mission Control without shelling out to the CLI.

## Configuration

```json
{
  "cortex": {
    "baseUrl": "http://127.0.0.1:8777",
    "token": "read-write-token",
    "timeoutMs": 10000
  }
}
```

Environment fallback:

```bash
CORTEX_BASE_URL=http://127.0.0.1:8777
CORTEX_API_TOKEN=read-write-token
```

## Tools

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

## Example workflow

1. Agent receives a substantial task.
2. Agent calls `cortex.add` with project, assignee, priority, due date/tags.
3. Agent updates progress with `cortex.update`.
4. Agent calls `cortex.block` or `cortex.input` when human attention is needed.
5. Agent calls `cortex.done` only after verification evidence exists.

ENGRAM should hold the lessons and context; CORTEX should hold current work state and audit history.
