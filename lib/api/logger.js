function createRequestLogger(options = {}) {
  const enabled = options.enabled !== false;
  const sink = options.sink || console.error;
  const now = options.now || (() => new Date().toISOString());

  return function logRequest(entry) {
    if (!enabled) return;
    const payload = {
      ts: now(),
      event: 'api.request',
      method: entry.method,
      path: entry.path,
      status: entry.status,
      duration_ms: entry.durationMs,
      remote: entry.remote || null,
    };
    sink(JSON.stringify(payload));
  };
}

module.exports = { createRequestLogger };
