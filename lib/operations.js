const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const Database = require('better-sqlite3');
const db = require('../db/client');
const tasks = require('./tasks');
const { ensureIdentity, insertTaskEvent, newUid, slugify } = require('./lifecycle');

const DEFAULT_RETENTION = {
  doneArchiveDays: 90,
  cancelledArchiveDays: 30,
  eventRetentionDays: 365,
};

function getDbPath() {
  const row = db.prepare('PRAGMA database_list').all().find((r) => r.name === 'main');
  if (!row || !row.file) {
    throw new Error('unable to resolve database path');
  }
  return row.file;
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

function normalizeRetentionOptions(options = {}) {
  const doneArchiveDays = Number(options.doneArchiveDays ?? DEFAULT_RETENTION.doneArchiveDays);
  const cancelledArchiveDays = Number(options.cancelledArchiveDays ?? DEFAULT_RETENTION.cancelledArchiveDays);
  const eventRetentionDays = Number(options.eventRetentionDays ?? DEFAULT_RETENTION.eventRetentionDays);

  for (const [key, value] of Object.entries({ doneArchiveDays, cancelledArchiveDays, eventRetentionDays })) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`invalid retention value for ${key}`);
    }
  }

  return { doneArchiveDays, cancelledArchiveDays, eventRetentionDays };
}

function withTaskFilter(baseSql, taskIds, orderBy = '') {
  if (!taskIds.length) return `${baseSql} WHERE 1 = 0${orderBy}`;
  const placeholders = taskIds.map(() => '?').join(',');
  return `${baseSql} WHERE task_id IN (${placeholders})${orderBy}`;
}

function buildJsonl(rows, deps, logs, events) {
  const lines = [];
  lines.push(JSON.stringify({
    type: 'meta',
    schema: 'cortex.tasks.jsonl.v2',
    exported_at: new Date().toISOString(),
    task_count: rows.length,
    dependency_count: deps.length,
    log_count: logs.length,
    event_count: events.length,
  }));

  for (const row of rows) lines.push(JSON.stringify({ type: 'task', data: row }));
  for (const row of deps) lines.push(JSON.stringify({ type: 'dependency', data: row }));
  for (const row of logs) lines.push(JSON.stringify({ type: 'log', data: row }));
  for (const row of events) lines.push(JSON.stringify({ type: 'event', data: row }));

  return lines.join('\n') + '\n';
}

function exportJsonl({ rows, outputPath }) {
  const taskIds = rows.map((r) => r.id);
  const depsSql = taskIds.length
    ? `SELECT task_id, depends_on_id
       FROM task_dependencies
       WHERE task_id IN (${taskIds.map(() => '?').join(',')})
         AND depends_on_id IN (${taskIds.map(() => '?').join(',')})
       ORDER BY task_id ASC, depends_on_id ASC`
    : 'SELECT task_id, depends_on_id FROM task_dependencies WHERE 1 = 0';

  const deps = taskIds.length ? db.prepare(depsSql).all(...taskIds, ...taskIds) : [];

  const logsSql = withTaskFilter(
    'SELECT task_id, timestamp, agent, action, message FROM task_log',
    taskIds,
    ' ORDER BY timestamp ASC, id ASC'
  );
  const logs = db.prepare(logsSql).all(...taskIds);

  const eventsSql = withTaskFilter(
    `SELECT event_uid, task_id, task_uid, instance_id, client_slug, project_slug,
            event_type, from_status, to_status, actor, payload_json, created_at
     FROM task_events`,
    taskIds,
    ' ORDER BY created_at ASC, id ASC'
  );
  const events = db.prepare(eventsSql).all(...taskIds);

  const body = buildJsonl(rows, deps, logs, events);

  if (outputPath) {
    const resolved = path.resolve(outputPath);
    ensureParentDir(resolved);
    fs.writeFileSync(resolved, body, 'utf8');
    return {
      outputPath: resolved,
      tasks: rows.length,
      dependencies: deps.length,
      logs: logs.length,
      events: events.length,
    };
  }

  process.stdout.write(body);
  return {
    outputPath: null,
    tasks: rows.length,
    dependencies: deps.length,
    logs: logs.length,
    events: events.length,
  };
}

