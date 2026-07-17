/**
 * Thread persistence (IMA-9) — IndexedDB, replacing v1's dart:io JSON files
 * (the thing that blocked the web port).
 *
 * Two object stores so listing threads never pays for transcript payloads
 * (image attachments are base64 data URLs — potentially megabytes each):
 *   - threads:     ThreadMeta rows (id, title, timestamps, preview)
 *   - transcripts: { id, messages } — the full ChatMessage[] per thread
 *
 * Plain async functions, no React — the UI binds through react-query
 * (use-threads.ts). Connections are opened per call and closed when the
 * transaction settles: saves happen at message cadence (not keystroke
 * cadence), so the open cost is noise and we never hold a connection that
 * a version upgrade in another tab would have to fight.
 */

import type { ChatMessage, UserMessage } from '#/features/agent'
import { isThreadExpired } from '#/lib/retention'

const DB_NAME = 'imagine-chat'
const DB_VERSION = 1
const THREADS = 'threads'
const TRANSCRIPTS = 'transcripts'

export interface ThreadMeta {
  id: string
  /** Derived from the opening user message; never user-edited (yet). */
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  /** Short plain-text tail of the conversation for the list row. */
  preview: string
}

interface TranscriptRecord {
  id: string
  messages: ChatMessage[]
}

