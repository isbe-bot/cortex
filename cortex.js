#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const tasks = require('./lib/tasks');
const display = require('./lib/display');

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function ensureDb() {
  const dbPath = path.join(__dirname, 'db', 'cortex.db');
  if (!fs.existsSync(dbPath)) {
    die('Database not initialized. Run: node db/init.js');
  }
}

function parseArgs(argv) {
  const args = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = true;
      }
    } else {
      args.push(a);
    }
  }
  return { args, opts };
}

function formatList(rows) {
  const data = rows.map(r => ({
    id: r.id,
    title: r.title,
    assignee: r.assignee || '-',
    status: r.status,
    progress: (typeof r.progress === 'string') ? r.progress : `${r.progress || 0}%`,
    priority: r.priority || 'normal',
  }));

  const columns = [
    { key: 'id', label: 'ID', width: 4 },
    { key: 'title', label: 'TITLE', width: 40, truncate: true },
    { key: 'assignee', label: 'ASSIGNEE', width: 10 },
    { key: 'status', label: 'STATUS', width: 12 },
    { key: 'progress', label: 'PROGRESS', width: 9 },
    { key: 'priority', label: 'PRIORITY', width: 8 },
  ];

  return display.table(data, columns);
}

function buildTree(rows) {
  const byParent = new Map();
  for (const r of rows) {
    const pid = r.parent_task_id || 0;
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push(r);
  }

  const ordered = [];
  function walk(parentId, depth) {
    const children = byParent.get(parentId) || [];
    for (const child of children) {
      ordered.push({ row: child, depth });
      walk(child.id, depth + 1);
    }
  }
  walk(0, 0);
  return ordered;
}

function cmdAdd(args, opts) {
  const title = args[0];
  if (!title) die('Title required');

  const id = tasks.createTask({
    title,
    description: opts.desc,
    assignee: opts.assign,
    project: opts.project,
    priority: opts.priority,
    parent_task_id: opts.parent ? Number(opts.parent) : null,
    step: opts.step,
  });
  console.log(`Created task #${id}`);
}

function cmdList(args, opts) {
  const filters = {
    status: opts.status,
    assignee: opts.assign,
    project: opts.project,
    priority: opts.priority,
    excludeDoneCancelled: !opts.status,
  };

  const rows = tasks.listTasks(filters);
  if (opts.tree) {
    const tree = buildTree(rows);
    const data = tree.map(({ row, depth }) => ({
      id: row.id,
      title: `${' '.repeat(depth * 2)}${row.title}`,
      assignee: row.assignee || '-',
      status: row.status,
      progress: `${row.progress || 0}%`,
      priority: row.priority || 'normal',
    }));
    console.log(formatList(data));
  } else {
    console.log(formatList(rows));
  }
}

function cmdGet(args) {
  const id = Number(args[0]);
  if (!id) die('Task id required');
  const task = tasks.getTask(id);
  if (!task) die(`Task #${id} not found`);

  console.log(`ID: ${task.id}`);
  console.log(`Title: ${task.title}`);
  console.log(`Description: ${task.description || ''}`);
  console.log(`Status: ${task.status}`);
  console.log(`Step: ${task.step || ''}`);
  console.log(`Progress: ${task.progress || 0}%`);
  console.log(`Assignee: ${task.assignee || ''}`);
  console.log(`Project: ${task.project || ''}`);
  console.log(`Priority: ${task.priority || ''}`);
  console.log(`Session Key: ${task.session_key || ''}`);
  console.log(`Blocked Reason: ${task.blocked_reason || ''}`);
  console.log(`Needs Input: ${task.needs_input || 0}`);
  console.log(`Input Question: ${task.input_question || ''}`);
  console.log(`Retry Count: ${task.retry_count || 0}`);
  console.log(`Parent Task ID: ${task.parent_task_id || ''}`);
  console.log(`Created At: ${task.created_at}`);
  console.log(`Updated At: ${task.updated_at}`);
  console.log(`Resolved At: ${task.resolved_at || ''}`);

  const subs = tasks.getSubtasks(task.id);
  if (subs.length) {
    console.log('\nSubtasks:');
    for (const s of subs) {
      console.log(`  #${s.id} ${s.title} [${s.status}] ${s.progress || 0}%`);
    }
  }
}

