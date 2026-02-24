# CORTEX

CORTEX is a lightweight agent coordination and task tracking system for ISBE. It uses a local SQLite database and a simple Node.js CLI to track tasks, surface blockers, and prevent lost sessions.

## Setup

```bash
npm install
node db/init.js
```

## Usage

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
node cortex.js seed
```

## Notes

- Default `list` output excludes tasks that are `done` or `cancelled` unless a `--status` filter is specified.
- `--tree` output indents subtasks beneath parent tasks.
- `status` highlights needs-input, failed, blocked, in-progress, todo, and tasks done today.
