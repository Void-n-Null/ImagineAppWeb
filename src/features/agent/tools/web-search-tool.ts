import { webSearch } from '#/server/functions/web-search'
import type { WebSearchResult } from '#/server/websearch/exa'
import type { AgentTool } from '../tool'

/**
 * web_search — the v2 capability leap (IMA-8). Closes the gaps the BB
 * catalog can't: spec details the catalog omits ("4K@120 over HDMI 2.1?",
 * "USB-C PD wattage?"), review sentiment, release timing/context.
 *
 * The catalog stays authoritative for Best Buy price and stock — the
 * description and the system prompt (IMA-7) both enforce the split, and
 * the result footer re-asks for source attribution because employees need
 * to judge trust ("according to RTINGS…" vs a bare claim).
 */

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

export const webSearchTool: AgentTool = {
  name: 'web_search',
  description: `Search the public web. Returns ranked results with title, source, date, and a page-text excerpt.

Use for what the Best Buy catalog CANNOT answer:
- Spec details missing or ambiguous in catalog data (port capabilities, PD wattage, panel type, codec support)
- Review sentiment and third-party testing (RTINGS-style)
- Release timing, product generations, successor/predecessor context
- Manufacturer documentation and compatibility matrices

Do NOT use for Best Buy prices or stock — catalog tools are authoritative there. Web prices are other retailers' and must never be presented as Best Buy's.

Attribute every claim you take from these results to its source by name so the user can judge trust.`,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'What to search for. Be specific — include product model numbers when you have them (e.g. "LG C4 OLED 4K 120Hz HDMI 2.1 bandwidth").',
      },
      num_results: {
        type: 'integer',
        description: 'How many results, 1-8. Default 5.',
      },
    },
    required: ['query'],
  },
  statusLabel(args) {
    const query = str(args.query)
    return query
      ? `Searching the web “${query.slice(0, 40)}”`
      : 'Searching the web'
  },
  async execute(args) {
    const query = str(args.query)
    if (!query) return 'Error: query is required.'

    const numResults =
      typeof args.num_results === 'number' &&
      Number.isSafeInteger(args.num_results)
        ? args.num_results
        : undefined

    const result = await webSearch({ data: { query, numResults } })
    if (result.status === 'error') {
      return `Web search failed: ${result.message}`
    }
    if (result.results.length === 0) {
      return `No web results for "${query}". Try different or more specific terms.`
    }

    const lines: string[] = [
      `Web results for "${query}" (${result.results.length}):`,
      '',
    ]
    result.results.forEach((item, i) => {
      lines.push(...formatResult(i + 1, item), '')
    })
    lines.push(
      'Attribute anything you use to its source by name (e.g. "according to rtings.com…"). These are third-party pages — not Best Buy data.',
    )
    return lines.join('\n')
  },
}

function formatResult(index: number, item: WebSearchResult): string[] {
  const meta: string[] = [sourceDomain(item.url)]
  if (item.publishedDate) meta.push(item.publishedDate.slice(0, 10))
  const lines = [
    `${index}. ${item.title} — ${meta.join(', ')}`,
    `   ${item.url}`,
  ]
  if (item.text.length > 0) {
    lines.push(`   ${item.text.replace(/\s+/g, ' ').trim()}`)
  }
  return lines
}

function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
