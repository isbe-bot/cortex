const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

const repoRoot = path.join(__dirname, '..');
const cortexPath = path.join(repoRoot, 'cortex.js');
const initPath = path.join(repoRoot, 'db', 'init.js');

function tmpDbPath(prefix = 'cortex-lifecycle-') {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), prefix)), 'cortex.sqlite');
}

function runNode(script, args, env = {}, options = {}) {
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });

  if (!options.allowFailure && res.status !== 0) {
    throw new Error(`command failed: node ${path.basename(script)} ${args.join(' ')}\nstdout=${res.stdout}\nstderr=${res.stderr}`);
  }

  return res;
}

function runJson(args, env) {
  const res = runNode(cortexPath, [...args, '--json'], env);
  return JSON.parse(res.stdout.trim());
}

test('lifecycle transitions are validated and lifecycle events are emitted', () => {
  const dbPath = tmpDbPath();
  const env = { CORTEX_DB_PATH: dbPath };
  runNode(initPath, [], env);

  const task = runJson(['add', 'Lifecycle test task', '--project', 'cortex'], env);
  runNode(cortexPath, ['update', String(task.id), '--progress', '25', '--step', 'phase-1'], env);
  runNode(cortexPath, ['block', String(task.id), 'waiting on token'], env);
  runNode(cortexPath, ['input', String(task.id), 'need approval'], env);
  runNode(cortexPath, ['fail', String(task.id), 'pipeline error'], env);
  runNode(cortexPath, ['fail', String(task.id), 'retrying now', '--retry'], env);
  runNode(cortexPath, ['done', String(task.id)], env);

  const bad = runNode(cortexPath, ['block', String(task.id), 'should fail'], env, { allowFailure: true });
  assert.notEqual(bad.status, 0);
  assert.match(`${bad.stderr}${bad.stdout}`, /invalid lifecycle transition/i);

  const cancelTask = runJson(['add', 'Cancelled task', '--project', 'cortex'], env);
  runNode(cortexPath, ['cancel', String(cancelTask.id)], env);

  const db = new Database(dbPath);
  try {
    const taskRow = db.prepare('SELECT task_uid, instance_id, client_slug, project_slug FROM tasks WHERE id = ?').get(task.id);
    assert.ok(taskRow.task_uid);
    assert.ok(taskRow.instance_id);
    assert.ok(taskRow.client_slug);
    assert.ok(taskRow.project_slug);

    const eventTypes = db.prepare('SELECT event_type FROM task_events ORDER BY id ASC').all().map((r) => r.event_type);
    for (const expected of ['task.create', 'task.update', 'task.block', 'task.input', 'task.fail', 'task.done', 'task.cancel']) {
      assert.ok(eventTypes.includes(expected), `missing event type: ${expected}`);
    }

    const appendOnlyUpdate = () => db.prepare('UPDATE task_events SET event_type = ? WHERE id = 1').run('x');
    assert.throws(appendOnlyUpdate, /append-only/i);
  } finally {
    db.close();
  }
});

test('import, retention, archive, and restore emit events', () => {
  const dbA = tmpDbPath('cortex-events-src-');
  const dbB = tmpDbPath('cortex-events-dst-');
  const envA = { CORTEX_DB_PATH: dbA };
  const envB = { CORTEX_DB_PATH: dbB };

  runNode(initPath, [], envA);
  runNode(initPath, [], envB);

  const task = runJson(['add', 'Portable event task', '--project', 'cortex'], envA);
  runNode(cortexPath, ['done', String(task.id)], envA);

  const exportPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-events-export-')), 'tasks.jsonl');
  runNode(cortexPath, ['export', '--format', 'jsonl', '--status', 'done', '--out', exportPath], envA);

  runNode(cortexPath, ['import', '--file', exportPath], envB);

  const db = new Database(dbB);
  try {
    const importedDone = db.prepare("SELECT id FROM tasks WHERE status = 'done' LIMIT 1").get();
    assert.ok(importedDone && importedDone.id);
    db.prepare("UPDATE tasks SET resolved_at = datetime('now', '-2 days'), updated_at = datetime('now', '-2 days') WHERE id = ?").run(importedDone.id);
  } finally {
    db.close();
  }

  runNode(cortexPath, ['retention', 'apply', '--doneDays', '1', '--eventDays', '0', '--yes'], envB);

  const backupPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-events-backup-')), 'snapshot.sqlite');
  runNode(cortexPath, ['backup', '--out', backupPath], envB);
  runNode(cortexPath, ['restore', '--file', backupPath, '--yes'], envB);

  const dbAfter = new Database(dbB);
  try {
    const eventTypes = dbAfter.prepare('SELECT event_type FROM task_events ORDER BY id ASC').all().map((r) => r.event_type);
    for (const expected of ['task.import', 'task.archive', 'task.retention', 'task.restore']) {
      assert.ok(eventTypes.includes(expected), `missing event type: ${expected}`);
    }
  } finally {
    dbAfter.close();
  }
});
