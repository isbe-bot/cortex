CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  filename   TEXT NOT NULL,
  checksum   TEXT NOT NULL,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'todo',
  -- status values: todo | in-progress | blocked | failed | needs-input | done | cancelled
  step            TEXT,
  progress        INTEGER DEFAULT 0,
  assignee        TEXT,
  -- assignee values: isbe | carmack | picasso | chief | godfather
  project         TEXT,
  priority        TEXT DEFAULT 'normal',
  -- priority values: low | normal | high | urgent
  tags            TEXT,
  recur_interval  TEXT,
  session_key     TEXT,
  blocked_reason  TEXT,
  needs_input     INTEGER DEFAULT 0,
  input_question  TEXT,
  retry_count     INTEGER DEFAULT 0,
  parent_task_id  INTEGER REFERENCES tasks(id),
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at      DATETIME,
  resolved_at     DATETIME,
  due_at          DATETIME
);

CREATE INDEX IF NOT EXISTS idx_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_assignee ON tasks(assignee);
CREATE INDEX IF NOT EXISTS idx_project ON tasks(project);
CREATE INDEX IF NOT EXISTS idx_parent ON tasks(parent_task_id);

-- Auto-update updated_at trigger
CREATE TRIGGER IF NOT EXISTS tasks_updated_at
  AFTER UPDATE ON tasks
  FOR EACH ROW
  BEGIN
    UPDATE tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
  END;

CREATE TABLE IF NOT EXISTS task_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks(id),
  timestamp  DATETIME DEFAULT CURRENT_TIMESTAMP,
  agent      TEXT,
  action     TEXT,
  message    TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_log_task_id ON task_log(task_id);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id        INTEGER NOT NULL REFERENCES tasks(id),
  depends_on_id  INTEGER NOT NULL REFERENCES tasks(id),
  PRIMARY KEY (task_id, depends_on_id)
);

CREATE INDEX IF NOT EXISTS idx_task_deps_task ON task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_depends ON task_dependencies(depends_on_id);
