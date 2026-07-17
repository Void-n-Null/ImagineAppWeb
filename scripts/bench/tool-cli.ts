/**
 * Invoke any agent tool exactly as the model would — same registry, same
 * formatted output the LLM sees. For grounding benchmark questions and
 * debugging tool behavior.
 *
 *     set -a; source .env.local; set +a
 *     bun --preload ./scripts/bench/preload.ts scripts/bench/tool-cli.ts \
 *       search_products '{"query":"65 inch tv","category":"TVs"}'
 *
 * Prints the exact tool-result string.
 */

import process from 'node:process'
import { buildDefaultToolRegistry } from '#/features/agent'
import { createBenchHost } from './bench-host'

const [name, argsJson] = process.argv.slice(2)
if (!name) {
  console.error('usage: tool-cli.ts <tool_name> [args-json]')
  console.error('tools: search_products, analyze_product, compare_products,')
  console.error('       web_search, check_store_availability, get_current_time')
  process.exit(1)
}

const registry = buildDefaultToolRegistry()
const tool = registry.get(name)
if (!tool) {
  console.error(`Unknown tool "${name}"`)
  process.exit(1)
}

const args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {}
const output = await tool.execute(args, createBenchHost())
console.log(output)
