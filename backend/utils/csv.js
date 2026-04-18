// utils/csv.js — minimal CSV writer. RFC 4180 quoting, no deps.

function escape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function rowToCsv(row, columns) {
  return columns.map(c => escape(row[c])).join(',');
}

export function toCsvStream(rows, columns) {
  let out = columns.join(',') + '\r\n';
  for (const r of rows) out += rowToCsv(r, columns) + '\r\n';
  return out;
}
