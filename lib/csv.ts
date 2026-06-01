// Tiny CSV + Markdown helpers. CSV uses RFC 4180 escaping (quote any cell
// containing comma, quote, CR, or LF; double internal quotes), CRLF line
// endings. Markdown uses the GFM table form, with pipes/newlines escaped
// inside cells. Kept here so the dashboard, signals, and trends views can
// share the same export format.

const NEEDS_QUOTE = /[",\r\n]/

function escapeCsvCell(value: string): string {
  if (!NEEDS_QUOTE.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

export function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines: string[] = [headers.map(escapeCsvCell).join(',')]
  for (const row of rows) lines.push(row.map(escapeCsvCell).join(','))
  return lines.join('\r\n')
}

function escapeMdCell(value: string): string {
  // Pipes break the column boundary; newlines break the row. <br> is the
  // standard substitute in GFM tables. Backslashes themselves don't need
  // escaping inside a cell.
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' <br> ')
}

export function toMarkdown(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const head = `| ${headers.map(escapeMdCell).join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((r) => `| ${r.map(escapeMdCell).join(' | ')} |`).join('\n')
  return `${head}\n${sep}\n${body}`
}

/** Trigger a browser download. Type comes from the caller — csv vs md. */
export function downloadFile(filename: string, content: string, mime: string): void {
  // BOM helps Excel detect UTF-8 properly when opening .csv files directly;
  // harmless on text/markdown.
  const blob = new Blob(['﻿', content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Back-compat shim for callers still naming the CSV-specific download. */
export function downloadCsv(filename: string, content: string): void {
  downloadFile(filename, content, 'text/csv')
}
