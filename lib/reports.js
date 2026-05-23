const tasks = require('./tasks');

function getSummary() {
  const all = tasks.listTasks({ excludeDoneCancelled: false });
  const byStatus = {};
  const byProject = {};
  const byAssignee = {};

  for (const t of all) {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    if (t.project) byProject[t.project] = (byProject[t.project] || 0) + 1;
    const assignee = t.assignee || 'unassigned';
    byAssignee[assignee] = (byAssignee[assignee] || 0) + 1;
  }

  const blocked = tasks.listByStatus('blocked');
  const needsInput = tasks.listByStatus('needs-input');
  const overdue = tasks.listOverdue ? tasks.listOverdue() : [];

  return {
    total: all.length,
    by_status: byStatus,
    by_project: byProject,
    by_assignee: byAssignee,
    blocked_count: blocked.length,
    needs_input_count: needsInput.length,
    overdue_count: overdue.length,
  };
}

function getBlocked() {
  return tasks.listByStatus('blocked');
}

function getOverdue() {
  return tasks.listOverdue ? tasks.listOverdue() : [];
}

function getActivity(limit = 20) {
  // Placeholder — real implementation would read from task_events
  return [];
}

module.exports = {
  getSummary,
  getBlocked,
  getOverdue,
  getActivity,
};
