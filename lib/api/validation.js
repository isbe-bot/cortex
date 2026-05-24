const VALID_STATUSES = new Set(['todo', 'in-progress', 'blocked', 'failed', 'needs-input', 'done', 'cancelled', 'archived']);
const VALID_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const VALID_FILTERS = new Set(['status', 'assignee', 'project', 'priority', 'tag']);
const CREATE_FIELDS = new Set(['title', 'description', 'assignee', 'project', 'priority', 'step', 'tags', 'due_at']);
const UPDATE_FIELDS = new Set([...CREATE_FIELDS, 'status', 'progress', 'session_key', 'blocked_reason', 'needs_input', 'input_question', 'parent_task_id']);

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

  const unknownErr = ensureNoUnknownKeys(body, CREATE_FIELDS);
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

function validateUpdateTaskBody(body) {
  if (!isObject(body)) {
    return { error: 'Body must be a JSON object' };
  }

  const unknownErr = ensureNoUnknownKeys(body, UPDATE_FIELDS);
  if (unknownErr) return { error: unknownErr };
  if (Object.keys(body).length === 0) return { error: 'At least one field is required' };

  const normalized = {};

  if (body.title !== undefined) {
    if (!body.title || typeof body.title !== 'string' || !body.title.trim()) return { error: 'title must be a non-empty string' };
    normalized.title = body.title.trim();
    if (normalized.title.length > 200) return { error: 'title must be <= 200 characters' };
  }

  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== 'string') return { error: 'description must be a string or null' };
    normalized.description = body.description ?? null;
  }

  if (body.assignee !== undefined) {
    if (body.assignee !== null && typeof body.assignee !== 'string') return { error: 'assignee must be a string or null' };
    normalized.assignee = body.assignee ? body.assignee.trim() || null : null;
  }

  if (body.project !== undefined) {
    if (body.project !== null && typeof body.project !== 'string') return { error: 'project must be a string or null' };
    normalized.project = body.project ? body.project.trim() || null : null;
  }

  if (body.priority !== undefined) {
    if (typeof body.priority !== 'string' || !VALID_PRIORITIES.has(body.priority)) {
      return { error: 'priority must be one of: low, normal, high, urgent' };
    }
    normalized.priority = body.priority;
  }

  if (body.step !== undefined) {
    if (body.step !== null && typeof body.step !== 'string') return { error: 'step must be a string or null' };
    normalized.step = body.step ?? null;
  }

  if (body.tags !== undefined) {
    let tags = null;
    if (Array.isArray(body.tags)) {
      if (!body.tags.every((tag) => typeof tag === 'string')) return { error: 'tags array must contain only strings' };
      tags = body.tags.map((t) => t.trim()).filter(Boolean).join(',');
    } else if (typeof body.tags === 'string') {
      tags = body.tags.split(',').map((t) => t.trim()).filter(Boolean).join(',');
    } else if (body.tags !== null) {
      return { error: 'tags must be a comma-separated string, string[], or null' };
    }
    normalized.tags = tags || null;
  }

  if (body.due_at !== undefined) {
    if (body.due_at !== null && typeof body.due_at !== 'string') return { error: 'due_at must be a string or null' };
    if (body.due_at) {
      const parsed = new Date(body.due_at);
      if (Number.isNaN(parsed.getTime())) return { error: 'due_at must be a valid date string' };
    }
    normalized.due_at = body.due_at || null;
  }

  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !VALID_STATUSES.has(body.status)) {
      return { error: `status must be one of: ${Array.from(VALID_STATUSES).join(', ')}` };
    }
    normalized.status = body.status;
  }

  if (body.progress !== undefined) {
    const n = Number(body.progress);
    if (!Number.isInteger(n) || n < 0 || n > 100) return { error: 'progress must be an integer from 0 to 100' };
    normalized.progress = n;
  }

  if (body.session_key !== undefined) {
    if (body.session_key !== null && typeof body.session_key !== 'string') return { error: 'session_key must be a string or null' };
    normalized.session_key = body.session_key || null;
  }

  if (body.blocked_reason !== undefined) {
    if (body.blocked_reason !== null && typeof body.blocked_reason !== 'string') return { error: 'blocked_reason must be a string or null' };
    normalized.blocked_reason = body.blocked_reason || null;
  }

  if (body.needs_input !== undefined) normalized.needs_input = body.needs_input ? 1 : 0;

  if (body.input_question !== undefined) {
    if (body.input_question !== null && typeof body.input_question !== 'string') return { error: 'input_question must be a string or null' };
    normalized.input_question = body.input_question || null;
  }

  if (body.parent_task_id !== undefined) {
    if (body.parent_task_id !== null) {
      const parent = Number(body.parent_task_id);
      if (!Number.isInteger(parent) || parent <= 0) return { error: 'parent_task_id must be a positive integer or null' };
      normalized.parent_task_id = parent;
    } else {
      normalized.parent_task_id = null;
    }
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
  validateUpdateTaskBody,
  parseTaskId,
};
