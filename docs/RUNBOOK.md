# CORTEX Operator Runbook

## Install today

```bash
git clone git@github-isbe:isbe-bot/cortex.git ~/projects/cortex
cd ~/projects/cortex
npm install
node db/init.js
npm test
node cortex.js status
```

Use a non-default DB path when needed:

```bash
CORTEX_DB_PATH=~/.local/share/cortex/cortex.sqlite node db/init.js
CORTEX_DB_PATH=~/.local/share/cortex/cortex.sqlite node cortex.js status
```

## Daily operations

```bash
node cortex.js status
node cortex.js list --status in-progress
node cortex.js list --status blocked
node cortex.js list --status needs-input
node cortex.js orphans
```

## Daemon/API operations

```bash
# start daemon with scoped auth
CORTEX_API_TOKENS='reader:read;writer:read,write' node cortexd.js

# health (public)
curl -s http://127.0.0.1:8777/v1/health

# status/tasks (auth)
curl -s -H 'Authorization: Bearer reader' http://127.0.0.1:8777/v1/status
curl -s -H 'Authorization: Bearer reader' http://127.0.0.1:8777/v1/tasks
```

Env vars:

- `CORTEX_API_HOST` (default `127.0.0.1`)
- `CORTEX_API_PORT` (default `8777`)
- `CORTEX_API_AUTH_REQUIRED` (`1` default, `0` to disable)
- `CORTEX_API_TOKENS` (`token:scope1,scope2;token2:scope`)
- `CORTEX_API_TOKEN` + `CORTEX_API_SCOPES` (single-token shortcut)

## Task lifecycle

```bash
node cortex.js add "Title" --desc "Details" --assign isbe --project cortex --priority high
node cortex.js update 1 --status in-progress --progress 25 --step "implementation"
node cortex.js block 1 "Waiting on approval"
node cortex.js input 1 "Need decision from Godfather"
node cortex.js done 1 --notes "Validated with npm test"
```

## Backup

Current CORTEX stores local state in `db/cortex.db`.

```bash
mkdir -p ~/backups/cortex
sqlite3 db/cortex.db ".backup '$HOME/backups/cortex/cortex-$(date -u +%Y%m%dT%H%M%SZ).sqlite'"
```

Future `cortexctl backup` should wrap this safely.

## Restore

Stop any running users of the DB first.

```bash
cp db/cortex.db db/cortex.db.pre-restore.$(date -u +%Y%m%dT%H%M%SZ)
cp ~/backups/cortex/<backup>.sqlite db/cortex.db
node cortex.js status
```

## Migrations

`db/init.js` initializes fresh databases and applies deterministic migrations to existing databases. Applied migration checksums are stored in `schema_migrations`.

```bash
node db/init.js
sqlite3 db/cortex.db 'select version, filename, applied_at from schema_migrations order by version;'
```

## Automation / JSON output

Use `--json` for automation-safe output:

```bash
node cortex.js add "Smoke" --project cortex --json
node cortex.js get 1 --json
node cortex.js status --project cortex --json
node cortex.js stats --json
```

## Health checks

```bash
npm test
node cortex.js status
node cortex.js status --json
node cortex.js list --tree
```

## Enterprise migration notes

Before deploying to client VPS environments, CORTEX needs:

- deterministic migrations;
- config/data paths outside the repo;
- daemon/API mode;
- scoped auth;
- backup/export/import commands;
- systemd service;
- OpenClaw plugin integration.
