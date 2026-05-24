const http = require('node:http');
const { URL } = require('node:url');
const pkg = require('../../package.json');
const tasks = require('../tasks');
const { ok, created, error } = require('./envelope');
const { authorize } = require('./auth');
const { parseListFilters, validateCreateTaskBody, validateUpdateTaskBody, parseTaskId } = require('./validation');
const { createRateLimiter } = require('./rate-limit');
const { createRequestLogger } = require('./logger');
const reports = require('../reports');

const STATUS_ORDER = ['todo', 'in-progress', 'needs-input', 'blocked', 'failed', 'done', 'cancelled', 'archived'];

function collectBody(req, limitBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > limitBytes) {
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    req.on('error', reject);
  });
}

function taskCounts() {
  const counts = {};
  for (const status of STATUS_ORDER) {
    counts[status] = tasks.listByStatus(status).length;
  }
  return counts;
}

function readJsonBody(raw) {
  try {
    return { value: raw ? JSON.parse(raw) : {} };
  } catch {
    return { error: 'Request body must be valid JSON' };
  }
}

function createApiServer(options = {}) {
  const startedAt = new Date();
  const auth = options.auth || { requireAuth: false, tokens: new Map() };
  const dbPath = options.dbPath || process.env.CORTEX_DB_PATH || 'db/cortex.db';
  const rateLimiter = options.rateLimiter || createRateLimiter({
    windowMs: options.rateLimitWindowMs,
    maxRequests: options.rateLimitMax,
  });
  const logRequest = options.logRequest || createRequestLogger({ enabled: options.requestLogging !== false });

  return http.createServer(async (req, res) => {
    const started = Date.now();
    const method = req.method || 'GET';
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = url.pathname;

    function finishWith(fn) {
      fn();
      logRequest({
        method,
        path: pathname,
        status: res.statusCode,
        durationMs: Date.now() - started,
        remote: req.socket?.remoteAddress,
      });
    }

    try {
      const limit = rateLimiter.check(req);
      if (!limit.ok) {
        return finishWith(() => error(
          res,
          429,
          'RATE_LIMITED',
          'Too many requests; retry later',
          { retry_after_seconds: limit.retryAfterSeconds },
          { 'retry-after': String(limit.retryAfterSeconds) }
        ));
      }

      if (method === 'GET' && (pathname === '/health' || pathname === '/v1/health')) {
        return finishWith(() => ok(res, {
          service: 'cortexd',
          status: 'ok',
          version: pkg.version,
          now: new Date().toISOString(),
        }));
      }

      if (method === 'GET' && pathname === '/v1/status') {
        const authz = authorize(req, auth, 'read');
        if (!authz.ok) {
          return finishWith(() => error(res, authz.statusCode, authz.code, authz.message, authz.details));
        }

        return finishWith(() => ok(res, {
          service: 'cortexd',
          version: pkg.version,
          started_at: startedAt.toISOString(),
          uptime_seconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
          db_path: dbPath,
          auth_required: auth.requireAuth,
          rate_limit: {
            max_requests: limit.limit,
            window_ms: options.rateLimitWindowMs || 60000,
          },
          task_counts: taskCounts(),
        }));
      }

      if (pathname === '/v1/tasks' && method === 'GET') {
        const authz = authorize(req, auth, 'read');
        if (!authz.ok) {
          return finishWith(() => error(res, authz.statusCode, authz.code, authz.message, authz.details));
        }

        const parsed = parseListFilters(url.searchParams);
        if (parsed.error) {
          return finishWith(() => error(res, 400, 'VALIDATION_ERROR', parsed.error));
        }

        const rows = tasks.listTasks({
          status: parsed.filters.status,
          assignee: parsed.filters.assignee,
          project: parsed.filters.project,
          priority: parsed.filters.priority,
          tag: parsed.filters.tag,
          excludeDoneCancelled: false,
        });

        return finishWith(() => ok(res, rows, { count: rows.length, filters: parsed.filters }));
      }

      if (pathname === '/v1/tasks' && method === 'POST') {
        const authz = authorize(req, auth, 'write');
        if (!authz.ok) {
          return finishWith(() => error(res, authz.statusCode, authz.code, authz.message, authz.details));
        }

        const raw = await collectBody(req);
        const body = readJsonBody(raw);
        if (body.error) {
          return finishWith(() => error(res, 400, 'INVALID_JSON', body.error));
        }

        const validated = validateCreateTaskBody(body.value);
        if (validated.error) {
          return finishWith(() => error(res, 400, 'VALIDATION_ERROR', validated.error));
        }

        const id = tasks.createTask(validated.value);
        return finishWith(() => created(res, tasks.getTask(id)));
      }

      const taskPathMatch = pathname.match(/^\/v1\/tasks\/(\d+)$/);
      if (taskPathMatch && method === 'GET') {
        const authz = authorize(req, auth, 'read');
        if (!authz.ok) {
          return finishWith(() => error(res, authz.statusCode, authz.code, authz.message, authz.details));
        }

        const id = parseTaskId(taskPathMatch[1]);
        if (!id) {
          return finishWith(() => error(res, 400, 'VALIDATION_ERROR', 'Task id must be a positive integer'));
        }

        const row = tasks.getTask(id);
        if (!row) {
          return finishWith(() => error(res, 404, 'NOT_FOUND', `Task #${id} not found`));
        }

        return finishWith(() => ok(res, row));
      }

      if (taskPathMatch && method === 'PATCH') {
        const authz = authorize(req, auth, 'write');
        if (!authz.ok) {
          return finishWith(() => error(res, authz.statusCode, authz.code, authz.message, authz.details));
        }

        const id = parseTaskId(taskPathMatch[1]);
        const existing = tasks.getTask(id);
        if (!existing) {
          return finishWith(() => error(res, 404, 'NOT_FOUND', `Task #${id} not found`));
        }

        const raw = await collectBody(req);
        const body = readJsonBody(raw);
        if (body.error) {
          return finishWith(() => error(res, 400, 'INVALID_JSON', body.error));
        }

        const validated = validateUpdateTaskBody(body.value);
        if (validated.error) {
          return finishWith(() => error(res, 400, 'VALIDATION_ERROR', validated.error));
        }

        const changed = tasks.updateTask(id, validated.value, { source: 'api' });
        return finishWith(() => ok(res, tasks.getTask(id), { changed }));
      }

      if (taskPathMatch && method === 'DELETE') {
        const authz = authorize(req, auth, 'write');
        if (!authz.ok) {
          return finishWith(() => error(res, authz.statusCode, authz.code, authz.message, authz.details));
        }

        const id = parseTaskId(taskPathMatch[1]);
        const existing = tasks.getTask(id);
        if (!existing) {
          return finishWith(() => error(res, 404, 'NOT_FOUND', `Task #${id} not found`));
        }

        tasks.cancelTask(id, 'cancelled via API');
        return finishWith(() => ok(res, tasks.getTask(id)));
      }

      const taskActionMatch = pathname.match(/^\/v1\/tasks\/(\d+)\/(block|done|input)$/);
      if (taskActionMatch && method === 'POST') {
        const authz = authorize(req, auth, 'write');
        if (!authz.ok) {
          return finishWith(() => error(res, authz.statusCode, authz.code, authz.message, authz.details));
        }

        const id = parseTaskId(taskActionMatch[1]);
        const action = taskActionMatch[2];
        const existing = tasks.getTask(id);
        if (!existing) {
          return finishWith(() => error(res, 404, 'NOT_FOUND', `Task #${id} not found`));
        }

        const raw = await collectBody(req);
        const body = readJsonBody(raw);
        if (body.error) {
          return finishWith(() => error(res, 400, 'INVALID_JSON', body.error));
        }

        if (action === 'block') {
          const reason = body.value.reason;
          if (!reason || typeof reason !== 'string') {
            return finishWith(() => error(res, 400, 'VALIDATION_ERROR', 'reason is required'));
          }
          tasks.blockTask(id, reason);
        } else if (action === 'input') {
          const question = body.value.question;
          if (!question || typeof question !== 'string') {
            return finishWith(() => error(res, 400, 'VALIDATION_ERROR', 'question is required'));
          }
          tasks.requestInput(id, question);
        } else if (action === 'done') {
          tasks.completeTask(id);
        }

        return finishWith(() => ok(res, tasks.getTask(id)));
      }

      // Mission Control report endpoints
      if (method === 'GET' && pathname === '/v1/reports/summary') {
        const authz = authorize(req, auth, 'read');
        if (!authz.ok) return finishWith(() => error(res, authz.statusCode, authz.code, authz.message, authz.details));
        return finishWith(() => ok(res, reports.getSummary()));
      }

      if (method === 'GET' && pathname === '/v1/reports/blocked') {
        const authz = authorize(req, auth, 'read');
        if (!authz.ok) return finishWith(() => error(res, authz.statusCode, authz.code, authz.message, authz.details));
        return finishWith(() => ok(res, reports.getBlocked()));
      }

      if (method === 'GET' && pathname === '/v1/reports/overdue') {
        const authz = authorize(req, auth, 'read');
        if (!authz.ok) return finishWith(() => error(res, authz.statusCode, authz.code, authz.message, authz.details));
        return finishWith(() => ok(res, reports.getOverdue()));
      }

      return finishWith(() => error(res, 404, 'NOT_FOUND', 'Endpoint not found'));
    } catch (err) {
      if (err && err.message === 'BODY_TOO_LARGE') {
        return finishWith(() => error(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 64KB limit'));
      }

      return finishWith(() => error(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred'));
    }
  });
}

module.exports = {
  createApiServer,
};
