/**
 * Client-side CSV export helpers (no backend changes needed).
 */

function escapeCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build a CSV string from an array of objects (first row = headers from keys
 * of the first object) or a 2D array.
 * @param {Array<Record<string, any>> | any[][]} rows
 * @param {string[]} [headers] explicit header labels (with matching key order)
 */
export function toCsv(rows, headers) {
  if (!rows || rows.length === 0) return '';
  if (Array.isArray(rows[0])) {
    return rows.map((r) => r.map(escapeCell).join(',')).join('\r\n');
  }
  const keys = headers || Object.keys(rows[0]);
  const lines = [keys.map((k) => escapeCell(k)).join(',')];
  for (const row of rows) {
    lines.push(keys.map((k) => escapeCell(row[k])).join(','));
  }
  return lines.join('\r\n');
}

/**
 * Trigger a browser download of a CSV file.
 * @param {string} filename e.g. "campaign-report.csv"
 * @param {Array<Record<string, any>> | any[][]} rows
 * @param {string[]} [headers]
 */
export function downloadCsv(filename, rows, headers) {
  const csv = toCsv(rows, headers);
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default downloadCsv;
