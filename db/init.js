const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'cortex.db');
const schemaPath = path.join(__dirname, 'schema.sql');

function init() {
  if (!fs.existsSync(schemaPath)) {
    console.error('Schema file not found:', schemaPath);
    process.exit(1);
  }

  const schema = fs.readFileSync(schemaPath, 'utf8');
  const db = new Database(dbPath);

  try {
    db.exec(schema);
    console.log('CORTEX database initialized at', dbPath);
  } catch (err) {
    console.error('Failed to initialize database:', err.message);
    process.exit(1);
  } finally {
    db.close();
  }
}

init();
