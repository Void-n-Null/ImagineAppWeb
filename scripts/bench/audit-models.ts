/**
 * Model audit (cheap pass): is each roster model USABLE at all under the
 * app's production request shape?
 *
 * Production constraints that break models "literally" (see openrouter.ts):
 *   - provider: { data_collection: 'deny', zdr: true }  → 404 "No endpoints
 *     found matching your data policy" when no compliant provider exists.
 *   - tools must be supported and actually invoked when obviously needed.
 *   - reasoning: { enabled: true } is sent on every turn.
 *
 * This probe uses the REAL streaming client (streamCompletion), so whatever
 * fails here fails in the app. One tiny tool-required prompt per model:
 * classify ok / no-tool-call / data-policy-404 / error, record latency+cost.
 *
 *     bun --preload ./scripts/bench/preload.ts scripts/bench/audit-models.ts \
 *       [--models a,b,c] [--add x,y] [--candidates]
 *
 * Defaults to the app roster; `--add` appends ad-hoc ids, `--candidates`
 * appends the curated challenger list (models.ts). All probes run in
 * parallel — OpenRouter takes concurrent requests fine.
 */

import process from 'node:process'
import { streamCompletion, toToolSchema } from '#/features/agent'
import { getTimeTool } from '#/features/agent/tools'
import { loadDevOpenRouterKey } from './env'
import { resolveModels } from './models'

interface CatalogEntry {
  id: string
  supported_parameters?: string[]
  pricing?: { prompt?: string; completion?: string }
  architecture?: { input_modalities?: string[] }
}

interface AuditRow {
  model: string
  inCatalog: boolean
  toolsSupported: boolean | null
  vision: boolean | null
  promptPerM: number | null
  completionPerM: number | null
  probe: 'ok' | 'no-tool-call' | 'data-policy-404' | 'error' | 'timeout'
  detail: string
  latencyMs: number | null
  costUsd: number | null
}

const PROBE_SYSTEM =
  'You are a test harness. When the user asks for the time, you MUST call the get_current_time tool.'
const PROBE_USER = 'What time is it right now? Use your tool.'
const PROBE_TIMEOUT_MS = 60_000

async function probe(apiKey: string, model: string): Promise<Partial<AuditRow>> {
  const started = Date.now()
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), PROBE_TIMEOUT_MS)
  try {
    const completion = await streamCompletion({
      apiKey,
      model,
      messages: [
        { role: 'system', content: PROBE_SYSTEM },
        { role: 'user', content: PROBE_USER },
      ],
      tools: [toToolSchema(getTimeTool)],
      signal: abort.signal,
    })
    const latencyMs = Date.now() - started
    const costUsd =
      typeof completion.usage?.cost === 'number' ? completion.usage.cost : null
    if (completion.toolCalls.some((tc) => tc.name === 'get_current_time')) {
      return { probe: 'ok', detail: '', latencyMs, costUsd }
    }
    return {
      probe: 'no-tool-call',
      detail: `finish=${completion.finishReason} content="${completion.content.slice(0, 80)}"`,
      latencyMs,
      costUsd,
    }
  } catch (err) {
    if (abort.signal.aborted) {
      return { probe: 'timeout', detail: `no completion in ${PROBE_TIMEOUT_MS}ms` }
    }
    const message = err instanceof Error ? err.message : String(err)
    const isPolicy404 =
      message.toLowerCase().includes('data policy') ||
      message.toLowerCase().includes('no endpoints found')
    return {
      probe: isPolicy404 ? 'data-policy-404' : 'error',
      detail: message.slice(0, 160),
      latencyMs: Date.now() - started,
    }
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  const apiKey = loadDevOpenRouterKey()
  const models = resolveModels(process.argv)

  console.log('Fetching OpenRouter catalog…')
  const catalogRes = await fetch('https://openrouter.ai/api/v1/models')
  const catalog = (await catalogRes.json()) as { data: CatalogEntry[] }
  const byId = new Map(catalog.data.map((m) => [m.id, m]))

  console.log(`Probing ${models.length} models in parallel…`)
  const rows: AuditRow[] = await Promise.all(
    models.map(async (model): Promise<AuditRow> => {
      const entry = byId.get(model)
      const base: AuditRow = {
        model,
        inCatalog: Boolean(entry),
        toolsSupported: entry
          ? (entry.supported_parameters ?? []).includes('tools')
          : null,
        vision: entry
          ? (entry.architecture?.input_modalities ?? []).includes('image')
          : null,
        promptPerM: entry?.pricing?.prompt
          ? Number(entry.pricing.prompt) * 1e6
          : null,
        completionPerM: entry?.pricing?.completion
          ? Number(entry.pricing.completion) * 1e6
          : null,
        probe: 'error',
        detail: '',
        latencyMs: null,
        costUsd: null,
      }
      const result = entry
        ? await probe(apiKey, model)
        : { probe: 'error' as const, detail: 'not in OpenRouter catalog' }
      const row = { ...base, ...result }
      console.log(`  ${model} → ${row.probe}`)
      return row
    }),
  )

  console.log('\n=== Audit results ===')
  console.table(
    rows.map((r) => ({
      model: r.model,
      probe: r.probe,
      tools: r.toolsSupported,
      vision: r.vision,
      '$in/M': r.promptPerM?.toFixed(2) ?? '?',
      '$out/M': r.completionPerM?.toFixed(2) ?? '?',
      'latency(ms)': r.latencyMs ?? '',
      detail: r.detail.slice(0, 60),
    })),
  )
  console.log(JSON.stringify(rows, null, 2))
}

await main()
