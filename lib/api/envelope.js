function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function ok(res, data, meta) {
  const payload = { success: true, data };
  if (meta) payload.meta = meta;
  sendJson(res, 200, payload);
}

function created(res, data) {
  sendJson(res, 201, { success: true, data });
}

function error(res, statusCode, code, message, details) {
  const payload = {
    success: false,
    error: {
      code,
      message,
    },
  };
  if (details !== undefined) {
    payload.error.details = details;
  }
  sendJson(res, statusCode, payload);
}

module.exports = {
  ok,
  created,
  error,
};
