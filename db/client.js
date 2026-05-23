const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.CORTEX_DB_PATH || path.join(__dirname, 'cortex.db');
const db = new Database(dbPath);

// Pragmas for reasonable defaults
try {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
} catch (err) {
  // Non-fatal; continue
}

module.exports = db;
