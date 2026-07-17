/**
 * Structural validation for the bench question set.
 *
 *   bun scripts/bench/validate-questions.ts                 # full aggregate
 *   bun scripts/bench/validate-questions.ts <module-path>   # one cell file
 *
 * A cell file must export a BenchQuestion[] as its only array export.
 */
import process from 'node:process'
import { type BenchQuestion, validateQuestions } from './checks'

let QUESTIONS: BenchQuestion[]
const target = process.argv[2]
if (target) {
  const mod = (await import(
    target.startsWith('/') ? target : `${process.cwd()}/${target}`
  )) as Record<string, unknown>
  const arrays = Object.values(mod).filter(Array.isArray)
  if (arrays.length !== 1)
    throw new Error(`${target}: expected exactly one exported array`)
  QUESTIONS = arrays[0] as BenchQuestion[]
} else {
  QUESTIONS = (await import('./questions')).QUESTIONS
}

validateQuestions(QUESTIONS)

const cells = new Map<string, number>()
for (const q of QUESTIONS) {
  const key = `${q.concept} × ${q.difficulty}`
  cells.set(key, (cells.get(key) ?? 0) + 1)
}
console.log(`${QUESTIONS.length} questions OK`)
for (const [cell, count] of [...cells.entries()].sort()) {
  console.log(`  ${cell}: ${count}`)
}
