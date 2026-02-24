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
  session_key     TEXT,
  blocked_reason  TEXT,
  needs_input     INTEGER DEFAULT 0,
  input_question  TEXT,
  retry_count     INTEGER DEFAULT 0,
  parent_task_id  INTEGER REFERENCES tasks(id),
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at     DATETIME
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
