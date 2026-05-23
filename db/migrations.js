const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function listMigrationFiles(migrationsDir = path.join(__dirname, 'migrations')) {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs.readdirSync(migrationsDir)
    .filter(name => /^\d+_.+\.sql$/.test(name))
    .sort()
    .map(filename => ({
      filename,
      version: filename.split('_')[0],
      path: path.join(migrationsDir, filename),
    }));
}

function checksum(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex');
}

function alreadyApplied(db, version) {
  return db.prepare('SELECT * FROM schema_migrations WHERE version = ?').get(version);
}

function isBenignAlreadyAppliedError(err) {
  const msg = String(err && err.message ? err.message : err).toLowerCase();
  return msg.includes('duplicate column name') || msg.includes('already exists');
}

function markApplied(db, migration, sum) {
  db.prepare(`
    INSERT OR REPLACE INTO schema_migrations (version, filename, checksum, applied_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `).run(migration.version, migration.filename, sum);
}

function applyMigrations(db, options = {}) {
  const migrationsDir = options.migrationsDir || path.join(__dirname, 'migrations');
  ensureMigrationsTable(db);
  const files = listMigrationFiles(migrationsDir);
  const applied = [];
  const skipped = [];

  for (const migration of files) {
    const sql = fs.readFileSync(migration.path, 'utf8');
    const sum = checksum(sql);
    const existing = alreadyApplied(db, migration.version);
    if (existing) {
      if (existing.checksum !== sum) {
        throw new Error(`migration checksum changed for ${migration.filename}`);
      }
      skipped.push(migration.filename);
      continue;
    }

    try {
      db.transaction(() => {
        db.exec(sql);
        markApplied(db, migration, sum);
      })();
      applied.push(migration.filename);
    } catch (err) {
      if (!isBenignAlreadyAppliedError(err)) throw err;
      markApplied(db, migration, sum);
      skipped.push(`${migration.filename} (already satisfied)`);
    }
  }

  return { applied, skipped, total: files.length };
}

function markAllMigrationsApplied(db, options = {}) {
  const migrationsDir = options.migrationsDir || path.join(__dirname, 'migrations');
  ensureMigrationsTable(db);
  const files = listMigrationFiles(migrationsDir);
  for (const migration of files) {
    const sql = fs.readFileSync(migration.path, 'utf8');
    markApplied(db, migration, checksum(sql));
  }
  return { marked: files.map(f => f.filename), total: files.length };
}

module.exports = {
  applyMigrations,
  listMigrationFiles,
  markAllMigrationsApplied,
};
