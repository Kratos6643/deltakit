import type { CompareInput, CompareResult, DiffRow, Span, StructuralChange } from '../types.ts'
import { DELIMITERS } from './csv.ts'
import { MODE_META } from './modes.ts'
import { headlineFor, verdictFor } from './tally.ts'

const CONTEXT = 3
const ROW_LIMIT = 5000
const CHANGE_LIMIT = 3000

const KIND_LABELS: Record<StructuralChange['kind'], string> = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
  moved: 'Moved',
  type: 'Type changed',
  reordered: 'Key order',
}

const STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #f2f0e8; color: #101c1d; font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
main { max-width: 1200px; margin: 0 auto; padding: 32px 24px 48px; }
header { margin-bottom: 20px; padding-bottom: 16px; border-bottom: 3px solid #12534d; }
a { color: #12534d; }
h1 { margin: 0 0 4px; font-size: 22px; letter-spacing: -0.01em; }
h2 { margin: 0 0 12px; font-size: 15px; }
.files { margin: 0; font-size: 15px; font-weight: 600; }
.files .tag { display: inline-block; margin-right: 6px; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; }
.tag.before { background: #fdeded; color: #c62a2f; }
.tag.after { background: #e8f6ec; color: #1a7f37; }
.arrow { margin: 0 10px; color: #8a94a6; }
.meta { margin: 6px 0 0; color: #5c6779; font-size: 12.5px; }
section { margin-top: 16px; padding: 18px 20px; border: 1px solid #e1e4ea; border-radius: 12px; background: #fff; }
.verdict { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin: 0 0 10px; }
.verdict strong { font-size: 18px; }
.verdict span { color: #5c6779; }
.tally { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 0; padding: 0; list-style: none; color: #5c6779; font-size: 13px; }
.tally b { color: #1b2130; font-variant-numeric: tabular-nums; }
.tally .add b { color: #1a7f37; }
.tally .del b { color: #c62a2f; }
.tally .mod b { color: #8f5f00; }
.tally .move b { color: #0a66c9; }
.settings { margin: 0; padding-left: 18px; color: #5c6779; }
.note { margin: 10px 0 0; color: #5c6779; font-size: 12.5px; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 6px 10px; border-bottom: 1px solid #e1e4ea; text-align: left; vertical-align: top; }
thead th { background: #f8f9fb; color: #5c6779; font-size: 12px; }
.changes td.path, .changes td.value { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; overflow-wrap: anywhere; }
.changes td.before { color: #c62a2f; }
.changes td.after { color: #1a7f37; }
.pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; white-space: nowrap; }
.pill.added { background: #e8f6ec; color: #1a7f37; }
.pill.removed { background: #fdeded; color: #c62a2f; }
.pill.changed, .pill.type, .pill.reordered { background: #fff5d9; color: #8f5f00; }
.pill.moved { background: #e7f0fd; color: #0a66c9; }
.lines { table-layout: fixed; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.lines td { padding: 0 10px; border: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.lines col.no { width: 4.2em; }
.lines td.no { background: #f8f9fb; color: #8a94a6; text-align: right; user-select: none; }
.lines tr.remove td.l, .lines tr.modify td.l { background: #fdeded; }
.lines tr.add td.r, .lines tr.modify td.r { background: #e8f6ec; }
.lines tr.fuzzy td.l, .lines tr.fuzzy td.r { background: #fff5d9; }
.lines td.gap { background: repeating-linear-gradient(135deg, transparent 0 6px, rgba(27, 33, 48, 0.06) 6px 7px); }
.lines del { border-radius: 3px; background: #f5b7ba; color: inherit; text-decoration: none; }
.lines ins { border-radius: 3px; background: #aee3bd; color: inherit; text-decoration: none; }
.lines tr.fold td { padding: 4px 10px; border-top: 1px solid #e1e4ea; border-bottom: 1px solid #e1e4ea; background: #f8f9fb; color: #5c6779; font-family: ui-sans-serif, system-ui, sans-serif; text-align: center; }
.scroll { overflow-x: auto; }
footer { margin-top: 20px; color: #8a94a6; font-size: 12px; text-align: center; }
@media print {
  body { background: #fff; }
  main { padding: 0; }
  section { break-inside: auto; border-color: #c9cfd8; }
  .lines tr { break-inside: avoid; }
}
`

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

function lineHtml(text: string | undefined, spans: Span[] | undefined, tag: 'ins' | 'del'): string {
  if (text === undefined) return ''
  if (!spans) return escape(text)
  return spans.map((span) => (span.changed ? `<${tag}>${escape(span.text)}</${tag}>` : escape(span.text))).join('')
}

function settings(input: CompareInput): string[] {
  const { options, mode } = input
  const out: string[] = []
  if (options.ignoreWhitespace) out.push('Spaces at line ends were ignored')
  if (mode === 'text') {
    if (options.ignoreCase) out.push('Letter case was ignored')
    if (options.sortLines) out.push('Line order was ignored; both sides were sorted first')
    if (options.ignoreText.length > 0) out.push(`Text matching these patterns was ignored: ${options.ignoreText.join(' · ')}`)
    return out
  }
  out.push(options.ignoreFormatting ? 'Only the data was compared; formatting was skipped' : 'The text was compared exactly as written')
  if ((mode === 'json' || mode === 'yaml') && options.ignoreKeyOrder) out.push('Key order was ignored')
  if (options.ignoreListOrder) out.push(mode === 'csv' ? 'Row order was ignored' : 'List order was ignored')
  if (options.ignoreFields.length > 0) out.push(`Ignored ${mode === 'csv' ? 'columns' : 'fields'}: ${options.ignoreFields.join(', ')}`)
  if (options.matchKeys.length > 0) out.push(`Items were matched by ${options.matchKeys.join(', ')} where possible`)
  if (mode === 'csv') {
    const separator = DELIMITERS.find((item) => item.id === options.delimiter)
    out.push(separator ? `Cells were split on ${separator.name}` : 'The separator was detected for each file')
  }
  return out
}

function visibleRows(rows: DiffRow[]): boolean[] {
  const visible = rows.map((row) => row.kind !== 'equal')
  rows.forEach((row, index) => {
    if (row.kind === 'equal') return
    for (let near = Math.max(0, index - CONTEXT); near <= Math.min(rows.length - 1, index + CONTEXT); near += 1) visible[near] = true
  })
  return visible
}

function linesSection(result: CompareResult, sorted: boolean): string {
  if (result.hunks.length === 0) return ''
  const visible = visibleRows(result.rows)
  const body: string[] = []
  let shown = 0
  let index = 0
  while (index < result.rows.length && shown < ROW_LIMIT) {
    if (!visible[index]) {
      const start = index
      while (index < result.rows.length && !visible[index]) index += 1
      const count = index - start
      body.push(`<tr class="fold"><td colspan="4">⋯ ${count.toLocaleString()} unchanged ${count === 1 ? 'line' : 'lines'}</td></tr>`)
      continue
    }
    const row = result.rows[index]
    const kind = row.fuzzy ? 'equal fuzzy' : row.kind
    body.push(
      `<tr class="${kind}">`
        + `<td class="no">${sorted ? '' : row.leftNo ?? ''}</td>`
        + `<td class="l${row.left === undefined ? ' gap' : ''}">${lineHtml(row.left, row.leftSpans, 'del')}</td>`
        + `<td class="no">${sorted ? '' : row.rightNo ?? ''}</td>`
        + `<td class="r${row.right === undefined ? ' gap' : ''}">${lineHtml(row.right, row.rightSpans, 'ins')}</td>`
        + '</tr>',
    )
    shown += 1
    index += 1
  }
  const rest = result.rows.length - index
  const more = rest > 0 ? `<p class="note">The report stops after ${ROW_LIMIT.toLocaleString()} lines; ${rest.toLocaleString()} more are in DeltaKit.</p>` : ''
  return `<section><h2>Line by line</h2><div class="scroll"><table class="lines"><colgroup><col class="no"><col><col class="no"><col></colgroup><tbody>${body.join('')}</tbody></table></div>${more}</section>`
}

function changesSection(result: CompareResult): string {
  if (result.changes.length === 0) return ''
  const rows = result.changes.slice(0, CHANGE_LIMIT).map((change) => {
    const values = change.kind === 'moved' || change.kind === 'reordered'
      ? `<td class="value" colspan="2">${escape(change.note ?? '')}</td>`
      : `<td class="value before">${escape(change.left ?? '')}</td><td class="value after">${escape(change.right ?? '')}</td>`
    return `<tr><td><span class="pill ${change.kind}">${KIND_LABELS[change.kind]}</span></td><td class="path">${escape(change.path)}</td>${values}</tr>`
  })
  const rest = result.changes.length - rows.length
  const more = rest > 0 ? `<p class="note">${rest.toLocaleString()} more changes are in DeltaKit.</p>` : ''
  return `<section><h2>Changed fields</h2><div class="scroll"><table class="changes"><thead><tr><th>Change</th><th>Path</th><th>Before</th><th>After</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>${more}</section>`
}

function tallyHtml(label: string, parts: [string, number, string][]): string {
  const items = parts.map(([tone, count, word]) => `<li class="${tone}"><b>${count.toLocaleString()}</b> ${word}</li>`).join('')
  return `<ul class="tally"><li>${label}</li>${items}</ul>`
}

export function buildHtmlReport(input: CompareInput, result: CompareResult, created = new Date()): string {
  const verdict = verdictFor(result)
  const { stats } = result
  const modeLabel = MODE_META.find((item) => item.id === input.mode)?.label ?? input.mode
  const when = created.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const tallies = [tallyHtml('Lines', [['add', stats.addedLines, 'added'], ['del', stats.removedLines, 'removed'], ['mod', stats.modifiedLines, 'changed']])]
  if (stats.fieldMatch !== null) {
    tallies.push(tallyHtml('Fields', [['add', stats.addedFields, 'added'], ['del', stats.removedFields, 'removed'], ['mod', stats.changedFields, 'changed'], ['move', stats.moved, 'moved']]))
  }
  const problems = [result.leftError, result.rightError].filter((message): message is string => !!message)
  const notes = [...problems, ...result.info].map((message) => `<p class="note">${escape(message)}</p>`).join('')
  const title = `${input.leftName} → ${input.rightName}`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escape(`Comparison: ${title}`)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<header>
<h1>DeltaKit · Comparison report</h1>
<p class="files"><span class="tag before">Before</span>${escape(input.leftName)}<span class="arrow">→</span><span class="tag after">After</span>${escape(input.rightName)}</p>
<p class="meta">${escape(modeLabel)} · Created ${escape(when)} with DeltaKit by Avinash Rapolu</p>
</header>
<section>
<p class="verdict"><strong>${escape(headlineFor(verdict))}</strong><span>${verdict.percent}% of the content matches</span></p>
${tallies.join('\n')}
${notes}
</section>
<section>
<h2>Settings</h2>
<ul class="settings">${settings(input).map((item) => `<li>${escape(item)}</li>`).join('')}</ul>
</section>
${changesSection(result)}
${linesSection(result, input.options.sortLines)}
<footer>DeltaKit by <a href="https://avinashrapolu.com/" target="_blank" rel="noopener noreferrer">Avinash Rapolu</a> · Compared in your browser. Nothing was uploaded.</footer>
</main>
</body>
</html>
`
}