function cmdUpdate(args, opts) {
  const id = Number(args[0]);
  if (!id) die('Task id required');

  const fields = {};
  if (opts.status) fields.status = opts.status;
  if (opts.progress !== undefined) fields.progress = Number(opts.progress);
  if (opts.step) fields.step = opts.step;
  if (opts.session) fields.session_key = opts.session;
  if (opts.assign) fields.assignee = opts.assign;
  if (opts.project) fields.project = opts.project;
  if (opts.priority) fields.priority = opts.priority;
  if (opts.parent) fields.parent_task_id = Number(opts.parent);
  if (opts.title) fields.title = opts.title;

  let changed = 0;
  if (Object.keys(fields).length) {
    changed += tasks.updateTask(id, fields);
  }
  if (opts.notes) {
    changed += tasks.appendDescription(id, opts.notes);
  }

  if (!changed) {
    die('No changes applied');
  }
  console.log(`Updated task #${id}`);
}

function cmdBlock(args) {
  const id = Number(args[0]);
  const reason = args[1];
  if (!id || !reason) die('Usage: block <id> "reason"');
  tasks.setStatus(id, 'blocked', { blocked_reason: reason });
  console.log(`Task #${id} blocked`);
}

function cmdFail(args, opts) {
  const id = Number(args[0]);
  const reason = args[1];
  if (!id || !reason) die('Usage: fail <id> "reason"');

  if (opts.retry) {
    const task = tasks.getTask(id);
    if (!task) die(`Task #${id} not found`);
    const retry = (task.retry_count || 0) + 1;
    tasks.updateTask(id, {
      status: 'in-progress',
      retry_count: retry,
      blocked_reason: reason,
    });
    console.log(`Task #${id} set to in-progress (retry ${retry})`);
  } else {
    tasks.setStatus(id, 'failed', { blocked_reason: reason });
    console.log(`Task #${id} failed`);
  }
}

function cmdInput(args) {
  const id = Number(args[0]);
  const question = args[1];
  if (!id || !question) die('Usage: input <id> "question"');
  tasks.updateTask(id, {
    status: 'needs-input',
    needs_input: 1,
    input_question: question,
  });
  console.log(`Task #${id} flagged for input`);
}

function cmdDone(args, opts) {
  const id = Number(args[0]);
  if (!id) die('Task id required');
  tasks.updateTask(id, {
    status: 'done',
    resolved_at: new Date().toISOString(),
  });
  if (opts.notes) {
    tasks.appendDescription(id, opts.notes);
  }
  console.log(`Task #${id} marked done`);
}

function cmdCancel(args) {
  const id = Number(args[0]);
  if (!id) die('Task id required');
  tasks.setStatus(id, 'cancelled');
  console.log(`Task #${id} cancelled`);
}

function cmdStatus(args, opts) {
  const project = opts.project;
  const now = new Date().toISOString().slice(0, 10);
  console.log(`📋 CORTEX Status — ${now}\n`);

  const needsInput = tasks.listByStatus('needs-input', project);
  const failed = tasks.listByStatus('failed', project);
  const blocked = tasks.listByStatus('blocked', project);
  const inProgress = tasks.listByStatus('in-progress', project);
  const todo = tasks.listByStatus('todo', project);
  const doneToday = tasks.listDoneToday(project);

  function section(title, rows, formatter) {
    console.log(title + ` (${rows.length})`);
    if (rows.length === 0) {
      console.log('  (none)\n');
      return;
    }
    for (const r of rows) {
      console.log('  ' + formatter(r));
    }
    console.log('');
  }

  section('⚡ NEEDS INPUT', needsInput, r => `#${r.id} ${r.title} [${r.assignee || '-'}] — ${r.input_question || ''}`);
  section('🔴 FAILED', failed, r => `#${r.id} ${r.title} [${r.assignee || '-'}] retries: ${r.retry_count || 0} — ${r.blocked_reason || ''}`);
  section('🟠 BLOCKED', blocked, r => `#${r.id} ${r.title} [${r.assignee || '-'}] — ${r.blocked_reason || ''}`);
  section('🟡 IN PROGRESS', inProgress, r => `#${r.id} ${r.title} [${r.assignee || '-'}] ${r.progress || 0}% — ${r.step || ''}`);
  section('⚪ TODO', todo, r => `#${r.id} ${r.title} [${r.assignee || '-'}] [${r.priority || 'normal'}]`);
  section('✅ DONE TODAY', doneToday, r => `#${r.id} ${r.title} [${r.assignee || '-'}]`);
}

