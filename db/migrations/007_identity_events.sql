ALTER TABLE tasks ADD COLUMN task_uid TEXT;
ALTER TABLE tasks ADD COLUMN instance_id TEXT;
ALTER TABLE tasks ADD COLUMN client_slug TEXT;
ALTER TABLE tasks ADD COLUMN project_slug TEXT;

CREATE TABLE IF NOT EXISTS cortex_identity (
  singleton    INTEGER PRIMARY KEY CHECK (singleton = 1),
  instance_id  TEXT NOT NULL,
  client_slug  TEXT NOT NULL,
  project_slug TEXT NOT NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO cortex_identity (singleton, instance_id, client_slug, project_slug)
VALUES (1, 'inst_' || lower(hex(randomblob(16))), 'local', 'cortex')
ON CONFLICT(singleton) DO NOTHING;

UPDATE tasks
SET
  task_uid = COALESCE(task_uid, 'task_' || lower(hex(randomblob(16)))),
  instance_id = COALESCE(instance_id, (SELECT instance_id FROM cortex_identity WHERE singleton = 1)),
  client_slug = COALESCE(client_slug, (SELECT client_slug FROM cortex_identity WHERE singleton = 1)),
  project_slug = COALESCE(
    project_slug,
    CASE
      WHEN project IS NULL OR trim(project) = '' THEN (SELECT project_slug FROM cortex_identity WHERE singleton = 1)
      ELSE lower(trim(replace(replace(project, ' ', '-'), '_', '-')))
    END
  )
WHERE task_uid IS NULL OR instance_id IS NULL OR client_slug IS NULL OR project_slug IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_task_uid ON tasks(task_uid);
CREATE INDEX IF NOT EXISTS idx_tasks_identity ON tasks(instance_id, client_slug, project_slug);

CREATE TABLE IF NOT EXISTS task_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_uid    TEXT NOT NULL UNIQUE,
  task_id      INTEGER REFERENCES tasks(id),
  task_uid     TEXT,
  instance_id  TEXT NOT NULL,
  client_slug  TEXT NOT NULL,
  project_slug TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  from_status  TEXT,
  to_status    TEXT,
  actor        TEXT,
  payload_json TEXT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_task_events_task_id ON task_events(task_id);
CREATE INDEX IF NOT EXISTS idx_task_events_task_uid ON task_events(task_uid);
CREATE INDEX IF NOT EXISTS idx_task_events_type_time ON task_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_task_events_created_at ON task_events(created_at);

CREATE TRIGGER IF NOT EXISTS task_events_append_only_update
  BEFORE UPDATE ON task_events
  FOR EACH ROW
  BEGIN
    SELECT RAISE(ABORT, 'task_events is append-only');
  END;

CREATE TRIGGER IF NOT EXISTS task_events_append_only_delete
  BEFORE DELETE ON task_events
  FOR EACH ROW
  BEGIN
    SELECT RAISE(ABORT, 'task_events is append-only');
  END;
