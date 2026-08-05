/**
 * React binding for the agent loop (IMA-6, IMA-17 Phase 2).
 *
 * Phase 1 ran the loop in the browser on the user's own OpenRouter key.
 * Phase 2 (IMA-17 #356) moves the loop to POST /api/agent/turn on the app's
 * pool key: this hook is now a TRANSPORT — it POSTs the transcript, parses the
 * SSE event stream the endpoint returns, and applies each event to the same
 * transcript/draft/activity state the browser loop used to drive. The public
 * interface is unchanged, so the chat route needs no structural change.
 *
 * The event-application + client-action re-invoke loop lives in
 * agent-transport.ts (driveTurns) so it is unit-testable without a renderer;
 * this hook only binds that loop's side effects to React state through a
 * {@link TurnSink}.
 *
 * The transcript lives in a ref (source of truth) mirrored to state, so
 * send() never runs side effects inside a state updater (StrictMode
 * double-invokes those).
 *
 * Thread persistence (IMA-9): every append upserts the whole thread into
 * IndexedDB, and `resume` hydrates an existing transcript on mount. One
 * mount = one thread — the chat route keys the session component by thread
 * id, so this hook never has to handle identity changing under it.
 */

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type AgentHost,
  type ChatMessage,
  type ImageAttachment,
  type ProductAttachment,
  type ToolRegistry,
  type TurnEvent,
  userMessage,
} from '#/features/agent'
import {
  addCartItem,
  clearCart,
  getCartItems,
  removeCartItem,
} from '#/features/cart/cart-store'
import { getSelectedModelId } from '#/features/models/selected-model'
import {
  buildTurnRequestBody,
  type ChatNotice,
  driveTurns,
  type TurnSink,
} from './agent-transport'
import {
  inspectOutboundMessage,
  inspectUntrustedTurnRequest,
  SENSITIVE_CONTEXT_BLOCK_MESSAGE,
  sensitiveContentBlockMessage,
} from './content-safety'
import { loadTranscript, saveThread } from './threads/thread-store'
import { syncThreadUp } from './threads/thread-sync'
import { THREADS_QUERY_KEY } from './threads/use-threads'

export type { ChatNotice } from './agent-transport'

export interface UseAgentChat {
  transcript: ChatMessage[]
  /** In-flight assistant text (streaming), rendered after the transcript. */
  draft: { id: string; text: string } | null
  /** Current activity label while the agent works ("Searching …"). */
  activity: string | null
  running: boolean
  /** True while a resumed thread is still loading from IndexedDB. */
  hydrating: boolean
  notice: ChatNotice | null
  send: (
    text: string,
    attachments?: {
      products?: ProductAttachment[]
      images?: ImageAttachment[]
    },
  ) => boolean
  dismissNotice: () => void
  stop: () => void
}

export interface ChatTurnCompleted {
  turnCount: number
  toolsUsed: string[]
  model: string
}

export interface UseAgentChatOptions {
  host: AgentHost
  /**
   * Built per send. The SERVER builds its own tool registry from
   * `toolsEnabled` (IMA-17); this hook only uses buildRegistry() to decide
   * that flag — whether the selected model gets tools at all. It never sends
   * the schemas over the wire.
   */
  buildRegistry: () => ToolRegistry
  /** Persistence identity. The mount is keyed by this — it never changes. */
  threadId: string
  /** Load this thread's transcript from IndexedDB on mount. */
  resume: boolean
  /** Called after a turn reaches a successful assistant completion. */
  onTurnComplete?: (turn: ChatTurnCompleted) => void
}

