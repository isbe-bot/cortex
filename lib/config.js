const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function parseEnvFile(content) {
  const out = {};
  const lines = String(content || '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const idx = normalized.indexOf('=');
    if (idx <= 0) continue;

    const key = normalized.slice(0, idx).trim();
    let value = normalized.slice(idx + 1).trim();
    if (!key) continue;

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    out[key] = value;
  }
  return out;
}

function findConfigFile(env = process.env) {
  const candidates = [
    env.CORTEX_CONFIG,
    path.join('/etc', 'cortex', 'cortex.env'),
    path.join(repoRoot, 'configs', 'cortex.env'),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function loadFileConfig(env = process.env) {
  const configPath = findConfigFile(env);
  if (!configPath) {
    return { path: null, values: {} };
  }

  const content = fs.readFileSync(configPath, 'utf8');
  return { path: configPath, values: parseEnvFile(content) };
}

function mergeEnv(env = process.env) {
  const fileConfig = loadFileConfig(env);
  return {
    configPath: fileConfig.path,
    values: {
      ...fileConfig.values,
      ...env,
    },
  };
}

function value(source, key, fallback) {
  if (source[key] !== undefined && source[key] !== null && String(source[key]).length > 0) {
    return source[key];
  }
  return fallback;
}

function toBoolean(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function toPositiveInt(raw, fallback, name) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid ${name} (must be a positive integer)`);
  }
  return n;
}

function toPort(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error('Invalid CORTEX_API_PORT (must be 1-65535)');
  }
  return n;
}

function resolveDbPath(env = process.env) {
  const { values } = mergeEnv(env);
  return value(values, 'CORTEX_DB_PATH', path.join(repoRoot, 'db', 'cortex.db'));
}

function resolveApiConfig(env = process.env) {
  const { values } = mergeEnv(env);
  return {
    host: value(values, 'CORTEX_API_HOST', '127.0.0.1'),
    port: toPort(values.CORTEX_API_PORT, 8777),
    requireAuth: toBoolean(values.CORTEX_API_AUTH_REQUIRED, true),
    tokens: value(values, 'CORTEX_API_TOKENS', ''),
    token: value(values, 'CORTEX_API_TOKEN', ''),
    scopes: value(values, 'CORTEX_API_SCOPES', 'read,write'),
    rateLimitWindowMs: toPositiveInt(values.CORTEX_API_RATE_LIMIT_WINDOW_MS, 60000, 'CORTEX_API_RATE_LIMIT_WINDOW_MS'),
    rateLimitMax: toPositiveInt(values.CORTEX_API_RATE_LIMIT_MAX, 120, 'CORTEX_API_RATE_LIMIT_MAX'),
    requestLogging: toBoolean(values.CORTEX_API_REQUEST_LOGGING, true),
  };
}

function resolveBinaryPaths(env = process.env) {
  const { values } = mergeEnv(env);
  return {
    cliPath: value(values, 'CORTEX_CLI_PATH', path.join(repoRoot, 'cortex.js')),
    daemonPath: value(values, 'CORTEX_DAEMON_PATH', path.join(repoRoot, 'cortexd.js')),
    initPath: value(values, 'CORTEX_INIT_PATH', path.join(repoRoot, 'db', 'init.js')),
  };
}

module.exports = {
  parseEnvFile,
  loadFileConfig,
  mergeEnv,
  resolveDbPath,
  resolveApiConfig,
  resolveBinaryPaths,
};
