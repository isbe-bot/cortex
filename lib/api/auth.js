const ALL_SCOPES = new Set(['read', 'write', 'assign', 'approve', 'sync', 'admin']);

function parseScopes(raw) {
  if (!raw) return new Set();
  const parts = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const set = new Set();
  for (const part of parts) {
    if (part === '*') {
      for (const scope of ALL_SCOPES) set.add(scope);
      continue;
    }
    if (!ALL_SCOPES.has(part)) {
      throw new Error(`Unknown auth scope: ${part}`);
    }
    set.add(part);
  }
  return set;
}

function parseTokenConfig(raw) {
  const map = new Map();
  if (!raw) return map;

  const entries = String(raw)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const entry of entries) {
    const idx = entry.indexOf(':');
    if (idx <= 0 || idx === entry.length - 1) {
      throw new Error('Invalid CORTEX_API_TOKENS format. Expected token:scope1,scope2;token2:scope1');
    }
    const token = entry.slice(0, idx).trim();
    const scopesRaw = entry.slice(idx + 1).trim();
    if (!token) {
      throw new Error('Empty token in CORTEX_API_TOKENS');
    }
    map.set(token, parseScopes(scopesRaw));
  }

  return map;
}

function buildAuthFromEnv(env = process.env) {
  const requireAuth = env.CORTEX_API_AUTH_REQUIRED !== '0';
  let tokens = new Map();

  if (env.CORTEX_API_TOKENS) {
    tokens = parseTokenConfig(env.CORTEX_API_TOKENS);
  } else if (env.CORTEX_API_TOKEN) {
    const scopes = parseScopes(env.CORTEX_API_SCOPES || 'read,write');
    tokens.set(env.CORTEX_API_TOKEN, scopes);
  }

  if (requireAuth && tokens.size === 0) {
    throw new Error('Auth is required but no API tokens are configured. Set CORTEX_API_TOKENS or CORTEX_API_TOKEN.');
  }

  return { requireAuth, tokens };
}

function extractBearerToken(headerValue) {
  if (!headerValue) return null;
  const match = /^Bearer\s+(.+)$/i.exec(String(headerValue).trim());
  return match ? match[1].trim() : null;
}

function hasScope(tokenScopes, requiredScope) {
  if (!requiredScope) return true;
  if (!tokenScopes) return false;
  return tokenScopes.has(requiredScope) || tokenScopes.has('admin');
}

function authorize(req, authConfig, requiredScope) {
  if (!authConfig.requireAuth) {
    return { ok: true, scope: 'anonymous' };
  }

  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return { ok: false, statusCode: 401, code: 'AUTH_REQUIRED', message: 'Missing Bearer token' };
  }

  const scopes = authConfig.tokens.get(token);
  if (!scopes) {
    return { ok: false, statusCode: 401, code: 'AUTH_INVALID', message: 'Invalid API token' };
  }

  if (!hasScope(scopes, requiredScope)) {
    return {
      ok: false,
      statusCode: 403,
      code: 'AUTH_FORBIDDEN',
      message: `Token lacks required scope: ${requiredScope}`,
    };
  }

  return { ok: true, scope: requiredScope || null };
}

module.exports = {
  ALL_SCOPES,
  parseTokenConfig,
  buildAuthFromEnv,
  authorize,
};
