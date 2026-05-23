const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
const clientPath = path.join(__dirname, '..', 'db', 'client.js');
const tasksPath = path.join(__dirname, '..', 'lib', 'tasks.js');
const cortexPath = path.join(__dirname, '..', 'cortex.js');

function freshSeedContext() {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const db = new Database(':memory:');
  db.exec(schema);

  delete require.cache[require.resolve(clientPath)];
  require.cache[require.resolve(clientPath)] = { exports: db };

  delete require.cache[require.resolve(tasksPath)];
  delete require.cache[require.resolve(cortexPath)];

  const { cmdSeed } = require(cortexPath);
  const tasks = require(tasksPath);

  return { db, tasks, cmdSeed };
}

test('Guard fires when DB has tasks', () => {
  const { db, tasks, cmdSeed } = freshSeedContext();
  try {
    tasks.createTask({ title: 'Existing task' });
    const before = tasks.listTasks({}).length;

    cmdSeed();

    const after = tasks.listTasks({}).length;
    assert.equal(after, before);
  } finally {
    db.close();
  }
});

test('Seed runs on empty DB', () => {
  const { db, tasks, cmdSeed } = freshSeedContext();
  try {
    const before = tasks.listTasks({}).length;
    assert.equal(before, 0);

    cmdSeed();

    const after = tasks.listTasks({}).length;
    assert.ok(after > 0);
  } finally {
    db.close();
  }
});

test('Seed is idempotent', () => {
  const { db, tasks, cmdSeed } = freshSeedContext();
  try {
    cmdSeed();
    const afterFirst = tasks.listTasks({}).length;
    assert.ok(afterFirst > 0);

    cmdSeed();
    const afterSecond = tasks.listTasks({}).length;
    assert.equal(afterSecond, afterFirst);
  } finally {
    db.close();
  }
});