async function importJsonl({ filePath }) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`file not found: ${resolved}`);
  }

  const input = fs.createReadStream(resolved, { encoding: 'utf8' });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  const taskRows = [];
  const deps = [];
  const logs = [];
  const events = [];

  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber += 1;
    const trimmed = line.trim();
    if (!trimmed) continue;

    let row;
    try {
      row = JSON.parse(trimmed);
    } catch {
      throw new Error(`invalid json on line ${lineNumber}`);
    }

    if (!row || typeof row !== 'object') {
      throw new Error(`invalid row payload on line ${lineNumber}`);
    }

    if (row.type === 'meta') continue;
    if (row.type === 'task') taskRows.push(row.data || {});
    else if (row.type === 'dependency') deps.push(row.data || {});
    else if (row.type === 'log') logs.push(row.data || {});
    else if (row.type === 'event') events.push(row.data || {});
    else throw new Error(`unknown row type on line ${lineNumber}: ${String(row.type)}`);
  }

  const identity = ensureIdentity(db);
  const insertTask = db.prepare(`
    INSERT INTO tasks (
      task_uid, instance_id, client_slug, project_slug,
      title, description, status, step, progress, assignee, project, priority, tags,
      recur_interval, session_key, blocked_reason, needs_input, input_question, retry_count,
      parent_task_id, created_at, updated_at, started_at, resolved_at, due_at
    ) VALUES (
      @task_uid, @instance_id, @client_slug, @project_slug,
      @title, @description, @status, @step, @progress, @assignee, @project, @priority, @tags,
      @recur_interval, @session_key, @blocked_reason, @needs_input, @input_question, @retry_count,
      @parent_task_id, @created_at, @updated_at, @started_at, @resolved_at, @due_at
    )
  `);

  const insertDep = db.prepare('INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)');
  const insertLog = db.prepare(`
    INSERT INTO task_log (task_id, timestamp, agent, action, message)
    VALUES (@task_id, @timestamp, @agent, @action, @message)
  `);

  const insertRawEvent = db.prepare(`
    INSERT OR IGNORE INTO task_events (
      event_uid, task_id, task_uid, instance_id, client_slug, project_slug,
      event_type, from_status, to_status, actor, payload_json, created_at
    ) VALUES (
      @event_uid, @task_id, @task_uid, @instance_id, @client_slug, @project_slug,
      @event_type, @from_status, @to_status, @actor, @payload_json, @created_at
    )
  `);

  const idMap = new Map();
  const uidMap = new Map();
  const now = new Date().toISOString();

  const result = db.transaction(() => {
    let importedTasks = 0;
    let importedDependencies = 0;
    let skippedDependencies = 0;
    let importedLogs = 0;
    let skippedLogs = 0;
    let importedEvents = 0;
    let skippedEvents = 0;

    const pending = [...taskRows];
    while (pending.length) {
      let insertedInPass = 0;

      for (let i = pending.length - 1; i >= 0; i--) {
        const row = pending[i];
        if (!row || !row.title) {
          throw new Error('invalid task row: missing title');
        }

        const parentId = Number(row.parent_task_id);
        const needsParent = Number.isInteger(parentId) && parentId > 0;
        if (needsParent && !idMap.has(parentId)) continue;

        const sourceId = Number(row.id);
        const mappedParent = needsParent ? idMap.get(parentId) : null;

        const task_uid = row.task_uid || newUid('task');
        const projectSlug = row.project_slug || slugify(row.project || identity.project_slug, identity.project_slug);

        const info = insertTask.run({
          task_uid,
          instance_id: row.instance_id || identity.instance_id,
          client_slug: row.client_slug || identity.client_slug,
          project_slug: projectSlug,
          title: row.title,
          description: row.description ?? null,
          status: row.status || 'todo',
          step: row.step ?? null,
          progress: Number.isFinite(Number(row.progress)) ? Number(row.progress) : 0,
          assignee: row.assignee ?? null,
          project: row.project ?? null,
          priority: row.priority || 'normal',
          tags: row.tags ?? null,
          recur_interval: row.recur_interval ?? null,
          session_key: row.session_key ?? null,
          blocked_reason: row.blocked_reason ?? null,
          needs_input: row.needs_input ? 1 : 0,
          input_question: row.input_question ?? null,
          retry_count: Number.isFinite(Number(row.retry_count)) ? Number(row.retry_count) : 0,
          parent_task_id: mappedParent || null,
          created_at: row.created_at || now,
          updated_at: row.updated_at || row.created_at || now,
          started_at: row.started_at ?? null,
          resolved_at: row.resolved_at ?? null,
          due_at: row.due_at ?? null,
        });

        const newId = Number(info.lastInsertRowid);
        if (Number.isInteger(sourceId) && sourceId > 0) idMap.set(sourceId, newId);
        uidMap.set(task_uid, newId);

        insertTaskEvent(db, {
          task_id: newId,
          task_uid,
          instance_id: row.instance_id || identity.instance_id,
          client_slug: row.client_slug || identity.client_slug,
          project_slug: projectSlug,
          event_type: 'task.import',
          to_status: row.status || 'todo',
          payload: { source_file: resolved },
        });

        pending.splice(i, 1);
        importedTasks += 1;
        insertedInPass += 1;
      }

      if (insertedInPass === 0) {
        throw new Error('cannot resolve parent_task_id chain in import data');
      }
    }

    for (const dep of deps) {
      const from = idMap.get(Number(dep.task_id));
      const to = idMap.get(Number(dep.depends_on_id));
      if (!from || !to) {
        skippedDependencies += 1;
        continue;
      }
      const info = insertDep.run(from, to);
      importedDependencies += info.changes;
    }

    for (const log of logs) {
      const mappedTaskId = idMap.get(Number(log.task_id));
      if (!mappedTaskId) {
        skippedLogs += 1;
        continue;
      }
      insertLog.run({
        task_id: mappedTaskId,
        timestamp: log.timestamp || now,
        agent: log.agent ?? null,
        action: log.action ?? null,
        message: log.message ?? null,
      });
      importedLogs += 1;
    }

    for (const event of events) {
      const mappedTaskId = idMap.get(Number(event.task_id)) || uidMap.get(event.task_uid) || null;
      if (event.task_id && !mappedTaskId) {
        skippedEvents += 1;
        continue;
      }

      const taskRow = mappedTaskId ? db.prepare('SELECT * FROM tasks WHERE id = ?').get(mappedTaskId) : null;

      insertRawEvent.run({
        event_uid: event.event_uid || newUid('evt'),
        task_id: mappedTaskId,
        task_uid: taskRow ? taskRow.task_uid : (event.task_uid || null),
        instance_id: taskRow ? taskRow.instance_id : (event.instance_id || identity.instance_id),
        client_slug: taskRow ? taskRow.client_slug : (event.client_slug || identity.client_slug),
        project_slug: taskRow ? taskRow.project_slug : (event.project_slug || identity.project_slug),
        event_type: event.event_type || 'task.import-raw-event',
        from_status: event.from_status || null,
        to_status: event.to_status || null,
        actor: event.actor || null,
        payload_json: event.payload_json || null,
        created_at: event.created_at || now,
      });
      importedEvents += 1;
    }

    insertTaskEvent(db, {
      event_type: 'task.import',
      payload: {
        file_path: resolved,
        importedTasks,
        importedDependencies,
        importedLogs,
        importedEvents,
      },
    });

    return {
      importedTasks,
      importedDependencies,
      skippedDependencies,
      importedLogs,
      skippedLogs,
      importedEvents,
      skippedEvents,
      sourceTasks: taskRows.length,
      sourceDependencies: deps.length,
      sourceLogs: logs.length,
      sourceEvents: events.length,
    };
  })();

  return { filePath: resolved, ...result };
}

