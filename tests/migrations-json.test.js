const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const { applyMigrations } = require('../db/migrations');

const repoRoot = path.join(__dirname, '..');
const cortexPath = path.join(repoRoot, 'cortex.js');
const initPath = path.join(repoRoot, 'db', 'init.js');

function tmpDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-test-')), 'cortex.sqlite');
}

function runNode(script, args, env = {}) {
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new Error(`command failed: node ${path.basename(script)} ${args.join(' ')}\nstdout=${res.stdout}\nstderr=${res.stderr}`);
  }
  return res.stdout.trim();
}

test('db/init initializes fresh DB and records migration checksums', () => {
  const dbPath = tmpDbPath();
  const output = runNode(initPath, [], { CORTEX_DB_PATH: dbPath });
  assert.match(output, /initialized|migrated/);

  const db = new Database(dbPath);
  try {
    const count = db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count;
    assert.ok(count >= 7);
    const columns = db.prepare('PRAGMA table_info(tasks)').all().map(row => row.name);
    assert.ok(columns.includes('tags'));
    assert.ok(columns.includes('due_at'));
    assert.ok(columns.includes('task_uid'));
    assert.ok(columns.includes('instance_id'));
    assert.ok(columns.includes('client_slug'));
    assert.ok(columns.includes('project_slug'));
  } finally {
    db.close();
  }
});

test('applyMigrations upgrades an older schema idempotently', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'todo',
        step TEXT,
        progress INTEGER DEFAULT 0,
        assignee TEXT,
        project TEXT,
        priority TEXT DEFAULT 'normal',
        session_key TEXT,
        blocked_reason TEXT,
        needs_input INTEGER DEFAULT 0,
        input_question TEXT,
        retry_count INTEGER DEFAULT 0,
        parent_task_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME
      );
    `);
    const first = applyMigrations(db);
    assert.ok(first.applied.length >= 1);
    const second = applyMigrations(db);
    assert.equal(second.applied.length, 0);
    const columns = db.prepare('PRAGMA table_info(tasks)').all().map(row => row.name);
    assert.ok(columns.includes('tags'));
    assert.ok(columns.includes('started_at'));
    assert.ok(columns.includes('due_at'));
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 7);
  } finally {
    db.close();
  }
});

test('critical CLI commands support JSON output', () => {
  const dbPath = tmpDbPath();
  const env = { CORTEX_DB_PATH: dbPath };
  runNode(initPath, [], env);

  const add = JSON.parse(runNode(cortexPath, ['add', 'JSON smoke', '--assign', 'isbe', '--project', 'cortex', '--json'], env));
  assert.equal(add.task.title, 'JSON smoke');

  const list = JSON.parse(runNode(cortexPath, ['list', '--project', 'cortex', '--json'], env));
  assert.equal(list.count, 1);

  const get = JSON.parse(runNode(cortexPath, ['get', String(add.id), '--json'], env));
  assert.equal(get.task.id, add.id);

  const status = JSON.parse(runNode(cortexPath, ['status', '--project', 'cortex', '--json'], env));
  assert.equal(status.todo.length, 1);

  const done = JSON.parse(runNode(cortexPath, ['done', String(add.id), '--json'], env));
  assert.equal(done.task.status, 'done');
});
