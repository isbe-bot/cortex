CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id        INTEGER NOT NULL REFERENCES tasks(id),
  depends_on_id  INTEGER NOT NULL REFERENCES tasks(id),
  PRIMARY KEY (task_id, depends_on_id)
);

CREATE INDEX IF NOT EXISTS idx_task_deps_task ON task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_depends ON task_dependencies(depends_on_id);
