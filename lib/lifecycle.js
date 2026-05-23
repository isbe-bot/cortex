const crypto = require('node:crypto');

const VALID_STATUSES = new Set([
  'todo',
  'in-progress',
  'blocked',
  'failed',
  'needs-input',
  'done',
  'cancelled',
  'archived',
]);

const STATUS_TRANSITIONS = {
  todo: new Set(['in-progress', 'blocked', 'failed', 'needs-input', 'done', 'cancelled', 'archived']),
  'in-progress': new Set(['blocked', 'failed', 'needs-input', 'done', 'cancelled']),
  blocked: new Set(['in-progress', 'failed', 'needs-input', 'cancelled', 'done']),
  failed: new Set(['in-progress', 'blocked', 'needs-input', 'cancelled']),
  'needs-input': new Set(['in-progress', 'blocked', 'failed', 'cancelled', 'done']),
  done: new Set(['archived']),
  cancelled: new Set(['archived']),
  archived: new Set(['todo', 'in-progress', 'blocked', 'needs-input']),
};

function newUid(prefix) {
  const raw = crypto.randomUUID().replace(/-/g, '');
  return `${prefix}_${raw}`;
}

function slugify(value, fallback = 'default') {
  const base = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || fallback;
}

function validateStatusTransition(fromStatus, toStatus) {
  if (!VALID_STATUSES.has(toStatus)) {
    throw new Error(`invalid status: ${toStatus}`);
  }
  if (!fromStatus || fromStatus === toStatus) return;
  const allowed = STATUS_TRANSITIONS[fromStatus];
  if (!allowed || !allowed.has(toStatus)) {
    throw new Error(`invalid lifecycle transition: ${fromStatus} -> ${toStatus}`);
  }
}

function ensureIdentity(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cortex_identity (
      singleton    INTEGER PRIMARY KEY CHECK (singleton = 1),
      instance_id  TEXT NOT NULL,
      client_slug  TEXT NOT NULL,
      project_slug TEXT NOT NULL,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.prepare(`
    INSERT INTO cortex_identity (singleton, instance_id, client_slug, project_slug)
    VALUES (1, @instance_id, @client_slug, @project_slug)
    ON CONFLICT(singleton) DO NOTHING
  `).run({
    instance_id: process.env.CORTEX_INSTANCE_ID || newUid('inst'),
    client_slug: slugify(process.env.CORTEX_CLIENT_SLUG || 'local', 'local'),
    project_slug: slugify(process.env.CORTEX_PROJECT_SLUG || 'cortex', 'cortex'),
  });

  return db.prepare(`
    SELECT instance_id, client_slug, project_slug
    FROM cortex_identity
    WHERE singleton = 1
  `).get();
}

function insertTaskEvent(db, input) {
  const identity = ensureIdentity(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      event_uid    TEXT NOT NULL UNIQUE,
      task_id      INTEGER REFERENCES tasks(id),
      task_uid     TEXT,
      instance_id  TEXT NOT NULL,
      client_slug  TEXT NOT NULL,
      project_slug TEXT NOT NULL,
      event_type   TEXT NOT NULL,
      from_status  TEXT,
      to_status    TEXT,
      actor        TEXT,
      payload_json TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const payload = input.payload === undefined ? null : JSON.stringify(input.payload);
  const eventUid = input.event_uid || newUid('evt');
  const actor = input.actor || process.env.USER || 'system';
  const projectSlug = input.project_slug || identity.project_slug;

  db.prepare(`
    INSERT INTO task_events (
      event_uid,
      task_id,
      task_uid,
      instance_id,
      client_slug,
      project_slug,
      event_type,
      from_status,
      to_status,
      actor,
      payload_json,
      created_at
    ) VALUES (
      @event_uid,
      @task_id,
      @task_uid,
      @instance_id,
      @client_slug,
      @project_slug,
      @event_type,
      @from_status,
      @to_status,
      @actor,
      @payload_json,
      COALESCE(@created_at, CURRENT_TIMESTAMP)
    )
  `).run({
    event_uid: eventUid,
    task_id: input.task_id || null,
    task_uid: input.task_uid || null,
    instance_id: input.instance_id || identity.instance_id,
    client_slug: input.client_slug || identity.client_slug,
    project_slug: projectSlug,
    event_type: input.event_type,
    from_status: input.from_status || null,
    to_status: input.to_status || null,
    actor,
    payload_json: payload,
    created_at: input.created_at || null,
  });

  return eventUid;
}

module.exports = {
  VALID_STATUSES,
  STATUS_TRANSITIONS,
  newUid,
  slugify,
  validateStatusTransition,
  ensureIdentity,
  insertTaskEvent,
};
