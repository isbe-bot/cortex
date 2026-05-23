const test = require('node:test');
const assert = require('node:assert');
const { CortexClient } = require('./client');

test('CortexClient can be instantiated', () => {
  const client = new CortexClient({ baseUrl: 'http://127.0.0.1:8777' });
  assert.ok(client);
  assert.strictEqual(client.baseUrl, 'http://127.0.0.1:8777');
});

test('CortexClient throws on invalid JSON', async () => {
  const client = new CortexClient({ baseUrl: 'http://127.0.0.1:1' }); // invalid port
  await assert.rejects(() => client.status(), /CORTEX request timed out|ECONNREFUSED/);
});
