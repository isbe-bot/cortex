# CORTEX OpenAPI Sketch

This is a lightweight API reference intended for humans and plugin authors. A machine-readable `openapi.json` can be generated in a later iteration.

```yaml
openapi: 3.0.3
info:
  title: CORTEX API
  version: 1.0.0
servers:
  - url: http://127.0.0.1:8777/v1
security:
  - bearerAuth: []
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
  schemas:
    Envelope:
      type: object
      properties:
        success: { type: boolean }
        data: { type: object }
        meta: { type: object }
    ErrorEnvelope:
      type: object
      properties:
        success: { type: boolean, example: false }
        error:
          type: object
          properties:
            code: { type: string }
            message: { type: string }
            details: { type: object }
paths:
  /health:
    get:
      security: []
      summary: Public liveness check
  /status:
    get:
      summary: Daemon status and task counts
      security: [{ bearerAuth: [] }]
  /tasks:
    get:
      summary: List tasks
      parameters:
        - { name: status, in: query, schema: { type: string } }
        - { name: assignee, in: query, schema: { type: string } }
        - { name: project, in: query, schema: { type: string } }
        - { name: priority, in: query, schema: { type: string } }
        - { name: tag, in: query, schema: { type: string } }
    post:
      summary: Create task
  /tasks/{id}:
    get:
      summary: Fetch task
    patch:
      summary: Update task fields
    delete:
      summary: Cancel task
  /tasks/{id}/block:
    post:
      summary: Mark task blocked
  /tasks/{id}/input:
    post:
      summary: Mark task needs input
  /tasks/{id}/done:
    post:
      summary: Mark task done
  /reports/summary:
    get:
      summary: Mission Control summary
  /reports/blocked:
    get:
      summary: Blocked tasks report
  /reports/overdue:
    get:
      summary: Overdue tasks report
```
