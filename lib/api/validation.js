const VALID_STATUSES = new Set(['todo', 'in-progress', 'blocked', 'failed', 'needs-input', 'done', 'cancelled', 'archived']);
const VALID_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const VALID_FILTERS = new Set(['status', 'assignee', 'project', 'priority', 'tag']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function ensureNoUnknownKeys(obj, allowedKeys) {
  const unknown = Object.keys(obj).filter((k) => !allowedKeys.has(k));
  if (unknown.length > 0) {
    return `Unknown fields: ${unknown.join(', ')}`;
  }
  return null;
}

function parseListFilters(searchParams) {
  const filters = {};
  for (const [key, value] of searchParams.entries()) {
    if (!VALID_FILTERS.has(key)) {
      return { error: `Unknown query parameter: ${key}` };
    }
    filters[key] = value;
  }

  if (filters.status && !VALID_STATUSES.has(filters.status)) {
    return { error: `Invalid status: ${filters.status}` };
  }
  if (filters.priority && !VALID_PRIORITIES.has(filters.priority)) {
    return { error: `Invalid priority: ${filters.priority}` };
  }

  return { filters };
}

function validateCreateTaskBody(body) {
  if (!isObject(body)) {
    return { error: 'Body must be a JSON object' };
  }

  const allowed = new Set(['title', 'description', 'assignee', 'project', 'priority', 'step', 'tags', 'due_at']);
  const unknownErr = ensureNoUnknownKeys(body, allowed);
  if (unknownErr) return { error: unknownErr };

  if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
    return { error: 'title is required' };
  }

  const normalized = {
    title: body.title.trim(),
  };

  if (normalized.title.length > 200) {
    return { error: 'title must be <= 200 characters' };
  }

  if (body.description !== undefined) {
    if (typeof body.description !== 'string') return { error: 'description must be a string' };
    normalized.description = body.description;
  }

  if (body.assignee !== undefined) {
    if (typeof body.assignee !== 'string') return { error: 'assignee must be a string' };
    normalized.assignee = body.assignee.trim() || null;
  }

  if (body.project !== undefined) {
    if (typeof body.project !== 'string') return { error: 'project must be a string' };
    normalized.project = body.project.trim() || null;
  }

  if (body.priority !== undefined) {
    if (typeof body.priority !== 'string' || !VALID_PRIORITIES.has(body.priority)) {
      return { error: 'priority must be one of: low, normal, high, urgent' };
    }
    normalized.priority = body.priority;
  }

  if (body.step !== undefined) {
    if (typeof body.step !== 'string') return { error: 'step must be a string' };
    normalized.step = body.step;
  }

  if (body.tags !== undefined) {
    let tags = null;
    if (Array.isArray(body.tags)) {
      if (!body.tags.every((tag) => typeof tag === 'string')) {
        return { error: 'tags array must contain only strings' };
      }
      tags = body.tags.map((t) => t.trim()).filter(Boolean).join(',');
    } else if (typeof body.tags === 'string') {
      tags = body.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .join(',');
    } else {
      return { error: 'tags must be a comma-separated string or string[]' };
    }
    normalized.tags = tags || null;
  }

  if (body.due_at !== undefined) {
    if (typeof body.due_at !== 'string') return { error: 'due_at must be a string' };
    const parsed = new Date(body.due_at);
    if (Number.isNaN(parsed.getTime())) {
      return { error: 'due_at must be a valid date string' };
    }
    normalized.due_at = body.due_at;
  }

  return { value: normalized };
}

function parseTaskId(pathSegment) {
  if (!pathSegment) return null;
  const id = Number(pathSegment);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

module.exports = {
  parseListFilters,
  validateCreateTaskBody,
  parseTaskId,
};