export function generateThreadId(): string {
  return `thread_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function isIdbAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

/* ── IDB plumbing ───────────────────────────────────────────────────────── */

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(THREADS)) {
        db.createObjectStore(THREADS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(TRANSCRIPTS)) {
        db.createObjectStore(TRANSCRIPTS, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB open failed'))
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () =>
      reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () =>
      reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

/* ── Meta derivation (pure; exported for tests) ─────────────────────────── */

const TITLE_MAX = 64
const PREVIEW_MAX = 96

/** Rich-card tokens read as noise in a list row; show words only. */
function stripRichTokens(text: string): string {
  return text
    .replace(/\[(?:Product|Compare|ShowSearch)\([^\]]*\)\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/** Title = the opening user message, with sensible fallbacks for
 *  photo-only and scan-only openers. */
export function deriveTitle(messages: ChatMessage[]): string {
  const first = messages.find((msg): msg is UserMessage => msg.role === 'user')
  if (!first) return 'New chat'
  const text = stripRichTokens(first.content)
  if (text.length > 0) return truncate(text, TITLE_MAX)
  const product = first.attachedProducts?.[0]
  if (product) return truncate(product.name, TITLE_MAX)
  if (first.attachedImages?.length) return 'Photo question'
  return 'New chat'
}

/** Preview = the newest prose the user or assistant said (tools skipped). */
export function derivePreview(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'tool') continue
    const text = stripRichTokens(msg.content)
    if (text.length > 0) return truncate(text, PREVIEW_MAX)
  }
  return ''
}

/* ── 72-hour retention (BB API ToS) ─────────────────────────────────────── */

/**
 * Evict every locally-cached thread past the 72h window (src/lib/retention.ts),
 * meta AND transcript. IndexedDB is a demoted OFFLINE cache (IMA-31), so it must
 * obey the same retention policy as Neon — an offline copy of a transcript
 * (which carries Best Buy Content) must not outlive the ToS window just because
 * the device never went back online. Called on every local read: the read then
 * only sees survivors, and the expired rows are physically gone, so a device
 * that never syncs still purges itself. Best-effort under a single readwrite tx.
 */
async function evictExpiredLocalThreads(
  db: IDBDatabase,
  now: number,
): Promise<void> {
  const tx = db.transaction([THREADS, TRANSCRIPTS], 'readwrite')
  const threads = tx.objectStore(THREADS)
  const rows = await requestResult(threads.getAll() as IDBRequest<ThreadMeta[]>)
  for (const row of rows) {
    if (isThreadExpired(row.updatedAt, now)) {
      threads.delete(row.id)
      tx.objectStore(TRANSCRIPTS).delete(row.id)
    }
  }
  await transactionDone(tx)
}

/* ── CRUD ───────────────────────────────────────────────────────────────── */

/**
 * Newest-activity-first thread list. Reads meta only — never transcripts.
 * Evicts anything past the 72h window first (BB API ToS), so an expired thread
 * is both gone from disk and absent from the returned list.
 */
export async function listThreads(): Promise<ThreadMeta[]> {
  if (!isIdbAvailable()) return []
  const db = await openDb()
  try {
    await evictExpiredLocalThreads(db, Date.now())
    const tx = db.transaction(THREADS, 'readonly')
    const rows = await requestResult(
      tx.objectStore(THREADS).getAll() as IDBRequest<ThreadMeta[]>,
    )
    return rows.sort((a, b) => b.updatedAt - a.updatedAt)
  } finally {
    db.close()
  }
}

export async function loadTranscript(
  id: string,
): Promise<ChatMessage[] | null> {
  if (!isIdbAvailable()) return null
  const db = await openDb()
  try {
    const tx = db.transaction([THREADS, TRANSCRIPTS], 'readonly')
    const meta = await requestResult(
      tx.objectStore(THREADS).get(id) as IDBRequest<ThreadMeta | undefined>,
    )
    // Belt-and-suspenders with evictExpiredLocalThreads: never hand back an
    // expired transcript even if eviction hasn't run for this id yet. The
    // physical delete is deferred to the next listThreads() eviction pass so
    // this stays a cheap readonly read.
    if (meta && isThreadExpired(meta.updatedAt)) return null
    const record = await requestResult(
      tx.objectStore(TRANSCRIPTS).get(id) as IDBRequest<
        TranscriptRecord | undefined
      >,
    )
    return record?.messages ?? null
  } finally {
    db.close()
  }
}

/**
 * Upsert the whole thread (meta + transcript) in one transaction. Empty
 * transcripts are ignored so merely visiting /chat never mints DB rows.
 */
export async function saveThread(
  id: string,
  messages: ChatMessage[],
): Promise<void> {
  if (!isIdbAvailable() || messages.length === 0) return
  const db = await openDb()
  try {
    const tx = db.transaction([THREADS, TRANSCRIPTS], 'readwrite')
    const threads = tx.objectStore(THREADS)
    const existing = await requestResult(
      threads.get(id) as IDBRequest<ThreadMeta | undefined>,
    )
    const meta: ThreadMeta = {
      id,
      title: deriveTitle(messages),
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      messageCount: messages.length,
      preview: derivePreview(messages),
    }
    threads.put(meta)
    tx.objectStore(TRANSCRIPTS).put({ id, messages } satisfies TranscriptRecord)
    await transactionDone(tx)
  } finally {
    db.close()
  }
}

export async function deleteThread(id: string): Promise<void> {
  if (!isIdbAvailable()) return
  const db = await openDb()
  try {
    const tx = db.transaction([THREADS, TRANSCRIPTS], 'readwrite')
    tx.objectStore(THREADS).delete(id)
    tx.objectStore(TRANSCRIPTS).delete(id)
    await transactionDone(tx)
  } finally {
    db.close()
  }
}

/**
 * Write a thread pulled DOWN from the server into the local mirror (IMA-31),
 * stamping the SERVER's updatedAt rather than Date.now(). saveThread() always
 * means "the user just did something now"; hydration means "this is the
 * server's version, as of when the server last saw it" — using now() here would
 * make every freshly-hydrated thread look locally-newer and immediately race a
 * pointless sync back up. createdAt is preserved from any existing local row.
 */
export async function putServerThread(
  id: string,
  title: string,
  messages: ChatMessage[],
  updatedAt: number,
): Promise<void> {
  if (!isIdbAvailable()) return
  const db = await openDb()
  try {
    const tx = db.transaction([THREADS, TRANSCRIPTS], 'readwrite')
    const threads = tx.objectStore(THREADS)
    const existing = await requestResult(
      threads.get(id) as IDBRequest<ThreadMeta | undefined>,
    )
    const meta: ThreadMeta = {
      id,
      title,
      createdAt: existing?.createdAt ?? updatedAt,
      updatedAt,
      messageCount: messages.length,
      preview: derivePreview(messages),
    }
    threads.put(meta)
    tx.objectStore(TRANSCRIPTS).put({ id, messages } satisfies TranscriptRecord)
    await transactionDone(tx)
  } finally {
    db.close()
  }
}
