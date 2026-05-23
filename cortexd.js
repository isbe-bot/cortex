#!/usr/bin/env node

const fs = require('node:fs');
const { createApiServer } = require('./lib/api/server');
const { buildAuthFromEnv } = require('./lib/api/auth');
const { resolveDbPath, resolveApiConfig, mergeEnv, loadFileConfig } = require('./lib/config');

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function ensureDb() {
  const dbPath = resolveDbPath(process.env);
  if (!fs.existsSync(dbPath)) {
    die(`Database not initialized at ${dbPath}. Run: node db/init.js`);
  }
  return dbPath;
}

function main() {
  const dbPath = ensureDb();
  const { values: mergedEnv } = mergeEnv(process.env);
  const apiConfig = resolveApiConfig(process.env);
  const auth = buildAuthFromEnv({
    ...mergedEnv,
    CORTEX_API_AUTH_REQUIRED: apiConfig.requireAuth ? '1' : '0',
  });

  const { path: configPath } = loadFileConfig(process.env);
  const host = apiConfig.host;
  const port = apiConfig.port;

  const server = createApiServer({ auth, dbPath });

  server.listen(port, host, () => {
    console.log(`cortexd listening on http://${host}:${port}`);
    console.log(`db: ${dbPath}`);
    console.log(`auth required: ${auth.requireAuth ? 'yes' : 'no'}`);
    if (configPath) console.log(`config: ${configPath}`);
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
