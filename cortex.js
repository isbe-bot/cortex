#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const tasks = require('./lib/tasks');
const display = require('./lib/display');

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function resolveDbPath() {
  return process.env.CORTEX_DB_PATH || path.join(__dirname, 'db', 'cortex.db');
}

function ensureDb() {
  const dbPath = resolveDbPath();
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
        if (opts[key] !== undefined) {
          const existing = opts[key];
          if (Array.isArray(existing)) {
            existing.push(next);
          } else {
            opts[key] = [existing, next];
          }
        } else {
          opts[key] = next;
        }
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

function printJSON(value) {
  console.log(JSON.stringify(value, null, 2));
}

function formatList(rows) {
  const data = rows.map(r => ({
    id: r.id,
    title: r.title,
    assignee: r.assignee || '-',
    status: r.status,
    progress: (typeof r.progress === 'string') ? r.progress : `${r.progress || 0}%`,
    due: r.due_at ? String(r.due_at).slice(0, 10) : '',
    priority: r.priority || 'normal',
  }));

  const columns = [
    { key: 'id', label: 'ID', width: 4 },
    { key: 'title', label: 'TITLE', width: 40, truncate: true },
    { key: 'assignee', label: 'ASSIGNEE', width: 10 },
    { key: 'status', label: 'STATUS', width: 12 },
    { key: 'progress', label: 'PROGRESS', width: 9 },
    { key: 'due', label: 'DUE', width: 10 },
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

function normalizeTags(input) {
  if (!input) return [];
  const values = Array.isArray(input) ? input : [input];
  const tags = [];
  for (const val of values) {
    if (!val) continue;
    const parts = String(val).split(',').map(t => t.trim()).filter(Boolean);
    tags.push(...parts);
  }
  return tags;
}

function normalizeIds(input) {
  if (!input) return [];
  const values = Array.isArray(input) ? input : [input];
  const ids = [];
  for (const val of values) {
    if (!val) continue;
    const parts = String(val).split(',').map(t => t.trim()).filter(Boolean);
    for (const part of parts) {
      const num = Number(part);
      if (Number.isInteger(num) && num > 0) ids.push(num);
    }
  }
  return ids;
}

function parseDays(input) {
  if (!input) return null;
  const raw = String(input).trim().toLowerCase();
  const match = raw.match(/^(\d+)(d|days)?$/);
  if (!match) return null;
  return Number(match[1]);
}

function cmdAdd(args, opts) {
  const title = args[0];
  if (!title) die('Title required');

  const tags = normalizeTags(opts.tag);
  const deps = normalizeIds(opts.depends);

  const id = tasks.createTask({
    title,
    description: opts.desc,
    assignee: opts.assign,
    project: opts.project,
    priority: opts.priority,
    parent_task_id: opts.parent ? Number(opts.parent) : null,
    step: opts.step,
    tags: tags.length ? tags.join(',') : null,
    recur_interval: opts.recur || null,
    due_at: opts.due || null,
  });

  for (const depId of deps) {
    tasks.addDependency(id, depId);
  }

  if (opts.json) {
    printJSON({ id, task: tasks.getTask(id) });
  } else {
    console.log(`Created task #${id}`);
  }
}

function buildFilters(opts) {
  const tagFilter = normalizeTags(opts.tag);
  return {
    status: opts.status,
    assignee: opts.assign,
    project: opts.project,
    priority: opts.priority,
    tag: tagFilter[0],
    excludeDoneCancelled: !opts.status,
  };
}

function cmdList(args, opts) {
  const filters = buildFilters(opts);

  const rows = tasks.listTasks(filters);
  if (opts.json) {
    printJSON({ count: rows.length, filters, tasks: rows });
    return;
  }
  if (opts.tree) {
    const tree = buildTree(rows);
    const data = tree.map(({ row, depth }) => ({
      id: row.id,
      title: `${' '.repeat(depth * 2)}${row.title}`,
      assignee: row.assignee || '-',
      status: row.status,
      progress: `${row.progress || 0}%`,
      due: row.due_at ? String(row.due_at).slice(0, 10) : '',
      priority: row.priority || 'normal',
    }));
    console.log(formatList(data));
  } else {
    console.log(formatList(rows));
  }
}

function cmdGet(args, opts = {}) {
  const id = Number(args[0]);
  if (!id) die('Task id required');
  const task = tasks.getTask(id);
  if (!task) die(`Task #${id} not found`);

  const subs = tasks.getSubtasks(task.id);
  const deps = tasks.listDependencies(task.id);
  const logs = tasks.listTaskLog(task.id, 25);
  if (opts.json) {
    printJSON({ task, subtasks: subs, dependencies: deps, log: logs });
    return;
  }

  console.log(`ID: ${task.id}`);
  console.log(`Title: ${task.title}`);
  console.log(`Description: ${task.description || ''}`);
  console.log(`Status: ${task.status}`);
  console.log(`Step: ${task.step || ''}`);
  console.log(`Progress: ${task.progress || 0}%`);
  console.log(`Assignee: ${task.assignee || ''}`);
  console.log(`Project: ${task.project || ''}`);
  console.log(`Priority: ${task.priority || ''}`);
  console.log(`Tags: ${task.tags || ''}`);
  console.log(`Recur: ${task.recur_interval || ''}`);
  console.log(`Due At: ${task.due_at || ''}`);
  console.log(`Session Key: ${task.session_key || ''}`);
  console.log(`Blocked Reason: ${task.blocked_reason || ''}`);
  console.log(`Needs Input: ${task.needs_input || 0}`);
  console.log(`Input Question: ${task.input_question || ''}`);
  console.log(`Retry Count: ${task.retry_count || 0}`);
  console.log(`Parent Task ID: ${task.parent_task_id || ''}`);
  console.log(`Created At: ${task.created_at}`);
  console.log(`Updated At: ${task.updated_at}`);
  console.log(`Started At: ${task.started_at || ''}`);
  console.log(`Resolved At: ${task.resolved_at || ''}`);

  if (task.started_at && task.resolved_at) {
    const cycleMs = new Date(task.resolved_at) - new Date(task.started_at);
    console.log(`Cycle Time: ${formatDuration(cycleMs)}`);
  }

  if (subs.length) {
    console.log('\nSubtasks:');
    for (const s of subs) {
      console.log(`  #${s.id} ${s.title} [${s.status}] ${s.progress || 0}%`);
    }
  }

  if (deps.length) {
    console.log('\nDependencies:');
    for (const d of deps) {
      console.log(`  #${d.depends_on_id} ${d.title} [${d.status}]`);
    }
  }

  if (logs.length) {
    console.log('\nRecent Log:');
    for (const entry of logs.slice(0, 5)) {
      console.log(`  ${entry.timestamp} [${entry.agent || '-'}] ${entry.action || ''} ${entry.message || ''}`.trim());
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
  if (opts.recur) fields.recur_interval = opts.recur;
  if (opts.due) fields.due_at = opts.due;

  const newTags = normalizeTags(opts.tag);
  if (newTags.length) {
    const task = tasks.getTask(id);
    if (!task) die(`Task #${id} not found`);
    const existing = normalizeTags(task.tags || '');
    const combined = existing.concat(newTags);
    fields.tags = combined.join(',');
  }

  let changed = 0;
  if (Object.keys(fields).length) {
    changed += tasks.updateTask(id, fields);
  }

  const deps = normalizeIds(opts.depends);
  if (deps.length) {
    for (const depId of deps) {
      changed += tasks.addDependency(id, depId);
    }
  }

  if (opts.notes) {
    changed += tasks.appendDescription(id, opts.notes);
  }

  if (!changed) {
    die('No changes applied');
  }
  if (opts.json) {
    printJSON({ id, changed, task: tasks.getTask(id) });
  } else {
    console.log(`Updated task #${id}`);
  }
}

function cmdBlock(args, opts = {}) {
  const id = Number(args[0]);
  const reason = args[1];
  if (!id || !reason) die('Usage: block <id> "reason"');
  tasks.setStatus(id, 'blocked', { blocked_reason: reason });
  if (opts.json) printJSON({ id, status: 'blocked', task: tasks.getTask(id) });
  else console.log(`Task #${id} blocked`);
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
    if (opts.json) printJSON({ id, status: 'in-progress', retry_count: retry, task: tasks.getTask(id) });
    else console.log(`Task #${id} set to in-progress (retry ${retry})`);
  } else {
    tasks.setStatus(id, 'failed', { blocked_reason: reason });
    if (opts.json) printJSON({ id, status: 'failed', task: tasks.getTask(id) });
    else console.log(`Task #${id} failed`);
  }
}

function cmdInput(args, opts = {}) {
  const id = Number(args[0]);
  const question = args[1];
  if (!id || !question) die('Usage: input <id> "question"');
  tasks.updateTask(id, {
    status: 'needs-input',
    needs_input: 1,
    input_question: question,
  });
  if (opts.json) printJSON({ id, status: 'needs-input', task: tasks.getTask(id) });
  else console.log(`Task #${id} flagged for input`);
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

  const task = tasks.getTask(id);
  if (task && task.recur_interval) {
    tasks.createTask({
      title: task.title,
      description: task.description || null,
      assignee: task.assignee || null,
      project: task.project || null,
      priority: task.priority || 'normal',
      tags: task.tags || null,
      parent_task_id: task.parent_task_id || null,
      recur_interval: task.recur_interval,
      status: 'todo',
      progress: 0,
    });
  }

  if (opts.json) printJSON({ id, status: 'done', task: tasks.getTask(id) });
  else console.log(`Task #${id} marked done`);
}

function cmdCancel(args, opts = {}) {
  const id = Number(args[0]);
  if (!id) die('Task id required');
  tasks.setStatus(id, 'cancelled');
  if (opts.json) printJSON({ id, status: 'cancelled', task: tasks.getTask(id) });
  else console.log(`Task #${id} cancelled`);
}

function cmdStatus(args, opts) {
  const project = opts.project;
  const now = new Date().toISOString().slice(0, 10);

  const needsInput = tasks.listByStatus('needs-input', project);
  const failed = tasks.listByStatus('failed', project);
  const blocked = tasks.listByStatus('blocked', project);
  const inProgress = tasks.listByStatus('in-progress', project);
  const todo = tasks.listByStatus('todo', project);
  const doneToday = tasks.listDoneToday(project);

  if (opts.json) {
    printJSON({
      generated_at: new Date().toISOString(),
      project: project || null,
      needs_input: needsInput,
      failed,
      blocked,
      in_progress: inProgress,
      todo,
      done_today: doneToday,
    });
    return;
  }

  console.log(`📋 CORTEX Status — ${now}\n`);

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

function formatDuration(ms) {
  if (ms < 0 || !Number.isFinite(ms)) return '';
  const seconds = Math.floor(ms / 1000);
  const mins = Math.floor(seconds / 60);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (days > 0) return `${days}d ${hrs % 24}h`;
  if (hrs > 0) return `${hrs}h ${mins % 60}m`;
  if (mins > 0) return `${mins}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function cmdBrief(args, opts) {
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

  // Standards injection
  try {
    const { matchStandards, buildInjection } = require(path.join(process.env.HOME, 'vault', 'standards', 'standards-inject.js'));
    const context = `${task.title} ${description || ''} ${task.project || ''}`;
    const matches = matchStandards(context);
    if (matches.length > 0) {
      console.log('');
      console.log('Relevant Standards:');
      for (const m of matches) {
        console.log(`  ~/vault/standards/${m.name}.md — ${m.entry.description}`);
      }
      if (opts && opts.inject) {
        console.log('');
        console.log('========== INJECTED STANDARDS ==========');
        console.log(buildInjection(matches));
        console.log('========== END STANDARDS ==========');
      } else {
        console.log('');
        console.log('(Use --inject to include full standards content)');
      }
    }
  } catch (e) {
    // Standards injection is optional — don't break brief if it fails
  }
}

function cmdNext(args, opts) {
  const filters = {
    status: 'todo',
    assignee: opts.assign,
    project: opts.project,
  };
  let rows = tasks.listTasks(filters);
  rows = rows.filter(r => tasks.listUnmetDependencies(r.id).length === 0);
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

function cmdAsk(args) {
  const query = args.join(' ').trim();
  if (!query) die('Usage: ask "question"');

  const q = query.toLowerCase();
  const agents = ['isbe', 'carmack', 'picasso', 'chief', 'godfather'];
  const statusRules = [
    { status: 'in-progress', terms: ['in progress', 'in-progress', 'working on', 'working', 'doing'] },
    { status: 'todo', terms: ['todo', 'to do', 'backlog'] },
    { status: 'blocked', terms: ['blocked', 'stuck'] },
    { status: 'failed', terms: ['failed', 'error'] },
    { status: 'needs-input', terms: ['needs input', 'needs-input', 'waiting on'] },
    { status: 'done', terms: ['done', 'completed', 'finished'] },
    { status: 'cancelled', terms: ['cancelled', 'canceled'] },
  ];

  let assignee = agents.find(a => q.includes(a)) || null;
  let status = null;
  for (const rule of statusRules) {
    if (rule.terms.some(t => q.includes(t))) {
      status = rule.status;
      break;
    }
  }

  let project = null;
  const projectMatch = q.match(/project\s+([a-z0-9_-]+)/i);
  if (projectMatch) {
    project = projectMatch[1];
  } else {
    const projects = [...new Set(tasks.listTasks({}).map(t => t.project).filter(Boolean))];
    project = projects.find(p => q.includes(p.toLowerCase())) || null;
  }

  if (q.includes('status') && !assignee && !status) {
    return cmdStatus([], { project });
  }

  const filters = {
    status,
    assignee,
    project,
    excludeDoneCancelled: !status,
  };

  const rows = tasks.listTasks(filters);
  if (!rows.length) {
    console.log('No matching tasks found.');
    return;
  }
  console.log(formatList(rows));
}

function cmdLog(args) {
  const id = Number(args[0]);
  const message = args[1];
  if (!id || !message) die('Usage: log <id> "message"');
  tasks.logTaskAction(id, 'note', message);
  console.log(`Logged entry for task #${id}`);
}

function cmdStats(args = [], opts = {}) {
  const stats = tasks.getStats();
  if (opts.json) {
    printJSON(stats);
    return;
  }
  console.log('CORTEX STATS');
  console.log('============');
  console.log(`Completed this week: ${stats.completedThisWeek}`);
  console.log(`Avg cycle time: ${formatDuration(stats.avgCycleSeconds * 1000)}`);
  console.log('');
  console.log('Tasks per agent:');
  for (const row of stats.perAgent) {
    console.log(`  ${row.assignee}: ${row.count}`);
  }
  console.log('');
  console.log('Tasks per project:');
  for (const row of stats.perProject) {
    console.log(`  ${row.project}: ${row.count}`);
  }
}

function cmdArchive(args, opts) {
  const days = parseDays(opts.before);
  if (!days) die('Usage: archive --before <days>d');
  const changes = tasks.archiveTasks(days);
  console.log(`Archived ${changes} task(s)`);
}

function cmdExport(args, opts) {
  const format = (opts.format || 'json').toLowerCase();
  const filters = buildFilters(opts);
  const rows = tasks.listTasks(filters);

  if (format === 'json') {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (format === 'csv') {
    const columns = [
      'id','title','description','status','step','progress','assignee','project','priority','tags','recur_interval',
      'session_key','blocked_reason','needs_input','input_question','retry_count','parent_task_id','created_at','updated_at','started_at','resolved_at','due_at'
    ];
    const esc = (val) => {
      const s = val === null || val === undefined ? '' : String(val);
      if (s.includes('"') || s.includes(',') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    console.log(columns.join(','));
    for (const row of rows) {
      console.log(columns.map(c => esc(row[c])).join(','));
    }
    return;
  }

  if (format === 'md' || format === 'markdown') {
    const headers = ['ID', 'Title', 'Status', 'Assignee', 'Project', 'Priority'];
    console.log(`| ${headers.join(' | ')} |`);
    console.log(`| ${headers.map(() => '---').join(' | ')} |`);
    for (const row of rows) {
      console.log(`| ${row.id} | ${row.title} | ${row.status} | ${row.assignee || ''} | ${row.project || ''} | ${row.priority || ''} |`);
    }
    return;
  }

  die('Unsupported format. Use --format json|csv|md');
}

function cmdMove(args, opts) {
  const id = Number(args[0]);
  const assignee = opts.assign;
  if (!id || !assignee) die('Usage: move <id> --assign name');
  const task = tasks.getTask(id);
  if (!task) die(`Task #${id} not found`);
  tasks.updateTask(id, { assignee });
  tasks.logTaskAction(id, 'move', `${task.assignee || '(unassigned)'} -> ${assignee}`);
  console.log(`Task #${id} reassigned to ${assignee}`);
}

function cmdOverdue(args = [], opts = {}) {
  const rows = tasks.listOverdue();
  if (opts.json) {
    printJSON({ count: rows.length, tasks: rows });
    return;
  }
  if (!rows.length) {
    console.log('No overdue tasks.');
    return;
  }
  console.log(formatList(rows));
}

function cmdHelp() {
  const lines = [
    'CORTEX CLI — commands:',
    '',
    '  help                               Show this help',
    '  ask "question"                      Natural language query',
    '  add "title" [--desc "..."] [--assign name] [--project name] [--priority high|normal|low|urgent] [--tag name] [--recur daily|weekly|monthly] [--due YYYY-MM-DD] [--depends <id>] [--parent <id>] [--step "..."] [--json]',
    '  list [--status todo|in-progress|done|blocked|failed|cancelled|needs-input] [--assign name] [--project name] [--priority level] [--tag name] [--tree] [--json]',
    '  get <id> [--json]',
    '  update <id> [--status ...] [--progress <0-100>] [--step "..."] [--assign name] [--project name] [--priority level] [--tag name] [--recur daily|weekly|monthly] [--due YYYY-MM-DD] [--depends <id>] [--parent <id>] [--title "..."] [--notes "..."] [--json]',
    '  block <id> "reason" [--json]',
    '  fail <id> "reason" [--retry] [--json]',
    '  input <id> "question" [--json]',
    '  done <id> [--notes "..."] [--json]',
    '  cancel <id> [--json]',
    '  log <id> "message"',
    '  stats [--json]',
    '  archive --before <days>d',
    '  export --format json|csv|md [--status ...] [--assign name] [--project name] [--priority level] [--tag name]',
    '  move <id> --assign name',
    '  overdue [--json]',
    '  status [--project name] [--json]',
    '  orphans',
    '  brief <id> [--inject]',
    '  next [--assign name] [--project name]',
    '  resume <id>',
    '  seed',
    '',
    'Examples:',
    '  cortex add "Ship feature" --assign carmack --project cortex --priority high',
    '  cortex list --status in-progress --assign carmack',
    '  cortex update 41 --status in-progress --progress 30 --step "phase-1"',
    '  cortex done 41 --notes "Shipped"',
  ];
  console.log(lines.join('\n'));
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const { args, opts } = parseArgs(argv.slice(1));

  if (!cmd) die('Command required');

  if (cmd !== 'init' && cmd !== 'help' && cmd !== '--help' && !opts.help) {
    ensureDb();
  }

  try {
    if (cmd === '--help' || opts.help) {
      return cmdHelp();
    }
    switch (cmd) {
      case 'help': return cmdHelp();
      case 'ask': return cmdAsk(args, opts);
      case 'add': return cmdAdd(args, opts);
      case 'list': return cmdList(args, opts);
      case 'get': return cmdGet(args, opts);
      case 'update': return cmdUpdate(args, opts);
      case 'block': return cmdBlock(args, opts);
      case 'fail': return cmdFail(args, opts);
      case 'input': return cmdInput(args, opts);
      case 'done': return cmdDone(args, opts);
      case 'cancel': return cmdCancel(args, opts);
      case 'log': return cmdLog(args);
      case 'stats': return cmdStats(args, opts);
      case 'archive': return cmdArchive(args, opts);
      case 'export': return cmdExport(args, opts);
      case 'move': return cmdMove(args, opts);
      case 'overdue': return cmdOverdue(args, opts);
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

if (require.main === module) {
  main();
}

module.exports = {
  cmdSeed,
};