async function backupDatabase({ outputPath }) {
  const resolved = path.resolve(outputPath);
  ensureParentDir(resolved);
  await db.backup(resolved);
  return { outputPath: resolved };
}

async function restoreDatabase({ inputPath }) {
  const sourcePath = path.resolve(inputPath);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`backup file not found: ${sourcePath}`);
  }

  const dbPath = getDbPath();
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').slice(0, 15) + 'Z';
  const safetyBackupPath = `${dbPath}.pre-restore.${timestamp}.sqlite`;

  await db.backup(safetyBackupPath);
  db.close();

  const tmpRestorePath = `${dbPath}.restore.tmp`;
  const sourceDb = new Database(sourcePath, { readonly: true, fileMustExist: true });

  try {
    await sourceDb.backup(tmpRestorePath);
  } finally {
    sourceDb.close();
  }

  for (const sidecar of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  }
  fs.renameSync(tmpRestorePath, dbPath);

  const restoredDb = new Database(dbPath);
  try {
    restoredDb.pragma('foreign_keys = ON');
    ensureIdentity(restoredDb);
    insertTaskEvent(restoredDb, {
      event_type: 'task.restore',
      payload: {
        sourcePath,
        safetyBackupPath,
      },
    });
  } finally {
    restoredDb.close();
  }

  return {
    sourcePath,
    restoredTo: dbPath,
    safetyBackupPath,
  };
}

