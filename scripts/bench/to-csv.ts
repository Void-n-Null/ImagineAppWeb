/**
 * Convert bench result JSON(s) to CSV — one detail CSV (every model ×
 * question) and one summary CSV (per-model rollup).
 *
 *     bun scripts/bench/to-csv.ts <run.json> [override.json ...]
 *
 * Later files OVERRIDE earlier rows with the same (model, questionId) — used
 * to fold re-runs of fixed questions (e.g. compare-hard-fix.json) into the
 * main run. Writes <first-file-basename>.csv and <basename>.summary.csv next
 * to the first input.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import type { QuestionResult } from './run'

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: to-csv.ts <run.json> [override.json ...]')
  process.exit(1)
}

interface RunFile {
  startedAt: string
  results: QuestionResult[]
}

const merged = new Map<string, QuestionResult>()
for (const file of files) {
  const run = JSON.parse(readFileSync(file, 'utf8')) as RunFile
  for (const r of run.results) merged.set(`${r.model}\u0000${r.questionId}`, r)
}
const rows = [...merged.values()]

function csvField(value: unknown): string {
  const s = String(value ?? '')
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

function toCsv(header: string[], data: unknown[][]): string {
  return [header, ...data].map((row) => row.map(csvField).join(',')).join('\n')
}

/* ── Detail CSV ─────────────────────────────────────────────────────────── */

const detailHeader = [
  'model',
  'question_id',
  'concept',
  'difficulty',
  'outcome',
  'done_reason',
  'iterations',
  'tool_calls_total',
  'cost_usd',
  'duration_ms',
  'retried',
]
const detail = rows
  .sort(
    (a, b) =>
      a.model.localeCompare(b.model) ||
      a.questionId.localeCompare(b.questionId),
  )
  .map((r) => [
    r.model,
    r.questionId,
    r.concept,
    r.difficulty,
    r.outcome,
    r.doneReason ?? '',
    r.iterations,
    Object.values(r.toolCalls).reduce((s, n) => s + n, 0),
    r.costUsd.toFixed(6),
    r.durationMs,
    r.retried,
  ])

/* ── Summary CSV ────────────────────────────────────────────────────────── */

const CELLS = ['easy', 'medium', 'hard', 'search', 'compare', 'qa'] as const

const summaryHeader = [
  'model',
  'questions',
  'passed',
  'pass_rate',
  'errors',
  'total_cost_usd',
  'cost_per_question_usd',
  'median_duration_s',
  ...CELLS.map((c) => `pass_rate_${c}`),
]

const models = [...new Set(rows.map((r) => r.model))].sort()
const summary = models.map((model) => {
  const mine = rows.filter((r) => r.model === model)
  const passed = mine.filter((r) => r.outcome === 'pass').length
  const errors = mine.filter(
    (r) => r.outcome === 'error' || r.outcome === 'timeout',
  ).length
  const cost = mine.reduce((s, r) => s + r.costUsd, 0)
  const durations = mine.map((r) => r.durationMs).sort((a, b) => a - b)
  const median = durations[Math.floor(durations.length / 2)] ?? 0
  const rate = (subset: QuestionResult[]) =>
    subset.length === 0
      ? ''
      : (
          subset.filter((r) => r.outcome === 'pass').length / subset.length
        ).toFixed(3)
  return [
    model,
    mine.length,
    passed,
    rate(mine),
    errors,
    cost.toFixed(4),
    (cost / Math.max(mine.length, 1)).toFixed(5),
    (median / 1000).toFixed(1),
    ...CELLS.map((c) =>
      rate(mine.filter((r) => r.difficulty === c || r.concept === c)),
    ),
  ]
})

const base = files[0].replace(/\.json$/, '')
writeFileSync(`${base}.csv`, toCsv(detailHeader, detail))
writeFileSync(`${base}.summary.csv`, toCsv(summaryHeader, summary))
console.log(`Wrote ${base}.csv (${detail.length} rows)`)
console.log(`Wrote ${base}.summary.csv (${summary.length} models)`)
