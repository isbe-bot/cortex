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

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function tmpDbPath(prefix = 'cortex-phase3-db-') {
  return path.join(tempDir(prefix), 'cortex.sqlite');
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

test('JSONL export/import preserves tasks, dependencies, and logs', () => {
  const dbA = tmpDbPath('cortex-phase3-src-');
  const dbB = tmpDbPath('cortex-phase3-dst-');
  const envA = { CORTEX_DB_PATH: dbA };
  const envB = { CORTEX_DB_PATH: dbB };

  runNode(initPath, [], envA);
  runNode(initPath, [], envB);

  const parent = JSON.parse(runNode(cortexPath, ['add', 'Parent task', '--assign', 'isbe', '--project', 'cortex', '--json'], envA));
  const child = JSON.parse(runNode(cortexPath, ['add', 'Child task', '--parent', String(parent.id), '--depends', String(parent.id), '--project', 'cortex', '--json'], envA));
  runNode(cortexPath, ['log', String(parent.id), 'manual note from test'], envA);
  runNode(cortexPath, ['update', String(parent.id), '--status', 'in-progress', '--progress', '50'], envA);

  const exportPath = path.join(tempDir('cortex-phase3-export-'), 'tasks.jsonl');
  const exportMeta = JSON.parse(runNode(cortexPath, ['export', '--format', 'jsonl', '--out', exportPath, '--json'], envA));
  assert.equal(exportMeta.tasks, 2);
  assert.ok(exportMeta.dependencies >= 1);
  assert.ok(exportMeta.logs >= 1);
  assert.ok(fs.existsSync(exportPath));

  const importMeta = JSON.parse(runNode(cortexPath, ['import', '--file', exportPath, '--json'], envB));
  assert.equal(importMeta.importedTasks, 2);
  assert.ok(importMeta.importedDependencies >= 1);
  assert.ok(importMeta.importedLogs >= 1);

  const list = JSON.parse(runNode(cortexPath, ['list', '--status', 'in-progress', '--json'], envB));
  assert.equal(list.count, 1);
  assert.equal(list.tasks[0].title, 'Parent task');

  const importedChild = JSON.parse(runNode(cortexPath, ['list', '--status', 'todo', '--json'], envB));
  assert.equal(importedChild.count, 1);
  assert.equal(importedChild.tasks[0].title, 'Child task');

  const importedChildDetails = JSON.parse(runNode(cortexPath, ['get', String(importedChild.tasks[0].id), '--json'], envB));
  assert.equal(importedChildDetails.dependencies.length, 1);
  assert.equal(importedChildDetails.dependencies[0].title, 'Parent task');

  const parentDetails = JSON.parse(runNode(cortexPath, ['get', String(list.tasks[0].id), '--json'], envB));
  assert.ok(parentDetails.log.length >= 1);

  assert.equal(child.task.title, 'Child task');
});

test('backup/restore and retention report/apply work safely', () => {
  const dbPath = tmpDbPath('cortex-phase3-retention-');
  const env = { CORTEX_DB_PATH: dbPath };

  runNode(initPath, [], env);

  const taskA = JSON.parse(runNode(cortexPath, ['add', 'Backup baseline', '--project', 'cortex', '--json'], env));
  runNode(cortexPath, ['done', String(taskA.id)], env);

  const db = new Database(dbPath);
  try {
    db.prepare(`
      UPDATE tasks
      SET resolved_at = datetime('now', '-2 days'), updated_at = datetime('now', '-2 days')
      WHERE id = ?
    `).run(taskA.id);
  } finally {
    db.close();
  }

  const backupPath = path.join(tempDir('cortex-phase3-backup-'), 'snapshot.sqlite');
  const backupMeta = JSON.parse(runNode(cortexPath, ['backup', '--out', backupPath, '--json'], env));
  assert.ok(fs.existsSync(backupMeta.outputPath));

  runNode(cortexPath, ['add', 'Post-backup mutation', '--project', 'cortex'], env);

  const beforeRestore = JSON.parse(runNode(cortexPath, ['list', '--status', 'todo', '--json'], env));
  assert.equal(beforeRestore.count, 1);

  runNode(cortexPath, ['restore', '--file', backupPath, '--yes'], env);

  const afterRestore = JSON.parse(runNode(cortexPath, ['list', '--status', 'todo', '--json'], env));
  assert.equal(afterRestore.count, 0);

  const report = JSON.parse(runNode(cortexPath, ['retention', 'report', '--doneDays', '1', '--eventDays', '0', '--json'], env));
  assert.ok(report.candidates.archiveDone >= 1);

  const apply = JSON.parse(runNode(cortexPath, ['retention', 'apply', '--doneDays', '1', '--eventDays', '0', '--compact', '--yes', '--json'], env));
  assert.ok(apply.changes.archiveDone >= 1);

  const doneAfter = JSON.parse(runNode(cortexPath, ['list', '--status', 'done', '--json'], env));
  assert.equal(doneAfter.count, 0);

  const archived = JSON.parse(runNode(cortexPath, ['list', '--status', 'archived', '--json'], env));
  assert.ok(archived.count >= 1);
});
