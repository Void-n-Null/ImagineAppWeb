import { Tag } from 'lucide-react'
import { Fragment } from 'react'
import type {
  AssistantMessage,
  ChatMessage,
  ToolResultMessage,
  UserMessage,
} from '#/features/agent'
import { Markdown } from './markdown'
import { ToolTraceCard } from './tool-trace'

/**
 * Transcript renderer (IMA-6). Default mode shows only the human-facing
 * conversation: user bubbles and final assistant prose — the agent's tool
 * traffic stays behind the activity pill. `showTools` (debug view) inlines
 * every call with args + results for parity with what actually ran.
 *
 * The streaming draft renders as an AssistantBlock keyed by the message id
 * it will BECOME, inside the same children array as the transcript (keys
 * only match within one array). The runner reuses that id for the final
 * assistant-message, and setDraft(null) + append batch into one commit —
 * so React reconciles draft → final in place. Rendering the draft in its
 * own slot below the list remounted the finished message wholesale
 * (images re-decoded, rise-in replayed = the end-of-stream flash).
 */
export function MessageList({
  transcript,
  draft,
  showTools,
}: {
  transcript: ChatMessage[]
  draft: { id: string; text: string } | null
  showTools: boolean
}) {
  const resultsByCallId = new Map<string, ToolResultMessage>()
  for (const msg of transcript) {
    if (msg.role === 'tool') resultsByCallId.set(msg.toolCallId, msg)
  }

  const items = transcript.map((msg) => {
    switch (msg.role) {
      case 'user':
        return <UserBubble key={msg.id} message={msg} />
      case 'assistant':
        return (
          <AssistantBlock
            key={msg.id}
            message={msg}
            resultsByCallId={resultsByCallId}
            showTools={showTools}
          />
        )
      default:
        return null // Tool results render via their assistant turn's trace cards.
    }
  })

  if (draft && draft.text.length > 0) {
    items.push(
      <AssistantBlock
        key={draft.id}
        message={{
          id: draft.id,
          role: 'assistant',
          content: draft.text,
          at: 0,
        }}
        resultsByCallId={resultsByCallId}
        showTools={showTools}
        streaming
      />,
    )
  }

  return <div className="flex flex-col gap-5">{items}</div>
}

function UserBubble({ message }: { message: UserMessage }) {
  const images = message.attachedImages ?? []
  const products = message.attachedProducts ?? []

  return (
    <div className="rise-in flex flex-col items-end gap-1.5">
      {images.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {images.map((image) => (
            <img
              key={image.dataUrl.slice(-24)}
              src={image.dataUrl}
              alt="Attachment"
              className="h-24 w-24 rounded-xl border border-line object-cover"
            />
          ))}
        </div>
      )}
      {products.map((product) => (
        <span
          key={product.sku}
          className="flex max-w-[85%] items-center gap-1.5 rounded-full bg-raised px-3 py-1.5 text-caption font-semibold text-text-muted"
        >
          <Tag size={12} aria-hidden="true" className="shrink-0 text-action" />
          <span className="truncate">{product.name}</span>
          <span className="tabular shrink-0 text-text-faint">
            {product.sku}
          </span>
        </span>
      ))}
      {message.content.length > 0 && (
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-action px-4 py-2.5 text-body leading-relaxed text-action-ink">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      )}
    </div>
  )
}

function AssistantBlock({
  message,
  resultsByCallId,
  showTools,
  streaming = false,
}: {
  message: AssistantMessage
  resultsByCallId: Map<string, ToolResultMessage>
  showTools: boolean
  streaming?: boolean
}) {
  const toolCalls = message.toolCalls ?? []
  const hasContent = message.content.trim().length > 0
  if (!hasContent && (!showTools || toolCalls.length === 0)) return null

  return (
    <div className="rise-in flex flex-col gap-2">
      {hasContent && (
        <Markdown
          text={message.content}
          streaming={streaming}
          className={streaming ? 'stream-cursor' : undefined}
        />
      )}
      {showTools &&
        toolCalls.map((call) => (
          <Fragment key={call.id}>
            <ToolTraceCard call={call} result={resultsByCallId.get(call.id)} />
          </Fragment>
        ))}
    </div>
  )
}
