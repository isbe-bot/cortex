const https = require('node:https');
const http = require('node:http');

class CortexClient {
  constructor({ baseUrl, token, timeoutMs = 10000 }) {
    this.baseUrl = String(baseUrl || 'http://127.0.0.1:8777').replace(/\/$/, '');
    this.token = token;
    this.timeoutMs = timeoutMs;
  }

  async _request(method, path, body = null) {
    const url = new URL(this.baseUrl + path);
    const lib = url.protocol === 'https:' ? https : http;

    const headers = {
      Accept: 'application/json',
    };
    if (body !== null && body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    return new Promise((resolve, reject) => {
      const req = lib.request({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers,
        timeout: this.timeoutMs,
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          let json;
          try {
            json = data ? JSON.parse(data) : null;
          } catch {
            return reject(new Error(`Invalid JSON from CORTEX (${res.statusCode}): ${data}`));
          }

          if (!json || json.success !== true) {
            const code = json?.error?.code || `HTTP_${res.statusCode}`;
            const message = json?.error?.message || 'CORTEX request failed';
            const err = new Error(`${code}: ${message}`);
            err.code = code;
            err.statusCode = res.statusCode;
            err.details = json?.error?.details;
            return reject(err);
          }
          resolve(json.meta ? { data: json.data, meta: json.meta } : json.data);
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('CORTEX request timed out'));
      });

      if (body !== null && body !== undefined) req.write(JSON.stringify(body));
      req.end();
    });
  }

  async health() { return this._request('GET', '/v1/health'); }
  async status() { return this._request('GET', '/v1/status'); }
  async list(args = {}) {
    const q = new URLSearchParams(args).toString();
    return this._request('GET', `/v1/tasks${q ? '?' + q : ''}`);
  }
  async get(id) { return this._request('GET', `/v1/tasks/${id}`); }
  async add(args) { return this._request('POST', '/v1/tasks', args); }
  async update(args) {
    const { id, ...body } = args || {};
    return this._request('PATCH', `/v1/tasks/${id}`, body);
  }
  async block(args) {
    const { id, reason } = args || {};
    return this._request('POST', `/v1/tasks/${id}/block`, { reason });
  }
  async done(args) {
    const { id } = args || {};
    return this._request('POST', `/v1/tasks/${id}/done`, {});
  }
  async input(args) {
    const { id, question } = args || {};
    return this._request('POST', `/v1/tasks/${id}/input`, { question });
  }
  async cancel(args) {
    const { id } = args || {};
    return this._request('DELETE', `/v1/tasks/${id}`);
  }
  async report(name) { return this._request('GET', `/v1/reports/${name}`); }
  async next(args = {}) {
    const result = await this.list({ ...args, status: 'todo' });
    const rows = Array.isArray(result.data) ? result.data : result;
    return rows[0] || null;
  }
}

module.exports = { CortexClient };