export function useAgentChat(options: UseAgentChatOptions): UseAgentChat {
  const [transcript, setTranscript] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null)
  const [activity, setActivity] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [hydrating, setHydrating] = useState(options.resume)
  const [notice, setNotice] = useState<ChatNotice | null>(null)

  const transcriptRef = useRef<ChatMessage[]>([])
  const hydratingRef = useRef(options.resume)
  const abortRef = useRef<AbortController | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const queryClient = useQueryClient()

  // Hydrate a resumed thread once per mount. The length guard means a
  // hydration that loses a race with an eager send can never clobber live
  // messages (send is also blocked while hydrating, belt and suspenders).
  useEffect(() => {
    if (!optionsRef.current.resume) return
    let cancelled = false
    void loadTranscript(optionsRef.current.threadId)
      .catch(() => null)
      .then((messages) => {
        if (cancelled) return
        if (messages && transcriptRef.current.length === 0) {
          transcriptRef.current = messages
          setTranscript(messages)
        }
        hydratingRef.current = false
        setHydrating(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Leaving the conversation kills the run: a thread switch remounts this
  // hook, and an orphaned fetch would keep the server loop streaming (and
  // spending) into dead state. Aborting the fetch signals the endpoint to
  // stop the loop (its request.signal is wired into runAgent).
  useEffect(
    () => () => {
      abortRef.current?.abort()
    },
    [],
  )

  const persistTranscript = useCallback(
    (snapshot: ChatMessage[]) => {
      const id = optionsRef.current.threadId
      void saveThread(id, snapshot)
        .then(() =>
          queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY }),
        )
        .catch(() => {})
      // Mirror UP to the account at the same cadence (IMA-31). Fire-and-forget
      // and coalesced per-thread so rapid saves collapse to one round-trip;
      // the local write above already holds the truth if this fails.
      syncThreadUp(id, snapshot)
    },
    [queryClient],
  )

  const replaceTranscript = useCallback(
    (messages: ChatMessage[]) => {
      transcriptRef.current = messages
      setTranscript(messages)
      persistTranscript(messages)
    },
    [persistTranscript],
  )

  const append = useCallback(
    (message: ChatMessage) => {
      const messages = [...transcriptRef.current, message]
      replaceTranscript(messages)
    },
    [replaceTranscript],
  )

  // Apply a {type:'cart'} event the server emitted after mutating its per-turn
  // snapshot. The client store is the device's source of truth; these mirror
  // the same mutation so both agree. add is idempotent-by-sku on both sides.
  const applyCart = useCallback(
    (event: Extract<TurnEvent, { type: 'cart' }>) => {
      switch (event.op) {
        case 'add':
          addCartItem(event.item)
          break
        case 'remove':
          removeCartItem(event.sku)
          break
        case 'clear':
          clearCart()
          break
      }
    },
    [],
  )

  const send = useCallback<UseAgentChat['send']>(
    (text, attachments) => {
      if (hydratingRef.current) return false // never overwrite an unloaded thread
      if (abortRef.current) return false // one run at a time

      const opts = optionsRef.current
      const toolsEnabled = opts.buildRegistry().schemas.length > 0
      const model = getSelectedModelId()
      const nextMessage = userMessage(text, attachments)
      const directFindings = inspectOutboundMessage(text, attachments)
      const initialBody = buildTurnRequestBody({
        messages: [...transcriptRef.current, nextMessage],
        model,
        toolsEnabled,
        cart: getCartItems(),
        clock: {
          iso: new Date().toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      })
      const requestFindings = inspectUntrustedTurnRequest(initialBody)
      if (requestFindings.length > 0) {
        setNotice({
          kind: 'sensitive',
          message:
            directFindings.length > 0
              ? sensitiveContentBlockMessage(directFindings)
              : SENSITIVE_CONTEXT_BLOCK_MESSAGE,
          authExpired: false,
        })
        return false
      }

      append(nextMessage)
      setNotice(null)
      setActivity('Thinking')
      setRunning(true)

      const controller = new AbortController()
      abortRef.current = controller

      // The server builds its own registry; we only need the flag telling it
      // whether this model gets tools (IMA-17).
      const toolsUsed = new Set<string>()
      let completed = false

      const sink: TurnSink = {
        getTranscript: () => transcriptRef.current,
        append,
        replaceTranscript,
        setActivity,
        setDraft,
        setNotice,
        applyCart,
        host: opts.host,
        model,
        toolsEnabled,
        getCart: getCartItems,
        onEvent: (event) => {
          if (event.type === 'assistant-message') {
            for (const call of event.message.toolCalls ?? []) {
              toolsUsed.add(call.name)
            }
          }
          if (event.type === 'done') completed = event.reason === 'complete'
        },
      }

      void driveTurns(sink, controller.signal, initialBody)
        .then(() => {
          if (!controller.signal.aborted && completed) {
            opts.onTurnComplete?.({
              turnCount: transcriptRef.current.filter(
                (message) => message.role === 'user',
              ).length,
              toolsUsed: [...toolsUsed],
              model: sink.model,
            })
          }
        })
        .finally(() => {
          abortRef.current = null
          setRunning(false)
          setActivity(null)
          setDraft(null)
        })
      return true
    },
    [append, applyCart, replaceTranscript],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const dismissNotice = useCallback(() => setNotice(null), [])

  return {
    transcript,
    draft,
    activity,
    running,
    hydrating,
    notice,
    send,
    dismissNotice,
    stop,
  }
}
