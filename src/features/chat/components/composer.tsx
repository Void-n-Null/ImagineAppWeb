import {
  ArrowUp,
  Camera,
  Hash,
  ImagePlus,
  Loader2,
  Mic,
  Plus,
  ScanBarcode,
  Square,
  Tag,
  X,
} from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type {
  ImageAttachment,
  ProductAttachment,
  ScanOutcome,
} from '#/features/agent'
import { formatAttachmentContext } from '#/features/agent/tools'
import { cn } from '#/lib/utils'
import { getProductDetail } from '#/server/functions/get-product-detail'
import { compressImageFile } from '../compress-image'
import { useVoiceInput } from '../voice/use-voice-input'
import { VoiceBar } from './voice-bar'

/**
 * The chat input dock (IMA-6): floating chrome pinned to the bottom, in
 * thumb reach. One [+] gathers every way of pointing the assistant at a
 * product — photo (vision models), barcode scan, typed SKU — so the text
 * field stays a text field. Send flips to Stop while the agent runs.
 */
export function Composer({
  running,
  canAttachImages,
  initialAttachSku,
  onInitialAttachConsumed,
  initialDraft,
  onInitialDraftConsumed,
  onSend,
  onStop,
  onScanAttach,
}: {
  running: boolean
  canAttachImages: boolean
  /** Pre-attach this SKU on mount — the product page's "Ask assistant"
   *  deep link (IMA-29). Consumed once; served from today's cache. */
  initialAttachSku?: number
  onInitialAttachConsumed?: () => void
  /** Pre-fill the draft on mount — the homepage's starter chips. Prefill
   *  only, never auto-send: the employee always reviews before sending. */
  initialDraft?: string
  onInitialDraftConsumed?: () => void
  onSend: (
    text: string,
    attachments: { products: ProductAttachment[]; images: ImageAttachment[] },
  ) => void
  onStop: () => void
  onScanAttach: () => Promise<ScanOutcome>
}) {
  const [text, setText] = useState(initialDraft ?? '')
  const [products, setProducts] = useState<ProductAttachment[]>([])
  const [images, setImages] = useState<ImageAttachment[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [skuMode, setSkuMode] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Voice input (IMA-25): transcript lands in the draft, never auto-sends.
  const voice = useVoiceInput({
    onTranscript: (transcript) => {
      setText((prev) =>
        prev.trim().length > 0 ? `${prev.trimEnd()} ${transcript}` : transcript,
      )
      // Re-fit the textarea once React has committed the new value.
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (!el) return
        el.style.height = 'auto'
        el.style.height = `${Math.min(el.scrollHeight, 128)}px`
      })
    },
  })

  const hasAttachments = products.length > 0 || images.length > 0
  const canSend = !running && (text.trim().length > 0 || hasAttachments)

  const submit = () => {
    if (!canSend) return
    onSend(text.trim(), { products, images })
    setText('')
    setProducts([])
    setImages([])
    setAttachError(null)
    const textarea = textareaRef.current
    if (textarea) textarea.style.height = 'auto'
  }

  const attachProduct = (attachment: ProductAttachment) => {
    setProducts((prev) =>
      prev.some((p) => p.sku === attachment.sku) ? prev : [...prev, attachment],
    )
  }

  // Starter-chip deep link: the draft arrived via useState above; consume the
  // URL param and put the caret at the end so it's one tap to edit or send.
  const initialDraftDone = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once consume, guarded by ref
  useEffect(() => {
    if (initialDraft === undefined || initialDraftDone.current) return
    initialDraftDone.current = true
    const el = textareaRef.current
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 128)}px`
    }
    onInitialDraftConsumed?.()
  }, [])

  // "Ask assistant" deep link: attach the product the employee came from.
  const initialAttachDone = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once consume, guarded by ref
  useEffect(() => {
    if (initialAttachSku === undefined || initialAttachDone.current) return
    initialAttachDone.current = true
    void getProductDetail({ data: { sku: initialAttachSku } })
      .then((result) => {
        if (result.status === 'found') {
          attachProduct({
            sku: result.product.sku,
            name: result.product.name,
            context: formatAttachmentContext(result.product),
          })
        }
      })
      .catch(() => {
        // Lookup failed — the employee can still type; no error theater.
      })
      .finally(() => onInitialAttachConsumed?.())
  }, [])

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setAttachError(null)
    try {
      const compressed = await Promise.all(
        [...files].slice(0, 4).map(compressImageFile),
      )
      setImages((prev) => [...prev, ...compressed].slice(0, 4))
    } catch {
      setAttachError('Could not read that image.')
    }
  }

  const handleScanAttach = () => {
    setMenuOpen(false)
    void onScanAttach().then((outcome) => {
      if (outcome.status === 'scanned') {
        attachProduct({
          sku: outcome.product.sku,
          name: outcome.product.name,
          context: formatAttachmentContext(outcome.product),
        })
      }
    })
  }

  return (
    // In flow at the bottom of the chat's flex column (the message list is
    // its own scroll container above) — no fixed positioning to fight
    // mobile keyboards.
    <div className="shrink-0">
      <div className="mx-auto w-full max-w-lg px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="chrome-float rounded-[1.6rem] p-2">
          {attachError && (
            <p className="px-3 pt-1 pb-1.5 text-caption font-semibold text-danger">
              {attachError}
            </p>
          )}

          {voice.error && (
            <p className="flex items-start justify-between gap-2 px-3 pt-1 pb-1.5 text-caption font-semibold text-danger">
              {voice.error}
              <button
                type="button"
                onClick={voice.dismissError}
                aria-label="Dismiss voice input notice"
                className="shrink-0 text-text-faint"
              >
                <X size={13} aria-hidden="true" />
              </button>
            </p>
          )}

          {hasAttachments && (
            <div className="scrollbar-none flex gap-1.5 overflow-x-auto px-1 pt-1 pb-2">
              {images.map((image, index) => (
                <span
                  key={image.dataUrl.slice(-24)}
                  className="relative shrink-0"
                >
                  <img
                    src={image.dataUrl}
                    alt="Attachment preview"
                    className="h-14 w-14 rounded-lg border border-line object-cover"
                  />
                  <RemoveDot
                    label="Remove image"
                    onClick={() =>
                      setImages((prev) => prev.filter((_, i) => i !== index))
                    }
                  />
                </span>
              ))}
              {products.map((product) => (
                <span
                  key={product.sku}
                  className="relative flex h-14 shrink-0 items-center gap-1.5 rounded-lg bg-raised pr-4 pl-2.5"
                >
                  <Tag
                    size={13}
                    aria-hidden="true"
                    className="shrink-0 text-action"
                  />
                  <span className="flex max-w-36 flex-col">
                    <span className="truncate text-caption font-semibold">
                      {product.name}
                    </span>
                    <span className="tabular text-micro text-text-faint">
                      SKU {product.sku}
                    </span>
                  </span>
                  <RemoveDot
                    label={`Remove ${product.name}`}
                    onClick={() =>
                      setProducts((prev) =>
                        prev.filter((p) => p.sku !== product.sku),
                      )
                    }
                  />
                </span>
              ))}
            </div>
          )}

          {skuMode && (
            <SkuEntry
              onAttach={(attachment) => {
                attachProduct(attachment)
                setSkuMode(false)
              }}
              onClose={() => setSkuMode(false)}
            />
          )}

          {voice.state === 'recording' ? (
            <VoiceBar
              startedAt={voice.startedAt}
              levelsRef={voice.levelsRef}
              onCancel={voice.cancel}
              onFinish={voice.finish}
            />
          ) : (
            <div className="flex items-end gap-1.5">
              <div className="relative">
                <button
                  type="button"
                  aria-label="Add attachment"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((open) => !open)}
                  className={cn(
                    'grid h-10 w-10 shrink-0 place-items-center rounded-full transition-all duration-150 active:scale-95',
                    menuOpen
                      ? 'rotate-45 bg-action-subtle text-action'
                      : 'bg-raised text-text-muted',
                  )}
                >
                  <Plus size={20} aria-hidden="true" />
                </button>

                {menuOpen && (
                  <>
                    <button
                      type="button"
                      aria-label="Close menu"
                      onClick={() => setMenuOpen(false)}
                      className="fixed inset-0 z-0 cursor-default"
                      tabIndex={-1}
                    />
                    <div className="chrome-float absolute bottom-12 left-0 z-10 w-56 rounded-xl p-1.5">
                      <AttachOption
                        icon={
                          canAttachImages ? (
                            <Camera size={17} aria-hidden="true" />
                          ) : (
                            <ImagePlus size={17} aria-hidden="true" />
                          )
                        }
                        label="Photo"
                        hint={
                          canAttachImages
                            ? 'Show the assistant something'
                            : 'Selected model has no vision'
                        }
                        disabled={!canAttachImages}
                        onClick={() => {
                          setMenuOpen(false)
                          fileInputRef.current?.click()
                        }}
                      />
                      <AttachOption
                        icon={<ScanBarcode size={17} aria-hidden="true" />}
                        label="Scan barcode"
                        hint="Attach the product in hand"
                        onClick={handleScanAttach}
                      />
                      <AttachOption
                        icon={<Hash size={17} aria-hidden="true" />}
                        label="Enter SKU"
                        hint="From a shelf tag"
                        onClick={() => {
                          setMenuOpen(false)
                          setSkuMode(true)
                        }}
                      />
                    </div>
                  </>
                )}
              </div>

              <textarea
                ref={textareaRef}
                value={text}
                onChange={(event) => {
                  setText(event.target.value)
                  const el = event.target
                  el.style.height = 'auto'
                  el.style.height = `${Math.min(el.scrollHeight, 128)}px`
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    submit()
                  }
                }}
                rows={1}
                enterKeyHint="send"
                placeholder={
                  voice.state === 'transcribing'
                    ? 'Transcribing…'
                    : 'Ask about a product…'
                }
                aria-label="Message"
                className="focus-quiet max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-body-lg leading-snug placeholder:text-text-faint"
              />

              {voice.supported &&
                (voice.state === 'transcribing' ? (
                  <output
                    aria-label="Transcribing"
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-raised text-action"
                  >
                    <Loader2
                      size={18}
                      className="animate-spin"
                      aria-hidden="true"
                    />
                  </output>
                ) : (
                  <button
                    type="button"
                    onClick={voice.start}
                    aria-label="Dictate a message"
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-raised text-text-muted transition-transform duration-100 active:scale-95"
                  >
                    <Mic size={18} aria-hidden="true" />
                  </button>
                ))}

              {running ? (
                <button
                  type="button"
                  onClick={onStop}
                  aria-label="Stop the assistant"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-action text-action-ink transition-transform duration-100 active:scale-95"
                >
                  <Square size={14} fill="currentColor" aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSend}
                  aria-label="Send message"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-action text-action-ink transition-all duration-100 active:scale-95 disabled:opacity-35"
                >
                  <ArrowUp size={19} strokeWidth={2.5} aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          void handleFiles(event.target.files)
          event.target.value = ''
        }}
      />
    </div>
  )
}

function RemoveDot({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="absolute -top-1 -right-1 grid h-5 w-5 place-items-center rounded-full border border-line bg-raised text-text-muted"
    >
      <X size={11} aria-hidden="true" />
    </button>
  )
}

function AttachOption({
  icon,
  label,
  hint,
  disabled = false,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  hint: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2.5 text-left active:bg-action-subtle disabled:opacity-45"
    >
      <span className="text-action">{icon}</span>
      <span className="min-w-0">
        <span className="block text-body-sm font-bold">{label}</span>
        <span className="block truncate text-micro text-text-faint">
          {hint}
        </span>
      </span>
    </button>
  )
}

/** Inline SKU entry: shelf tags print the SKU; typing beats scanning glare. */
function SkuEntry({
  onAttach,
  onClose,
}: {
  onAttach: (attachment: ProductAttachment) => void
  onClose: () => void
}) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()

  const lookup = () => {
    const sku = Number.parseInt(value, 10)
    if (!Number.isSafeInteger(sku) || sku <= 0) {
      setError('SKUs are the numbers on the shelf tag.')
      return
    }
    setBusy(true)
    setError(null)
    void getProductDetail({ data: { sku } })
      .then((result) => {
        if (result.status === 'found') {
          onAttach({
            sku: result.product.sku,
            name: result.product.name,
            context: formatAttachmentContext(result.product),
          })
        } else if (result.status === 'not_found') {
          setError(`No product for SKU ${sku}.`)
        } else {
          setError(result.message)
        }
      })
      .catch(() => setError('Lookup failed — check connection.'))
      .finally(() => setBusy(false))
  }

  return (
    <div className="px-1 pt-1 pb-2">
      <div className="flex items-center gap-1.5 rounded-xl bg-raised p-1.5">
        <label htmlFor={inputId} className="sr-only">
          SKU number
        </label>
        <input
          id={inputId}
          // biome-ignore lint/a11y/noAutofocus: entering SKU mode IS choosing this field
          autoFocus
          value={value}
          onChange={(event) =>
            setValue(event.target.value.replace(/\D/g, '').slice(0, 9))
          }
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              lookup()
            }
          }}
          inputMode="numeric"
          placeholder="SKU from the shelf tag"
          className="focus-quiet tabular min-h-9 min-w-0 flex-1 bg-transparent px-2 font-mono text-body placeholder:font-sans placeholder:text-text-faint"
        />
        <button
          type="button"
          onClick={lookup}
          disabled={busy || value.length === 0}
          className="min-h-9 shrink-0 rounded-lg bg-action px-3.5 text-body-sm font-bold text-action-ink disabled:opacity-35"
        >
          {busy ? (
            <Loader2
              size={15}
              aria-label="Looking up"
              className="animate-spin"
            />
          ) : (
            'Attach'
          )}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close SKU entry"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-text-muted"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {error && (
        <p className="px-2 pt-1.5 text-caption font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
