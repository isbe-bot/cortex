# CORTEX Mission Control API

These endpoints are designed for dashboards, monitoring, and Mission Control systems.

All endpoints require `read` scope.

## Summary

`GET /v1/reports/summary`

Returns aggregate counts and health indicators.

```json
{
  "total": 142,
  "by_status": { "todo": 38, "in-progress": 27, ... },
  "by_project": { "cortex": 51, "cms": 34, ... },
  "by_assignee": { "isbe": 67, "carmack": 29, "unassigned": 12 },
  "blocked_count": 7,
  "needs_input_count": 4,
  "overdue_count": 3
}
```

## Blocked Tasks

`GET /v1/reports/blocked`

Returns the current list of blocked tasks with their reasons.

## Overdue Tasks

`GET /v1/reports/overdue`

Returns tasks that are past their due date.

## Activity (future)

`GET /v1/reports/activity?limit=50`

Returns recent task lifecycle events (from `task_events` table).
