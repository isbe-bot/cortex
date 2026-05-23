const db = require('../db/client');
const {
  ensureIdentity,
  insertTaskEvent,
  newUid,
  slugify,
  validateStatusTransition,
} = require('./lifecycle');

function taskProjectSlug(project, identity) {
  return slugify(project || identity.project_slug || 'cortex', identity.project_slug || 'cortex');
}

function createTask(data) {
  const identity = ensureIdentity(db);
  const status = data.status || 'todo';
  validateStatusTransition(null, status);

  const started_at = data.started_at || (status === 'in-progress' ? new Date().toISOString() : null);
  const task_uid = data.task_uid || newUid('task');
  const instance_id = data.instance_id || identity.instance_id;
  const client_slug = data.client_slug || identity.client_slug;
  const project_slug = data.project_slug || taskProjectSlug(data.project, identity);

  const stmt = db.prepare(`
    INSERT INTO tasks (
      task_uid, instance_id, client_slug, project_slug,
      title, description, status, step, progress, assignee, project, priority, tags,
      recur_interval, session_key, blocked_reason, needs_input, input_question, retry_count,
      parent_task_id, started_at, resolved_at, due_at
    )
    VALUES (
      @task_uid, @instance_id, @client_slug, @project_slug,
      @title, @description, @status, @step, @progress, @assignee, @project, @priority, @tags,
      @recur_interval, @session_key, @blocked_reason, @needs_input, @input_question, @retry_count,
      @parent_task_id, @started_at, @resolved_at, @due_at
    )
  `);

  const info = stmt.run({
    task_uid,
    instance_id,
    client_slug,
    project_slug,
    title: data.title,
    description: data.description || null,
    status,
    step: data.step || null,
    progress: data.progress || 0,
    assignee: data.assignee || null,
    project: data.project || null,
    priority: data.priority || 'normal',
    tags: data.tags || null,
    recur_interval: data.recur_interval || null,
    session_key: data.session_key || null,
    blocked_reason: data.blocked_reason || null,
    needs_input: data.needs_input || 0,
    input_question: data.input_question || null,
    retry_count: data.retry_count || 0,
    parent_task_id: data.parent_task_id || null,
    started_at,
    resolved_at: data.resolved_at || null,
    due_at: data.due_at || null,
  });

  const id = Number(info.lastInsertRowid);
  insertTaskEvent(db, {
    task_id: id,
    task_uid,
    instance_id,
    client_slug,
    project_slug,
    event_type: 'task.create',
    to_status: status,
    payload: {
      title: data.title,
      assignee: data.assignee || null,
      project: data.project || null,
      priority: data.priority || 'normal',
      parent_task_id: data.parent_task_id || null,
    },
  });
  logTaskAction(id, 'create', data.title);

  return id;
}

function getTask(id) {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
}

function getSubtasks(parentId) {
  return db.prepare('SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY id ASC').all(parentId);
}