function retentionReport(options = {}) {
  const config = normalizeRetentionOptions(options);

  const doneCutoff = `-${config.doneArchiveDays} days`;
  const cancelledCutoff = `-${config.cancelledArchiveDays} days`;
  const eventCutoff = `-${config.eventRetentionDays} days`;

  const doneCandidates = db.prepare(`
    SELECT COUNT(*) AS count
    FROM tasks
    WHERE status = 'done'
      AND date(COALESCE(resolved_at, updated_at)) < date('now', ?)
  `).get(doneCutoff).count;

  const cancelledCandidates = db.prepare(`
    SELECT COUNT(*) AS count
    FROM tasks
    WHERE status = 'cancelled'
      AND date(COALESCE(resolved_at, updated_at)) < date('now', ?)
  `).get(cancelledCutoff).count;

  const logCandidates = db.prepare(`
    SELECT COUNT(*) AS count
    FROM task_log
    WHERE date(timestamp) < date('now', ?)
  `).get(eventCutoff).count;

  const eventCandidates = db.prepare(`
    SELECT COUNT(*) AS count
    FROM task_events
    WHERE date(created_at) < date('now', ?)
  `).get(eventCutoff).count;

  const pageSize = db.pragma('page_size', { simple: true });
  const pageCount = db.pragma('page_count', { simple: true });
  const freelistCount = db.pragma('freelist_count', { simple: true });

  return {
    config,
    candidates: {
      archiveDone: doneCandidates,
      archiveCancelled: cancelledCandidates,
      pruneTaskLog: logCandidates,
      pruneTaskEvents: eventCandidates,
    },
    storage: {
      pageSize,
      pageCount,
      freelistCount,
      fileBytes: pageSize * pageCount,
      reclaimableBytes: pageSize * freelistCount,
    },
  };
}

function applyRetention(options = {}) {
  const config = normalizeRetentionOptions(options);
  const compact = Boolean(options.compact);

  const eventCutoff = `-${config.eventRetentionDays} days`;

  const mutate = db.transaction(() => {
    const doneIds = db.prepare(`
      SELECT id
      FROM tasks
      WHERE status = 'done'
        AND date(COALESCE(resolved_at, updated_at)) < date('now', ?)
    `).all(`-${config.doneArchiveDays} days`).map((r) => r.id);

    const cancelledIds = db.prepare(`
      SELECT id
      FROM tasks
      WHERE status = 'cancelled'
        AND date(COALESCE(resolved_at, updated_at)) < date('now', ?)
    `).all(`-${config.cancelledArchiveDays} days`).map((r) => r.id);

    const archiveDone = tasks.archiveTaskIds(doneIds, { source: 'retention', reason: 'done-age-threshold' });
    const archiveCancelled = tasks.archiveTaskIds(cancelledIds, { source: 'retention', reason: 'cancelled-age-threshold' });

    const pruneTaskLog = db.prepare(`
      DELETE FROM task_log
      WHERE date(timestamp) < date('now', ?)
    `).run(eventCutoff).changes;

    const pruneTaskEvents = db.prepare(`
      DELETE FROM task_events
      WHERE date(created_at) < date('now', ?)
    `).run(eventCutoff).changes;

    insertTaskEvent(db, {
      event_type: 'task.retention',
      payload: {
        config,
        archiveDone,
        archiveCancelled,
        pruneTaskLog,
        pruneTaskEvents,
      },
    });

    return { archiveDone, archiveCancelled, pruneTaskLog, pruneTaskEvents };
  });

  const changes = mutate();

  if (compact) {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.exec('VACUUM');
    db.exec('ANALYZE');
  }

  return {
    config,
    changes,
    compacted: compact,
  };
}

function compactDatabase() {
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.exec('VACUUM');
  db.exec('ANALYZE');

  const pageSize = db.pragma('page_size', { simple: true });
  const pageCount = db.pragma('page_count', { simple: true });
  const freelistCount = db.pragma('freelist_count', { simple: true });

  return {
    pageSize,
    pageCount,
    freelistCount,
    fileBytes: pageSize * pageCount,
    reclaimableBytes: pageSize * freelistCount,
  };
}

module.exports = {
  DEFAULT_RETENTION,
  exportJsonl,
  importJsonl,
  backupDatabase,
  restoreDatabase,
  retentionReport,
  applyRetention,
  compactDatabase,
};