function cmdOrphans() {
  const rows = tasks.listInProgressWithSession();
  if (rows.length === 0) {
    console.log('No in-progress tasks with session_key');
    return;
  }
  console.log('In-progress tasks with session_key:');
  for (const r of rows) {
    console.log(`#${r.id} ${r.title} [${r.assignee || '-'}] session: ${r.session_key}`);
  }
}

function splitDescription(text) {
  const raw = text || '';
  if (!raw) return { description: '', notes: '' };
  const parts = raw.split(/\n\n+/);
  if (parts.length === 1) return { description: raw, notes: '' };
  const description = parts.shift();
  const notes = parts.join('\n\n');
  return { description, notes };
}

function formatSubtasks(rows) {
  if (!rows.length) return 'Subtasks: (none)';
  const lines = ['Subtasks:'];
  for (const s of rows) {
    lines.push(`  #${s.id} ${s.title} [${s.status}] ${s.progress || 0}%`);
  }
  return lines.join('\n');
}

function cmdBrief(args) {
  const id = Number(args[0]);
  if (!id) die('Task id required');
  const task = tasks.getTask(id);
  if (!task) die(`Task #${id} not found`);

  const subs = tasks.listTasks({ parent_task_id: id });
  const { description, notes } = splitDescription(task.description);
  const step = task.step || '(none)';
  const progress = `${task.progress || 0}%`;
  const retry = task.retry_count || 0;
  const blocked = task.blocked_reason || '(none)';
  const needsInput = task.needs_input ? 'yes' : 'no';

  console.log(`CORTEX TASK BRIEF — #${task.id}`);
  console.log('=======================');
  console.log(`Title:        ${task.title}`);
  console.log(`Project:      ${task.project || '(none)'}`);
  console.log(`Assignee:     ${task.assignee || '(none)'}`);
  console.log(`Priority:     ${task.priority || 'normal'}`);
  console.log(`Status:       ${task.status}`);
  console.log(`Step:         ${step}`);
  console.log(`Progress:     ${progress}`);
  console.log(`Retry Count:  ${retry}`);
  console.log('');
  console.log('Description:');
  console.log(description ? description : '(none)');
  console.log('');
  console.log(`Blocked Reason: ${blocked}`);
  console.log(`Needs Input:    ${needsInput}`);
  console.log('');
  console.log(formatSubtasks(subs));
  console.log('');
  console.log('Notes/History:');
  console.log(notes ? notes : '(none)');
}

function cmdNext(args, opts) {
  const filters = {
    status: 'todo',
    assignee: opts.assign,
    project: opts.project,
  };
  const rows = tasks.listTasks(filters);
  if (rows.length === 0) {
    if (opts.assign) {
      console.log(`No todo tasks found for ${opts.assign}.`);
    } else {
      console.log('No todo tasks found.');
    }
    return;
  }

  const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 };
  rows.sort((a, b) => {
    const pa = priorityRank[a.priority || 'normal'] ?? 2;
    const pb = priorityRank[b.priority || 'normal'] ?? 2;
    if (pa !== pb) return pa - pb;
    return a.id - b.id;
  });

  const task = rows[0];
  const who = opts.assign || 'queue';
  console.log(`NEXT TASK FOR ${who}:`);
  console.log('');
  console.log(`  #${task.id}  ${task.title}`);
  console.log(`       Project:  ${task.project || '(none)'} | Priority: ${task.priority || 'normal'} | Status: ${task.status}`);
  console.log(`       Description: ${task.description || '(none)'}`);
}

