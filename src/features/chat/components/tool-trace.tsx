import { AlertTriangle, Check, Loader2, Wrench } from 'lucide-react'
import type { ToolCallRequest, ToolResultMessage } from '#/features/agent'
import { cn } from '#/lib/utils'

/**
 * Debug view of one tool call (shown only when "Show tool activity" is on):
 * name + status at a glance, args and full result behind a disclosure.
 * Default UX never renders these — see ActivityPill.
 */
export function ToolTraceCard({
  call,
  result,
}: {
  call: ToolCallRequest
  result: ToolResultMessage | undefined
}) {
  const pending = result === undefined
  const failed = result?.isError === true

  return (
    <details className="group rounded-xl border border-line bg-surface">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-3.5 [&::-webkit-details-marker]:hidden">
        <Wrench
          size={14}
          aria-hidden="true"
          className="shrink-0 text-text-faint"
        />
        <code className="min-w-0 flex-1 truncate font-mono text-caption font-semibold text-text-muted">
          {call.name}
        </code>
        {pending ? (
          <Loader2
            size={14}
            aria-label="Running"
            className="shrink-0 animate-spin text-action"
          />
        ) : failed ? (
          <AlertTriangle
            size={14}
            aria-label="Failed"
            className="shrink-0 text-danger"
          />
        ) : (
          <Check size={14} aria-label="Done" className="shrink-0 text-ok" />
        )}
      </summary>
      <div className="flex flex-col gap-2 border-t border-line px-3.5 py-3">
        <TraceSection label="Arguments">
          {formatArgs(call.argumentsJson)}
        </TraceSection>
        {result && (
          <TraceSection label={failed ? 'Error' : 'Result'} danger={failed}>
            {result.content}
          </TraceSection>
        )}
      </div>
    </details>
  )
}

function TraceSection({
  label,
  danger = false,
  children,
}: {
  label: string
  danger?: boolean
  children: string
}) {
  return (
    <div>
      <p className="aisle-label">{label}</p>
      <pre
        className={cn(
          'scrollbar-none mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-raised p-2.5 font-mono text-caption leading-relaxed',
          danger ? 'text-danger' : 'text-text-muted',
        )}
      >
        {children}
      </pre>
    </div>
  )
}

function formatArgs(argumentsJson: string): string {
  try {
    return JSON.stringify(JSON.parse(argumentsJson), null, 2)
  } catch {
    return argumentsJson
  }
}
