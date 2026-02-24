const db = require('../db/client');

function createTask(data) {
  const stmt = db.prepare(`
    INSERT INTO tasks (title, description, status, step, progress, assignee, project, priority, session_key, blocked_reason, needs_input, input_question, retry_count, parent_task_id, resolved_at)
    VALUES (@title, @description, @status, @step, @progress, @assignee, @project, @priority, @session_key, @blocked_reason, @needs_input, @input_question, @retry_count, @parent_task_id, @resolved_at)
  `);
  const info = stmt.run({
    title: data.title,
    description: data.description || null,
    status: data.status || 'todo',
    step: data.step || null,
    progress: data.progress || 0,
    assignee: data.assignee || null,
    project: data.project || null,
    priority: data.priority || 'normal',
    session_key: data.session_key || null,
    blocked_reason: data.blocked_reason || null,
    needs_input: data.needs_input || 0,
    input_question: data.input_question || null,
    retry_count: data.retry_count || 0,
    parent_task_id: data.parent_task_id || null,
    resolved_at: data.resolved_at || null,
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

function updateTask(id, fields) {
  const allowed = [
    'title','description','status','step','progress','assignee','project','priority',
    'session_key','blocked_reason','needs_input','input_question','retry_count','parent_task_id','resolved_at'
  ];
  const keys = Object.keys(fields).filter(k => allowed.includes(k));
  if (keys.length === 0) return 0;

  const sets = keys.map(k => `${k} = @${k}`).join(', ');
  const stmt = db.prepare(`UPDATE tasks SET ${sets} WHERE id = @id`);
  const info = stmt.run({ ...fields, id });
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
};