function cmdResume(args) {
  const id = Number(args[0]);
  if (!id) die('Task id required');
  const task = tasks.getTask(id);
  if (!task) die(`Task #${id} not found`);

  console.log(`RESUMING TASK #${task.id}`);
  console.log('=================');
  cmdBrief([id]);
  console.log('');

  const retry = task.retry_count || 0;
  const lastStep = task.step || (retry > 0 ? '(none)' : '(none — starting fresh)');
  const blocked = task.blocked_reason || '(none)';
  let suggestion = 'Start from the beginning — no prior attempt recorded.';
  if (retry > 0) {
    suggestion = `Resume from last step. Previous failure: ${blocked} — address this before proceeding.`;
  }

  console.log('CONTINUATION CONTEXT:');
  console.log(`  Last step:      ${lastStep}`);
  console.log(`  Retry count:    ${retry}`);
  console.log(`  Last blocked:   ${blocked}`);
  console.log(`  Suggestion:     ${suggestion}`);
}

function cmdSeed() {
  // Guard: don't double-seed
  const existing = tasks.listTasks({});
  if (existing.length > 0) {
    console.log(`Seed skipped: DB already has ${existing.length} task(s). Use 'list' to view.`);
    return;
  }
  const parentId = tasks.createTask({
    title: 'Build CORTEX — Agent Coordination System',
    project: 'cortex',
    assignee: 'isbe',
    priority: 'high',
    status: 'in-progress',
    step: 'phase-1/building-core',
  });

  const seedTasks = [
    { title: 'Initialize CORTEX git repo and project structure', assignee: 'carmack', status: 'done', progress: 100 },
    { title: 'Build SQLite schema and db initialization', assignee: 'carmack', status: 'in-progress', progress: 80 },
    { title: 'Build cortex.js CLI — all commands', assignee: 'carmack', status: 'in-progress', progress: 50 },
    { title: 'Integrate CORTEX into HEARTBEAT.md', assignee: 'isbe', status: 'todo' },
    { title: 'Add orphan detection to heartbeat', assignee: 'isbe', status: 'todo' },
    { title: 'Write CORTEX README.md', assignee: 'carmack', status: 'todo' },
    { title: 'Test all commands end-to-end', assignee: 'carmack', status: 'todo' },
    { title: 'Push to GitHub as isbe-bot', assignee: 'isbe', status: 'todo' },
  ];

  for (const t of seedTasks) {
    tasks.createTask({
      title: t.title,
      assignee: t.assignee,
      status: t.status,
      progress: t.progress || 0,
      parent_task_id: parentId,
      project: 'cortex',
    });
  }

  console.log('Seeded CORTEX tasks');
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const { args, opts } = parseArgs(argv.slice(1));

  if (!cmd) die('Command required');

  if (cmd !== 'init') {
    ensureDb();
  }

  try {
    switch (cmd) {
      case 'add': return cmdAdd(args, opts);
      case 'list': return cmdList(args, opts);
      case 'get': return cmdGet(args);
      case 'update': return cmdUpdate(args, opts);
      case 'block': return cmdBlock(args);
      case 'fail': return cmdFail(args, opts);
      case 'input': return cmdInput(args);
      case 'done': return cmdDone(args, opts);
      case 'cancel': return cmdCancel(args);
      case 'status': return cmdStatus(args, opts);
      case 'orphans': return cmdOrphans();
      case 'brief': return cmdBrief(args, opts);
      case 'next': return cmdNext(args, opts);
      case 'resume': return cmdResume(args, opts);
      case 'seed': return cmdSeed();
      default:
        die(`Unknown command: ${cmd}`);
    }
  } catch (err) {
    die(err.message);
  }
}

main();
