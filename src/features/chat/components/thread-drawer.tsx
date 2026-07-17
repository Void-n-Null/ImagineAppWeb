import { History, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '#/lib/utils'
import type { ThreadMeta } from '../threads/thread-store'
import { useThreadList } from '../threads/use-threads'

/**
 * The chat history surface (IMA-9): a right-side slide-over listing every
 * saved thread, newest activity first. Rows are meta-only (title, preview,
 * relative time) — transcripts stay in IndexedDB until a thread is opened.
 *
 * Delete is two-tap: the trash arms into a red confirm, anything else
 * disarms. No modal, no window.confirm — one-handed floor use.
 */
export function ThreadDrawer({
  open,
  activeThreadId,
  onClose,
  onSelect,
  onNewChat,
  onDelete,
}: {
  open: boolean
  activeThreadId: string
  onClose: () => void
  onSelect: (id: string) => void
  onNewChat: () => void
  onDelete: (id: string) => void
}) {
  const threads = useThreadList()
  const [armedId, setArmedId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setArmedId(null)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const items = threads.data ?? []

  return (
    <div
      className="fixed inset-0 z-40"
      role="dialog"
      aria-modal="true"
      aria-label="Chat history"
    >
      <button
        type="button"
        aria-label="Close chat history"
        onClick={onClose}
        className="animate-in fade-in absolute inset-0 cursor-default bg-black/50 duration-200"
        tabIndex={-1}
      />

      <div className="animate-in slide-in-from-right absolute top-0 right-0 flex h-full w-[85%] max-w-sm flex-col border-l border-line bg-surface duration-300">
        <header className="flex items-center justify-between gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
          <div>
            <p className="aisle-label">History</p>
            <h2 className="mt-0.5 text-heading font-extrabold tracking-tight">
              Chats
            </h2>
          </div>
          <button
            type="button"
            onClick={onNewChat}
            className="flex min-h-10 items-center gap-1.5 rounded-full bg-action-subtle px-3.5 text-caption font-bold text-action transition-transform duration-100 active:scale-[0.97]"
          >
            <Plus size={14} aria-hidden="true" />
            New chat
          </button>
        </header>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 pb-16 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-raised">
              <History
                size={20}
                aria-hidden="true"
                className="text-text-faint"
              />
            </div>
            <p className="text-body-sm leading-relaxed text-text-muted">
              {threads.isPending
                ? 'Loading…'
                : 'Conversations save here automatically as you chat.'}
            </p>
            {!threads.isPending && (
              // Honesty about the 72h retention window (BB API ToS) — see
              // src/lib/retention.ts.
              <p className="text-caption text-text-faint">
                Chats are kept for 3 days.
              </p>
            )}
          </div>
        ) : (
          <ul className="scrollbar-none m-0 flex-1 list-none overflow-y-auto overscroll-contain p-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {items.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                active={thread.id === activeThreadId}
                armed={armedId === thread.id}
                onOpen={() => onSelect(thread.id)}
                onArm={() => setArmedId(thread.id)}
                onDelete={() => {
                  setArmedId(null)
                  onDelete(thread.id)
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function ThreadRow({
  thread,
  active,
  armed,
  onOpen,
  onArm,
  onDelete,
}: {
  thread: ThreadMeta
  active: boolean
  armed: boolean
  onOpen: () => void
  onArm: () => void
  onDelete: () => void
}) {
  return (
    <li
      className={cn(
        'flex items-center gap-1 border-b border-line',
        active && 'bg-action-subtle',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? 'true' : undefined}
        className="flex min-h-16 min-w-0 flex-1 flex-col justify-center gap-0.5 px-4 py-2.5 text-left active:bg-raised"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span
            className={cn(
              'truncate text-body font-semibold',
              active && 'text-action',
            )}
          >
            {thread.title}
          </span>
          <span className="tabular shrink-0 text-micro text-text-faint">
            {formatRelativeTime(thread.updatedAt)}
          </span>
        </span>
        {thread.preview && (
          <span className="truncate text-caption text-text-faint">
            {thread.preview}
          </span>
        )}
      </button>

      <button
        type="button"
        onClick={armed ? onDelete : onArm}
        aria-label={
          armed
            ? `Confirm delete “${thread.title}”`
            : `Delete “${thread.title}”`
        }
        className={cn(
          'mr-2 grid h-10 shrink-0 place-items-center rounded-full transition-colors duration-150',
          armed
            ? 'w-auto bg-danger-subtle px-3 text-caption font-bold text-danger'
            : 'w-10 text-text-faint active:bg-raised',
        )}
      >
        {armed ? 'Delete?' : <Trash2 size={16} aria-hidden="true" />}
      </button>
    </li>
  )
}

/** "now", "4m", "2h", "3d", then a short date — list-row scale. */
export function formatRelativeTime(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - at) / 1000))
  if (seconds < 60) return 'now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}
