// utils/csv.js — minimal CSV writer. RFC 4180 quoting + formula-injection guard.

// Leading =, +, -, @, \t, \r cause Excel/Sheets to evaluate the cell as a
// formula (DDE / HYPERLINK / WEBSERVICE) when a user opens the export.
// Prefix a literal single-quote so spreadsheet apps render the text
// verbatim. The quote is stripped on paste / re-export and is the
// recommended OWASP mitigation.
const FORMULA_CHARS = /^[=+\-@\t\r]/;

function escape(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (FORMULA_CHARS.test(s)) s = "'" + s;
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