function listTasks(filters = {}) {
  const clauses = [];
  const params = {};

  if (filters.status) {
    clauses.push('status = @status');
    params.status = filters.status;
  }
  if (filters.assignee) {
    clauses.push('assignee = @assignee');
    params.assignee = filters.assignee;
  }
  if (filters.project) {
    clauses.push('project = @project');
    params.project = filters.project;
  }
  if (filters.priority) {
    clauses.push('priority = @priority');
    params.priority = filters.priority;
  }
  if (filters.tag) {
    clauses.push("(',' || IFNULL(tags,'') || ',') LIKE @tagPattern");
    params.tagPattern = `%,${filters.tag},%`;
  }
  if (filters.parent_task_id !== undefined) {
    clauses.push('parent_task_id = @parent_task_id');
    params.parent_task_id = filters.parent_task_id;
  }
  if (filters.excludeDoneCancelled) {
    clauses.push("status NOT IN ('done','cancelled')");
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const sql = `SELECT * FROM tasks ${where} ORDER BY id ASC`;
  return db.prepare(sql).all(params);
}

function listTasksByParent() {
  return db.prepare('SELECT * FROM tasks ORDER BY id ASC').all();
}

function logTaskAction(task_id, action, message, agent) {
  const stmt = db.prepare(`
    INSERT INTO task_log (task_id, agent, action, message)
    VALUES (@task_id, @agent, @action, @message)
  `);
  stmt.run({
    task_id,
    agent: agent || process.env.USER || 'unknown',
    action,
    message: message || null,
  });
}

function listTaskLog(task_id, limit = 5) {
  return db.prepare(
    'SELECT * FROM task_log WHERE task_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?'
  ).all(task_id, limit);
}

function addDependency(task_id, depends_on_id) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_id)
    VALUES (?, ?)
  `);
  const info = stmt.run(task_id, depends_on_id);
  return info.changes;
}

function listDependencies(task_id) {
  return db.prepare(`
    SELECT d.depends_on_id, t.title, t.status
    FROM task_dependencies d
    JOIN tasks t ON t.id = d.depends_on_id
    WHERE d.task_id = ?
    ORDER BY d.depends_on_id ASC
  `).all(task_id);
}

function listUnmetDependencies(task_id) {
  return db.prepare(`
    SELECT d.depends_on_id, t.title, t.status
    FROM task_dependencies d
    JOIN tasks t ON t.id = d.depends_on_id
    WHERE d.task_id = ? AND t.status != 'done'
    ORDER BY d.depends_on_id ASC
  `).all(task_id);
}

function getStats() {
  const completedThisWeek = db.prepare(`
    SELECT COUNT(*) as count
    FROM tasks
    WHERE status = 'done'
      AND date(resolved_at) >= date('now', 'weekday 1', '-7 days')
  `).get().count;

  const avgCycleSeconds = db.prepare(`
    SELECT AVG((julianday(resolved_at) - julianday(started_at)) * 86400) as avg_seconds
    FROM tasks
    WHERE status = 'done' AND started_at IS NOT NULL AND resolved_at IS NOT NULL
  `).get().avg_seconds;

  const perAgent = db.prepare(`
    SELECT COALESCE(assignee, '(unassigned)') as assignee, COUNT(*) as count
    FROM tasks
    GROUP BY assignee
    ORDER BY count DESC
  `).all();

  const perProject = db.prepare(`
    SELECT COALESCE(project, '(none)') as project, COUNT(*) as count
    FROM tasks
    GROUP BY project
    ORDER BY count DESC
  `).all();

  return {
    completedThisWeek,
    avgCycleSeconds: avgCycleSeconds || 0,
    perAgent,
    perProject,
  };
}

function updateTask(id, fields, meta = {}) {
  const allowed = [
    'title', 'description', 'status', 'step', 'progress', 'assignee', 'project', 'priority', 'tags', 'recur_interval',
    'session_key', 'blocked_reason', 'needs_input', 'input_question', 'retry_count', 'parent_task_id', 'started_at', 'resolved_at', 'due_at',
    'task_uid', 'instance_id', 'client_slug', 'project_slug'
  ];

  const row = getTask(id);
  if (!row) return 0;

  const next = { ...fields };

  if (next.project_slug === undefined && next.project !== undefined) {
    const identity = ensureIdentity(db);
    next.project_slug = taskProjectSlug(next.project, identity);
  }

  if (next.status) {
    validateStatusTransition(row.status, next.status);
  }

  if (next.status === 'in-progress' && !next.started_at && !row.started_at) {
    next.started_at = new Date().toISOString();
  }

  if (next.status && next.status !== 'done' && next.resolved_at === undefined) {
    next.resolved_at = null;
  }

  const keys = Object.keys(next).filter((k) => allowed.includes(k));
  if (keys.length === 0) return 0;

  const sets = keys.map((k) => `${k} = @${k}`).join(', ');
  const stmt = db.prepare(`UPDATE tasks SET ${sets} WHERE id = @id`);

  const tx = db.transaction(() => {
    const info = stmt.run({ ...next, id });
    if (info.changes === 0) return info;

    const changed = {};
    for (const key of keys) {
      if (row[key] !== next[key]) changed[key] = next[key];
    }

    if (next.status && row.status !== next.status) {
      logTaskAction(id, 'status', `${row.status} -> ${next.status}`);
      insertTaskEvent(db, {
        task_id: id,
        task_uid: row.task_uid,
        instance_id: row.instance_id,
        client_slug: row.client_slug,
        project_slug: next.project_slug || row.project_slug,
        event_type: meta.eventType || 'task.update',
        from_status: row.status,
        to_status: next.status,
        payload: {
          changed,
          reason: meta.reason || null,
          source: meta.source || null,
          ...(meta.payload || {}),
        },
      });
    } else if (Object.keys(changed).length) {
      insertTaskEvent(db, {
        task_id: id,
        task_uid: row.task_uid,
        instance_id: row.instance_id,
        client_slug: row.client_slug,
        project_slug: next.project_slug || row.project_slug,
        event_type: meta.eventType || 'task.update',
        payload: {
          changed,
          reason: meta.reason || null,
          source: meta.source || null,
          ...(meta.payload || {}),
        },
      });
    }

    return info;
  });

  return tx().changes;
}

function appendDescription(id, notes) {
  const row = getTask(id);
  if (!row) return 0;
  const current = row.description || '';
  const next = current ? `${current}\n\n${notes}` : notes;
  return updateTask(id, { description: next });
}

function setStatus(id, status, extras = {}, meta = {}) {
  return updateTask(id, { status, ...extras }, meta);
}

function blockTask(id, reason) {
  return setStatus(id, 'blocked', { blocked_reason: reason }, {
    eventType: 'task.block',
    reason,
    payload: { blocked_reason: reason },
  });
}

function failTask(id, reason, options = {}) {
  const row = getTask(id);
  if (!row) return 0;

  if (options.retry) {
    const retry = (row.retry_count || 0) + 1;
    return updateTask(id, {
      status: 'in-progress',
      retry_count: retry,
      blocked_reason: reason,
    }, {
      eventType: 'task.fail',
      reason,
      payload: { retry: true, retry_count: retry },
    });
  }

  return setStatus(id, 'failed', { blocked_reason: reason }, {
    eventType: 'task.fail',
    reason,
    payload: { retry: false },
  });
}

function requestInput(id, question) {
  return updateTask(id, {
    status: 'needs-input',
    needs_input: 1,
    input_question: question,
  }, {
    eventType: 'task.input',
    payload: { question },
  });
}

function completeTask(id) {
  return updateTask(id, {
    status: 'done',
    resolved_at: new Date().toISOString(),
    needs_input: 0,
    input_question: null,
  }, {
    eventType: 'task.done',
  });
}

function cancelTask(id, reason = null) {
  return setStatus(id, 'cancelled', {}, {
    eventType: 'task.cancel',
    reason,
    payload: { reason },
  });
}

function restoreTask(id, toStatus = 'todo') {
  return setStatus(id, toStatus, {}, {
    eventType: 'task.restore',
    payload: { restored_to: toStatus },
  });
}

function archiveTaskIds(taskIds, options = {}) {
  if (!taskIds.length) return 0;
  const placeholders = taskIds.map(() => '?').join(',');

  const rows = db.prepare(`SELECT * FROM tasks WHERE id IN (${placeholders})`).all(...taskIds);
  if (!rows.length) return 0;

  const tx = db.transaction(() => {
    const info = db.prepare(`
      UPDATE tasks
      SET status = 'archived'
      WHERE id IN (${placeholders})
    `).run(...taskIds);

    for (const row of rows) {
      if (row.status === 'archived') continue;
      insertTaskEvent(db, {
        task_id: row.id,
        task_uid: row.task_uid,
        instance_id: row.instance_id,
        client_slug: row.client_slug,
        project_slug: row.project_slug,
        event_type: options.eventType || 'task.archive',
        from_status: row.status,
        to_status: 'archived',
        payload: {
          source: options.source || null,
          reason: options.reason || null,
        },
      });
    }

    return info.changes;
  });

  return tx();
}

function archiveTasks(beforeDays) {
  const rows = db.prepare(`
    SELECT id
    FROM tasks
    WHERE status IN ('done','cancelled')
      AND date(COALESCE(resolved_at, updated_at)) < date('now', ?)
  `).all(`-${beforeDays} days`);

  return archiveTaskIds(rows.map((r) => r.id), { source: 'archive-command' });
}

function listByStatus(status, project) {
  const params = { status };
  let sql = 'SELECT * FROM tasks WHERE status = @status';
  if (project) {
    sql += ' AND project = @project';
    params.project = project;
  }
  sql += ' ORDER BY id ASC';
  return db.prepare(sql).all(params);
}

function listDoneToday(project) {
  const params = {};
  let sql = `SELECT * FROM tasks WHERE status = 'done' AND date(resolved_at) = date('now')`;
  if (project) {
    sql += ' AND project = @project';
    params.project = project;
  }
  sql += ' ORDER BY id ASC';
  return db.prepare(sql).all(params);
}

function listInProgressWithSession() {
  return db.prepare("SELECT * FROM tasks WHERE status = 'in-progress' AND session_key IS NOT NULL ORDER BY id ASC").all();
}

function listOverdue() {
  return db.prepare(`
    SELECT * FROM tasks
    WHERE due_at IS NOT NULL
      AND date(due_at) < date('now')
      AND status NOT IN ('done','cancelled','archived')
    ORDER BY due_at ASC
  `).all();
}

module.exports = {
  createTask,
  getTask,
  getSubtasks,
  listTasks,
  listTasksByParent,
  updateTask,
  appendDescription,
  setStatus,
  blockTask,
  failTask,
  requestInput,
  completeTask,
  cancelTask,
  restoreTask,
  archiveTaskIds,
  listByStatus,
  listDoneToday,
  listInProgressWithSession,
  logTaskAction,
  listTaskLog,
  addDependency,
  listDependencies,
  listUnmetDependencies,
  getStats,
  archiveTasks,
  listOverdue,
};
