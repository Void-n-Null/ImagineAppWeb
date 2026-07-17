import type { AgentTool } from '../tool'

/**
 * get_current_time — the model's clock (IMA-6). Sale windows, "newest"
 * questions, and store-hours reasoning all need today's date; models guess
 * otherwise.
 *
 * The clock comes from host.clock() (IMA-17), not `new Date()`: on the
 * server loop the datacenter's wall clock is UTC and useless for "what time
 * is it here?", so the client sends its device time + IANA timezone in the
 * turn request and the server host carries those values through. We format
 * in that timezone so the model reads the user's local time either way.
 */
export const getTimeTool: AgentTool = {
  name: 'get_current_time',
  description:
    "Get the current local date and time on the user's device. Use for anything date-sensitive: sales, release recency, store hours.",
  parameters: { type: 'object', properties: {}, required: [] },
  statusLabel() {
    return 'Checking the time'
  },
  execute(_args, host) {
    const { iso, timeZone } = host.clock()
    const now = new Date(iso)
    // A malformed ISO string (untrusted on the server) yields an Invalid
    // Date; fall back to the raw values rather than emitting "Invalid Date".
    if (Number.isNaN(now.getTime())) {
      return Promise.resolve(
        `Current local time (ISO: ${iso}, timezone: ${timeZone}).`,
      )
    }
    let formatted: string
    try {
      formatted = new Intl.DateTimeFormat('en-US', {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone,
      }).format(now)
    } catch {
      // Unknown/invalid IANA zone — format without it (UTC offset omitted).
      formatted = new Intl.DateTimeFormat('en-US', {
        dateStyle: 'full',
        timeStyle: 'short',
      }).format(now)
    }
    return Promise.resolve(
      `Current local time: ${formatted} (${timeZone}) (ISO: ${now.toISOString()})`,
    )
  },
}
