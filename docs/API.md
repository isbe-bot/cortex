# CORTEX Daemon API (Phase 2)

Local daemon: `cortexd.js`
Base URL: `http://127.0.0.1:8777`
API version: `/v1`

## Auth model

Scoped Bearer token auth.

### Env configuration

```bash
# multi-token format
CORTEX_API_TOKENS='reader:read;writer:read,write;admin:*'

# optional shortcut for one token
CORTEX_API_TOKEN='local-dev-token'
CORTEX_API_SCOPES='read,write'

# disable auth for local smoke only (not recommended)
CORTEX_API_AUTH_REQUIRED=0
```

### Supported scopes

- `read`
- `write`
- `assign`
- `approve`
- `sync`
- `admin`

`admin` implies all scopes.

Use header:

```http
Authorization: Bearer <token>
```

## Response envelopes

### Success

```json
{
  "success": true,
  "data": {},
  "meta": {}
}
```

### Error

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "title is required"
  }
}
```

## Endpoints

## Rate limiting and request logs

The daemon applies a small in-memory per-client rate limit before route handling. Defaults:

- `CORTEX_API_RATE_LIMIT_WINDOW_MS=60000`
- `CORTEX_API_RATE_LIMIT_MAX=120`

Rate limited requests return:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests; retry later",
    "details": { "retry_after_seconds": 60 }
  }
}
```

Request logging is enabled by default and writes JSON lines to stderr. Disable with `CORTEX_API_REQUEST_LOGGING=false`.

## `GET /v1/health`

Public liveness check.

```bash
curl -s http://127.0.0.1:8777/v1/health
```

## `GET /v1/status` (scope: `read`)

Daemon + DB + task count summary.

```bash
curl -s -H 'Authorization: Bearer reader' http://127.0.0.1:8777/v1/status
```

## `GET /v1/tasks` (scope: `read`)

List tasks with optional filters:

- `status`
- `assignee`
- `project`
- `priority`
- `tag`

```bash
curl -s -H 'Authorization: Bearer reader' \
  'http://127.0.0.1:8777/v1/tasks?project=cortex&status=in-progress'
```

## `GET /v1/tasks/:id` (scope: `read`)

Fetch one task by integer ID.

```bash
curl -s -H 'Authorization: Bearer reader' http://127.0.0.1:8777/v1/tasks/287
```

## `POST /v1/tasks` (scope: `write`)

Create a task.

Request body fields:

- required: `title`
- optional: `description`, `assignee`, `project`, `priority`, `step`, `tags`, `due_at`

```bash
curl -s -X POST -H 'Authorization: Bearer writer' \
  -H 'Content-Type: application/json' \
  -d '{"title":"API created task","project":"cortex","priority":"high","tags":["api","phase2"]}' \
  http://127.0.0.1:8777/v1/tasks
```

## `PATCH /v1/tasks/:id` (scope: `write`)

Update mutable task fields. Supported fields include `title`, `description`, `status`, `progress`, `assignee`, `project`, `priority`, `step`, `tags`, `due_at`, `session_key`, `blocked_reason`, `needs_input`, `input_question`, and `parent_task_id`.

```bash
curl -s -X PATCH -H 'Authorization: Bearer writer' \
  -H 'Content-Type: application/json' \
  -d '{"status":"in-progress","progress":40,"step":"implementation"}' \
  http://127.0.0.1:8777/v1/tasks/287
```

## `POST /v1/tasks/:id/block` (scope: `write`)

```bash
curl -s -X POST -H 'Authorization: Bearer writer' \
  -H 'Content-Type: application/json' \
  -d '{"reason":"waiting on API token"}' \
  http://127.0.0.1:8777/v1/tasks/287/block
```

## `POST /v1/tasks/:id/input` (scope: `write`)

```bash
curl -s -X POST -H 'Authorization: Bearer writer' \
  -H 'Content-Type: application/json' \
  -d '{"question":"Which environment should this target?"}' \
  http://127.0.0.1:8777/v1/tasks/287/input
```

## `POST /v1/tasks/:id/done` (scope: `write`)

```bash
curl -s -X POST -H 'Authorization: Bearer writer' \
  -H 'Content-Type: application/json' \
  -d '{}' \
  http://127.0.0.1:8777/v1/tasks/287/done
```

## `DELETE /v1/tasks/:id` (scope: `write`)

Cancels a task without deleting audit history.

## Error codes

- `AUTH_REQUIRED` (401)
- `AUTH_INVALID` (401)
- `AUTH_FORBIDDEN` (403)
- `INVALID_JSON` (400)
- `VALIDATION_ERROR` (400)
- `NOT_FOUND` (404)
- `PAYLOAD_TOO_LARGE` (413)
- `RATE_LIMITED` (429)
- `INTERNAL_ERROR` (500)

## Security notes

- Keep daemon bound to localhost unless explicitly needed.
- Never expose `CORTEX_API_TOKENS` in shell history/shared logs.
- Prefer read/write token split for automation.
