const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.join(__dirname, '..');
const initPath = path.join(repoRoot, 'db', 'init.js');

function tmpDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-api-test-')), 'cortex.sqlite');
}

function initDb(dbPath) {
  const res = spawnSync(process.execPath, [initPath], {
    cwd: repoRoot,
    env: { ...process.env, CORTEX_DB_PATH: dbPath },
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new Error(`failed to initialize db: ${res.stderr || res.stdout}`);
  }
}

function resetRuntimeModules() {
  const modules = [
    '../db/client',
    '../lib/tasks',
    '../lib/api/server',
  ];
  for (const mod of modules) {
    const full = require.resolve(mod, { paths: [__dirname] });
    delete require.cache[full];
  }
}

async function withServer(dbPath, auth, fn) {
  const previousDbPath = process.env.CORTEX_DB_PATH;
  process.env.CORTEX_DB_PATH = dbPath;
  resetRuntimeModules();
  const { createApiServer } = require('../lib/api/server');
  const server = createApiServer({ auth, dbPath, requestLogging: false });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function request(pathname, { method = 'GET', token, body, headers = {} } = {}) {
    const res = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: {
        ...headers,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body,
    });

    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    return { status: res.status, json, text };
  }

  try {
    await fn({ request });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousDbPath === undefined) {
      delete process.env.CORTEX_DB_PATH;
    } else {
      process.env.CORTEX_DB_PATH = previousDbPath;
    }
  }
}

test('health is public; task routes enforce scoped auth', async () => {
  const dbPath = tmpDbPath();
  initDb(dbPath);

  const auth = {
    requireAuth: true,
    tokens: new Map([
      ['read-token', new Set(['read'])],
      ['write-token', new Set(['write'])],
    ]),
  };

  await withServer(dbPath, auth, async ({ request }) => {
    const health = await request('/v1/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.success, true);

    const noToken = await request('/v1/tasks');
    assert.equal(noToken.status, 401);
    assert.equal(noToken.json.error.code, 'AUTH_REQUIRED');

    const wrongScope = await request('/v1/tasks', { token: 'write-token' });
    assert.equal(wrongScope.status, 403);
    assert.equal(wrongScope.json.error.code, 'AUTH_FORBIDDEN');

    const created = await request('/v1/tasks', {
      method: 'POST',
      token: 'write-token',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'api task', project: 'cortex' }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.success, true);
    assert.equal(created.json.data.title, 'api task');

    const list = await request('/v1/tasks', { token: 'read-token' });
    assert.equal(list.status, 200);
    assert.equal(list.json.success, true);
    assert.equal(list.json.meta.count, 1);
  });
});

test('API returns safe validation and not-found envelopes', async () => {
  const dbPath = tmpDbPath();
  initDb(dbPath);

  const auth = {
    requireAuth: true,
    tokens: new Map([
      ['rw-token', new Set(['read', 'write'])],
    ]),
  };

  await withServer(dbPath, auth, async ({ request }) => {
    const invalidJson = await request('/v1/tasks', {
      method: 'POST',
      token: 'rw-token',
      headers: { 'content-type': 'application/json' },
      body: '{bad-json',
    });
    assert.equal(invalidJson.status, 400);
    assert.equal(invalidJson.json.error.code, 'INVALID_JSON');

    const badBody = await request('/v1/tasks', {
      method: 'POST',
      token: 'rw-token',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x', nope: true }),
    });
    assert.equal(badBody.status, 400);
    assert.equal(badBody.json.error.code, 'VALIDATION_ERROR');

    const missing = await request('/v1/tasks/9999', { token: 'rw-token' });
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.code, 'NOT_FOUND');
  });
});

test('API supports update and lifecycle action routes', async () => {
  const dbPath = tmpDbPath();
  initDb(dbPath);

  const auth = {
    requireAuth: true,
    tokens: new Map([
      ['rw-token', new Set(['read', 'write'])],
    ]),
  };

  await withServer(dbPath, auth, async ({ request }) => {
    const created = await request('/v1/tasks', {
      method: 'POST',
      token: 'rw-token',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'route task', project: 'cortex' }),
    });
    const id = created.json.data.id;

    const updated = await request(`/v1/tasks/${id}`, {
      method: 'PATCH',
      token: 'rw-token',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'in-progress', progress: 40, step: 'api-route' }),
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.data.status, 'in-progress');
    assert.equal(updated.json.data.progress, 40);

    const input = await request(`/v1/tasks/${id}/input`, {
      method: 'POST',
      token: 'rw-token',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Need detail?' }),
    });
    assert.equal(input.status, 200);
    assert.equal(input.json.data.status, 'needs-input');

    const block = await request(`/v1/tasks/${id}/block`, {
      method: 'POST',
      token: 'rw-token',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'waiting' }),
    });
    assert.equal(block.status, 200);
    assert.equal(block.json.data.status, 'blocked');

    const done = await request(`/v1/tasks/${id}/done`, {
      method: 'POST',
      token: 'rw-token',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(done.status, 200);
    assert.equal(done.json.data.status, 'done');
  });
});

test('API rate limits excessive requests with a structured envelope', async () => {
  const dbPath = tmpDbPath();
  initDb(dbPath);

  const auth = { requireAuth: false, tokens: new Map() };

  const previousDbPath = process.env.CORTEX_DB_PATH;
  process.env.CORTEX_DB_PATH = dbPath;
  resetRuntimeModules();
  const { createApiServer } = require('../lib/api/server');
  const server = createApiServer({
    auth,
    dbPath,
    rateLimitWindowMs: 60_000,
    rateLimitMax: 1,
    requestLogging: false,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const first = await fetch(`${baseUrl}/v1/health`);
    assert.equal(first.status, 200);
    const second = await fetch(`${baseUrl}/v1/health`);
    const json = await second.json();
    assert.equal(second.status, 429);
    assert.equal(json.error.code, 'RATE_LIMITED');
    assert.ok(second.headers.get('retry-after'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousDbPath === undefined) delete process.env.CORTEX_DB_PATH;
    else process.env.CORTEX_DB_PATH = previousDbPath;
  }
});
