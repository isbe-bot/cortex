const { CortexClient } = require('./client');

async function register({ config, tools }) {
  const client = new CortexClient({
    baseUrl: config.baseUrl || 'http://127.0.0.1:8777',
    token: config.token || process.env.CORTEX_API_TOKEN,
    timeoutMs: config.timeoutMs || 10000,
  });

  // Register all tools
  tools.register('cortex.status', async () => client.status());
  tools.register('cortex.list', async (args) => client.list(args));
  tools.register('cortex.get', async (args) => client.get(args.id));
  tools.register('cortex.add', async (args) => client.add(args));
  tools.register('cortex.update', async (args) => client.update(args));
  tools.register('cortex.block', async (args) => client.block(args));
  tools.register('cortex.done', async (args) => client.done(args));
  tools.register('cortex.input', async (args) => client.input(args));
  tools.register('cortex.next', async (args) => client.next(args));

  return { client };
}

module.exports = { register };
