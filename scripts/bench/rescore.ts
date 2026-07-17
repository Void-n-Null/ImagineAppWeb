/**
 * Re-score saved bench results with the CURRENT checker — answers are stored
 * verbatim in the results JSON, so scoring fixes (e.g. the typography
 * normalization) can be applied retroactively without re-spending.
 *
 *     bun scripts/bench/rescore.ts <results.json> [...more]
 *
 * Rewrites pass/fail outcomes in place (error/timeout rows untouched) and
 * prints every flip. Rerun to-csv.ts afterwards to refresh the CSVs.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { evaluateCheck } from './checks'
import { QUESTIONS } from './questions'
import type { QuestionResult } from './run'

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: rescore.ts <results.json> [...more]')
  process.exit(1)
}

const byId = new Map(QUESTIONS.map((q) => [q.id, q]))

for (const file of files) {
  const run = JSON.parse(readFileSync(file, 'utf8')) as {
    results: QuestionResult[]
  }
  let flips = 0
  for (const r of run.results) {
    if (r.outcome !== 'pass' && r.outcome !== 'fail') continue
    const question = byId.get(r.questionId)
    if (!question) {
      console.warn(`${file}: unknown question ${r.questionId} — skipped`)
      continue
    }
    const outcome = evaluateCheck(question.check, r.answer) ? 'pass' : 'fail'
    if (outcome !== r.outcome) {
      flips++
      console.log(`${file}: ${r.model} ${r.questionId} ${r.outcome} → ${outcome}`)
      r.outcome = outcome
    }
  }
  writeFileSync(file, JSON.stringify(run, null, 2))
  console.log(`${file}: ${flips} flip(s)\n`)
}
