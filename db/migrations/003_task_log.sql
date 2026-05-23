CREATE TABLE IF NOT EXISTS task_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks(id),
  timestamp  DATETIME DEFAULT CURRENT_TIMESTAMP,
  agent      TEXT,
  action     TEXT,
  message    TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_log_task_id ON task_log(task_id);
