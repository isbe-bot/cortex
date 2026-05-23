const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { applyMigrations, markAllMigrationsApplied } = require('./migrations');

const { resolveDbPath, loadFileConfig } = require('../lib/config');

const dbPath = resolveDbPath(process.env);
const schemaPath = path.join(__dirname, 'schema.sql');

function init() {
  if (!fs.existsSync(schemaPath)) {
    console.error('Schema file not found:', schemaPath);
    process.exit(1);
  }

  const { path: configPath } = loadFileConfig(process.env);
  const isNew = !fs.existsSync(dbPath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const db = new Database(dbPath);

  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    if (isNew) {
      db.exec(schema);
      const marked = markAllMigrationsApplied(db);
      console.log('CORTEX database initialized at', dbPath);
      if (configPath) console.log('Config file:', configPath);
      console.log(`Marked ${marked.total} migration(s) as applied for fresh schema`);
    } else {
      const result = applyMigrations(db);
      console.log('CORTEX database migrated at', dbPath);
      if (configPath) console.log('Config file:', configPath);
      console.log(`Applied ${result.applied.length}/${result.total} migration(s)`);
    }
  } catch (err) {
    console.error('Failed to initialize/migrate database:', err.message);
    process.exit(1);
  } finally {
    db.close();
  }
}

if (require.main === module) {
  init();
}

module.exports = { init };
