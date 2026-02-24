function pad(str, len) {
  const s = String(str ?? '');
  if (s.length >= len) return s;
  return s + ' '.repeat(len - s.length);
}

function truncate(str, len) {
  const s = String(str ?? '');
  if (s.length <= len) return s;
  return s.slice(0, len - 1) + '…';
}

function table(rows, columns) {
  const widths = columns.map(c => c.width);
  const headers = columns.map((c, i) => pad(c.label, widths[i]));
  const lines = [headers.join('  ')];
  lines.push(columns.map((c, i) => '-'.repeat(widths[i])).join('  '));
  for (const row of rows) {
    const line = columns.map((c, i) => {
      const raw = row[c.key] ?? '';
      const text = c.truncate ? truncate(raw, widths[i]) : String(raw);
      return pad(text, widths[i]);
    }).join('  ');
    lines.push(line);
  }
  return lines.join('\n');
}

function indent(text, level = 2) {
  const prefix = ' '.repeat(level);
  return text.split('\n').map(l => (l ? prefix + l : l)).join('\n');
}

module.exports = { table, indent, truncate, pad };
