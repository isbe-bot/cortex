const http = require('node:http');
const { URL } = require('node:url');
const pkg = require('../../package.json');
const tasks = require('../tasks');
const { ok, created, error } = require('./envelope');
const { authorize } = require('./auth');
const { parseListFilters, validateCreateTaskBody, parseTaskId } = require('./validation');

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

function createApiServer(options = {}) {
  const startedAt = new Date();
  const auth = options.auth || { requireAuth: false, tokens: new Map() };
  const dbPath = options.dbPath || process.env.CORTEX_DB_PATH || 'db/cortex.db';

  return http.createServer(async (req, res) => {
    try {
      const method = req.method || 'GET';
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = url.pathname;

      if (method === 'GET' && pathname === '/v1/health') {
        return ok(res, {
          service: 'cortexd',
          status: 'ok',
          version: pkg.version,
          now: new Date().toISOString(),
        });
      }

      if (method === 'GET' && pathname === '/v1/status') {
        const authz = authorize(req, auth, 'read');
        if (!authz.ok) {
          return error(res, authz.statusCode, authz.code, authz.message);
        }

        return ok(res, {
          service: 'cortexd',
          version: pkg.version,
          started_at: startedAt.toISOString(),
          uptime_seconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
          db_path: dbPath,
          auth_required: auth.requireAuth,
          task_counts: taskCounts(),
        });
      }

      if (pathname === '/v1/tasks' && method === 'GET') {
        const authz = authorize(req, auth, 'read');
        if (!authz.ok) {
          return error(res, authz.statusCode, authz.code, authz.message);
        }

        const parsed = parseListFilters(url.searchParams);
        if (parsed.error) {
          return error(res, 400, 'VALIDATION_ERROR', parsed.error);
        }

        const rows = tasks.listTasks({
          status: parsed.filters.status,
          assignee: parsed.filters.assignee,
          project: parsed.filters.project,
          priority: parsed.filters.priority,
          tag: parsed.filters.tag,
          excludeDoneCancelled: false,
        });

        return ok(res, rows, { count: rows.length, filters: parsed.filters });
      }

      if (pathname === '/v1/tasks' && method === 'POST') {
        const authz = authorize(req, auth, 'write');
        if (!authz.ok) {
          return error(res, authz.statusCode, authz.code, authz.message);
        }

        const raw = await collectBody(req);
        let body;
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          return error(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
        }

        const validated = validateCreateTaskBody(body);
        if (validated.error) {
          return error(res, 400, 'VALIDATION_ERROR', validated.error);
        }

        const id = tasks.createTask(validated.value);
        const createdTask = tasks.getTask(id);
        return created(res, createdTask);
      }

      const taskPathMatch = pathname.match(/^\/v1\/tasks\/(.+)$/);
      if (taskPathMatch && method === 'GET') {
        const authz = authorize(req, auth, 'read');
        if (!authz.ok) {
          return error(res, authz.statusCode, authz.code, authz.message);
        }

        const id = parseTaskId(taskPathMatch[1]);
        if (!id) {
          return error(res, 400, 'VALIDATION_ERROR', 'Task id must be a positive integer');
        }

        const row = tasks.getTask(id);
        if (!row) {
          return error(res, 404, 'NOT_FOUND', `Task #${id} not found`);
        }

        return ok(res, row);
      }

      return error(res, 404, 'NOT_FOUND', 'Endpoint not found');
    } catch (err) {
      if (err && err.message === 'BODY_TOO_LARGE') {
        return error(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 64KB limit');
      }

      return error(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    }
  });
}

module.exports = {
  createApiServer,
};
