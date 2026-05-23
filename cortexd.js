#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { createApiServer } = require('./lib/api/server');
const { buildAuthFromEnv } = require('./lib/api/auth');

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function resolveDbPath() {
  return process.env.CORTEX_DB_PATH || path.join(__dirname, 'db', 'cortex.db');
}

function ensureDb() {
  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    die(`Database not initialized at ${dbPath}. Run: node db/init.js`);
  }
  return dbPath;
}

function parsePort(value) {
  const port = Number(value || 8777);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    die('Invalid CORTEX_API_PORT (must be 1-65535)');
  }
  return port;
}

function parseHost(value) {
  const host = value || '127.0.0.1';
  return host;
}

function main() {
  const dbPath = ensureDb();
  const auth = buildAuthFromEnv(process.env);
  const host = parseHost(process.env.CORTEX_API_HOST);
  const port = parsePort(process.env.CORTEX_API_PORT);

  const server = createApiServer({ auth, dbPath });

  server.listen(port, host, () => {
    console.log(`cortexd listening on http://${host}:${port}`);
    console.log(`db: ${dbPath}`);
    console.log(`auth required: ${auth.requireAuth ? 'yes' : 'no'}`);
  });

  process.on('SIGINT', () => {
    server.close(() => process.exit(0));
  });

  process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
  });
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    die(err.message);
  }
}
