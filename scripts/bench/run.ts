/**
 * The floor-assistant model benchmark (IMA model audit).
 *
 * Runs the REAL production agent stack per question — SYSTEM_PROMPT, the full
 * tool registry, runAgent's loop, the production OpenRouter client with its
 * ZDR/no-retention provider constraints — on the DEV key, then scores the
 * final answer with the objective checks in questions.ts. No judge model.
 *
 *     set -a; source .env.local; set +a     # BB/Exa/Redis vars for the tools
 *     bun --preload ./scripts/bench/preload.ts scripts/bench/run.ts \
 *       [--models a,b,c] [--add x,y] [--candidates] \
 *       [--concept search|compare|qa] [--difficulty easy|medium|hard] \
 *       [--ids id1,id2] [--concurrency 12] [--out path.json]
 *
 * Model selection: defaults to the full audit roster (picks + allowlist +
 * default); `--models` replaces it, `--add` appends ad-hoc ids, and
 * `--candidates` appends the curated challenger list (models.ts).
 *
 * The whole model × question matrix runs through ONE worker pool —
 * OpenRouter happily takes many concurrent requests, so there's no
 * per-model sequencing. Tasks are ordered question-major so every model
 * hits a given question around the same time and the Best Buy Redis cache
 * is warm after the first resolver. Results land in scripts/bench/results/
 * as JSON plus a printed per-model summary.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  type AgentEvent,
  buildDefaultToolRegistry,
  runAgent,
  SYSTEM_PROMPT,
  userMessage,
} from '#/features/agent'
import { createBenchHost } from './bench-host'
import {
  type BenchQuestion,
  evaluateCheck,
  validateQuestions,
} from './checks'
import { loadDevOpenRouterKey } from './env'
import { resolveModels } from './models'
import { QUESTIONS } from './questions'

const QUESTION_TIMEOUT_MS = 240_000

export interface QuestionResult {
  questionId: string
  concept: string
  difficulty: string
  model: string
  outcome: 'pass' | 'fail' | 'error' | 'timeout'
  doneReason: string | null
  iterations: number
  toolCalls: Record<string, number>
  costUsd: number
  durationMs: number
  answer: string
  error: string | null
  retried: boolean
}

interface RunOutput {
  startedAt: string
  models: string[]
  questionCount: number
  results: QuestionResult[]
}

/* ── CLI args ───────────────────────────────────────────────────────────── */

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index !== -1 ? process.argv[index + 1] : undefined
}

const conceptArg = argValue('--concept')
const difficultyArg = argValue('--difficulty')
const idsArg = argValue('--ids')
const concurrency = Number(argValue('--concurrency') ?? 12)
const outArg = argValue('--out')

const models = resolveModels(process.argv)
let questions: BenchQuestion[] = QUESTIONS
if (conceptArg) questions = questions.filter((q) => q.concept === conceptArg)
if (difficultyArg)
  questions = questions.filter((q) => q.difficulty === difficultyArg)
if (idsArg) {
  const wanted = new Set(idsArg.split(','))
  questions = questions.filter((q) => wanted.has(q.id))
}
validateQuestions(QUESTIONS)
if (questions.length === 0) throw new Error('no questions match the filters')

/* ── One question, one model ────────────────────────────────────────────── */

async function runQuestion(
  apiKey: string,
  model: string,
  question: BenchQuestion,
): Promise<Omit<QuestionResult, 'retried'>> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), QUESTION_TIMEOUT_MS)
  const started = Date.now()

  let doneReason: string | null = null
  let errorMessage: string | null = null
  let iterations = 0
  let costUsd = 0
  const toolCalls: Record<string, number> = {}
  const assistantParts: string[] = []

  const onEvent = (event: AgentEvent) => {
    switch (event.type) {
      case 'assistant-message':
        iterations += 1
        if (event.message.content.trim().length > 0)
          assistantParts.push(event.message.content)
        break
      case 'tool-start':
        toolCalls[event.call.name] = (toolCalls[event.call.name] ?? 0) + 1
        break
      case 'error':
        errorMessage = event.message
        break
      case 'done':
        doneReason = event.reason
        break
      default:
        break
    }
  }

  try {
    await runAgent({
      apiKey,
      model,
      systemPrompt: SYSTEM_PROMPT,
      transcript: [userMessage(question.prompt)],
      registry: buildDefaultToolRegistry(),
      host: createBenchHost(),
      signal: abort.signal,
      // Production parity: the server loop hands request_scan to the client.
      // In the bench nobody answers it, so a scan request ends the turn (and
      // fails the check) — correct, since no question needs a barcode.
      clientActionTools: new Set(['request_scan']),
      onEvent,
      onUsage: (usage) => {
        if (typeof usage.cost === 'number') costUsd += usage.cost
      },
    })
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err)
  } finally {
    clearTimeout(timer)
  }

  const answer = assistantParts.join('\n')
  const durationMs = Date.now() - started

  let outcome: QuestionResult['outcome']
  if (abort.signal.aborted && doneReason !== 'complete') outcome = 'timeout'
  else if (errorMessage !== null || doneReason === 'error') outcome = 'error'
  else outcome = evaluateCheck(question.check, answer) ? 'pass' : 'fail'

  return {
    questionId: question.id,
    concept: question.concept,
    difficulty: question.difficulty,
    model,
    outcome,
    doneReason,
    iterations,
    toolCalls,
    costUsd,
    durationMs,
    answer,
    error: errorMessage,
  }
}

