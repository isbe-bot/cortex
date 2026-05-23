const db = require('../db/client');

function createTask(data) {
  const status = data.status || 'todo';
  const started_at = data.started_at || (status === 'in-progress' ? new Date().toISOString() : null);

  const stmt = db.prepare(`
    INSERT INTO tasks (title, description, status, step, progress, assignee, project, priority, tags, recur_interval, session_key, blocked_reason, needs_input, input_question, retry_count, parent_task_id, started_at, resolved_at, due_at)
    VALUES (@title, @description, @status, @step, @progress, @assignee, @project, @priority, @tags, @recur_interval, @session_key, @blocked_reason, @needs_input, @input_question, @retry_count, @parent_task_id, @started_at, @resolved_at, @due_at)
  `);
  const info = stmt.run({
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
  return info.lastInsertRowid;
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
  const rows = db.prepare('SELECT * FROM tasks ORDER BY id ASC').all();
  return rows;
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

function archiveTasks(beforeDays) {
  const stmt = db.prepare(`
    UPDATE tasks
    SET status = 'archived'
    WHERE status IN ('done','cancelled')
      AND date(COALESCE(resolved_at, updated_at)) < date('now', ?)
  `);
  const info = stmt.run(`-${beforeDays} days`);
  return info.changes;
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

function updateTask(id, fields) {
  const allowed = [
    'title','description','status','step','progress','assignee','project','priority','tags','recur_interval',
    'session_key','blocked_reason','needs_input','input_question','retry_count','parent_task_id','started_at','resolved_at','due_at'
  ];

  const needsRow = fields.status || (fields.status === 'in-progress' && !fields.started_at);
  const row = needsRow ? getTask(id) : null;

  if (fields.status === 'in-progress' && !fields.started_at) {
    if (row && !row.started_at) {
      fields.started_at = new Date().toISOString();
    }
  }

  const keys = Object.keys(fields).filter(k => allowed.includes(k));
  if (keys.length === 0) return 0;

  const sets = keys.map(k => `${k} = @${k}`).join(', ');
  const stmt = db.prepare(`UPDATE tasks SET ${sets} WHERE id = @id`);
  const info = stmt.run({ ...fields, id });

  if (fields.status && row && row.status !== fields.status) {
    logTaskAction(id, 'status', `${row.status} -> ${fields.status}`);
  }

  return info.changes;
}

function appendDescription(id, notes) {
  const row = getTask(id);
  if (!row) return 0;
  const current = row.description || '';
  const next = current ? `${current}\n\n${notes}` : notes;
  return updateTask(id, { description: next });
}

function setStatus(id, status, extras = {}) {
  return updateTask(id, { status, ...extras });
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

module.exports = {
  createTask,
  getTask,
  getSubtasks,
  listTasks,
  listTasksByParent,
  updateTask,
  appendDescription,
  setStatus,
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
