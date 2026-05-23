const https = require('node:https');
const http = require('node:http');

class CortexClient {
  constructor({ baseUrl, token, timeoutMs = 10000 }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.timeoutMs = timeoutMs;
  }

  async _request(method, path, body = null) {
    const url = new URL(this.baseUrl + path);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    return new Promise((resolve, reject) => {
      const req = lib.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers,
        timeout: this.timeoutMs,
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (!json.success) {
              return reject(new Error(json.error?.message || 'CORTEX error'));
            }
            resolve(json.data);
          } catch (e) {
            reject(new Error(`Invalid JSON from CORTEX: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('CORTEX request timed out'));
      });

      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  async status() {
    return this._request('GET', '/v1/status');
  }

  async list(args = {}) {
    const q = new URLSearchParams(args).toString();
    return this._request('GET', `/v1/tasks${q ? '?' + q : ''}`);
  }

  async get(id) {
    return this._request('GET', `/v1/tasks/${id}`);
  }

  async add(args) {
    return this._request('POST', '/v1/tasks', args);
  }

  async update(args) {
    const { id, ...body } = args;
    return this._request('PATCH', `/v1/tasks/${id}`, body);
  }

  async block(args) {
    const { id, reason } = args;
    return this._request('POST', `/v1/tasks/${id}/block`, { reason });
  }

  async done(args) {
    const { id, notes } = args;
    return this._request('POST', `/v1/tasks/${id}/done`, { notes });
  }

  async input(args) {
    const { id, question } = args;
    return this._request('POST', `/v1/tasks/${id}/input`, { question });
  }

  async next(args = {}) {
    return this._request('GET', '/v1/next', args);
  }
}

module.exports = { CortexClient };