/** Run with one retry on transient error (429/5xx/network — not on fail). */
async function runQuestionWithRetry(
  apiKey: string,
  model: string,
  question: BenchQuestion,
): Promise<QuestionResult> {
  const first = await runQuestion(apiKey, model, question)
  if (first.outcome !== 'error') return { ...first, retried: false }
  await new Promise((r) => setTimeout(r, 5_000))
  const second = await runQuestion(apiKey, model, question)
  return { ...second, retried: true, costUsd: first.costUsd + second.costUsd }
}

/* ── Pool ───────────────────────────────────────────────────────────────── */

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++
        results[index] = await fn(items[index])
      }
    },
  )
  await Promise.all(workers)
  return results
}

/* ── Reporting ──────────────────────────────────────────────────────────── */

function pct(passed: number, total: number): string {
  return total === 0 ? '—' : `${Math.round((passed / total) * 100)}%`
}

function summarize(results: QuestionResult[], model: string): void {
  const mine = results.filter((r) => r.model === model)
  const passed = mine.filter((r) => r.outcome === 'pass').length
  const errors = mine.filter(
    (r) => r.outcome === 'error' || r.outcome === 'timeout',
  ).length
  const cost = mine.reduce((sum, r) => sum + r.costUsd, 0)
  const durations = mine.map((r) => r.durationMs).sort((a, b) => a - b)
  const median = durations[Math.floor(durations.length / 2)] ?? 0

  console.log(`\n${model}`)
  console.log(
    `  overall ${passed}/${mine.length} (${pct(passed, mine.length)})  errors ${errors}  cost $${cost.toFixed(4)}  median ${(median / 1000).toFixed(1)}s`,
  )
  for (const dim of ['concept', 'difficulty'] as const) {
    const buckets = new Map<string, { pass: number; total: number }>()
    for (const r of mine) {
      const key = r[dim]
      const b = buckets.get(key) ?? { pass: 0, total: 0 }
      b.total += 1
      if (r.outcome === 'pass') b.pass += 1
      buckets.set(key, b)
    }
    const parts = [...buckets.entries()]
      .sort()
      .map(([k, b]) => `${k} ${b.pass}/${b.total}`)
    console.log(`  by ${dim}: ${parts.join('  ')}`)
  }
  const failures = mine.filter((r) => r.outcome !== 'pass')
  if (failures.length > 0) {
    console.log(
      `  non-pass: ${failures.map((r) => `${r.questionId}(${r.outcome})`).join(' ')}`,
    )
  }
}

/* ── Main ───────────────────────────────────────────────────────────────── */

async function main() {
  const apiKey = loadDevOpenRouterKey()
  console.log(
    `Benchmark: ${models.length} model(s) × ${questions.length} question(s), concurrency ${concurrency}`,
  )

  const output: RunOutput = {
    startedAt: new Date().toISOString(),
    models,
    questionCount: questions.length,
    results: [],
  }

  const resultsDir = fileURLToPath(new URL('./results', import.meta.url))
  mkdirSync(resultsDir, { recursive: true })
  const outPath =
    outArg ??
    `${resultsDir}/run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  const flush = () => writeFileSync(outPath, JSON.stringify(output, null, 2))

  // One flat pool over the whole matrix — no per-model sequencing.
  // Question-major order: every model hits a question around the same time,
  // so the BB Redis cache is warm for all but the first resolver.
  const tasks = questions.flatMap((question) =>
    models.map((model) => ({ question, model })),
  )
  let done = 0
  await mapPool(tasks, concurrency, async ({ question, model }) => {
    const result = await runQuestionWithRetry(apiKey, model, question)
    output.results.push(result)
    done += 1
    const mark =
      result.outcome === 'pass'
        ? 'PASS'
        : result.outcome === 'fail'
          ? 'FAIL'
          : result.outcome.toUpperCase()
    console.log(
      `  [${done}/${tasks.length}] ${model} ${result.questionId} ${mark} (${(result.durationMs / 1000).toFixed(1)}s, $${result.costUsd.toFixed(4)}${result.retried ? ', retried' : ''})`,
    )
    flush()
  })
  for (const model of models) summarize(output.results, model)
  flush()

  console.log(`\nTotal cost: $${output.results.reduce((s, r) => s + r.costUsd, 0).toFixed(4)}`)
  console.log(`Results written to ${outPath}`)
}

await main()
