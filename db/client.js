const Database = require('better-sqlite3');
const { resolveDbPath } = require('../lib/config');

const dbPath = resolveDbPath(process.env);
const db = new Database(dbPath);

// Pragmas for reasonable defaults
try {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
} catch (err) {
  // Non-fatal; continue
}

module.exports = db;
