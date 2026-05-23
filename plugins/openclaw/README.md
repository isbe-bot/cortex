# CORTEX OpenClaw Plugin

Native OpenClaw plugin for the CORTEX task operations core.

## Installation

```bash
cd plugins/openclaw
# copy or symlink into your OpenClaw plugins directory
```

## Configuration

In your OpenClaw config or environment:

```json
{
  "cortex": {
    "baseUrl": "http://127.0.0.1:8777",
    "token": "your-scoped-token"
  }
}
```

## Available Tools

- `cortex.status`
- `cortex.list`
- `cortex.get`
- `cortex.add`
- `cortex.update`
- `cortex.block`
- `cortex.done`
- `cortex.input`
- `cortex.next`

All tools use the CORTEX daemon HTTP API (with CLI fallback planned).

## Development

```bash
node cortex.js status
node cortex.js list --project cortex
```