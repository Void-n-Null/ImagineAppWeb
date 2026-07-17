import { Check, Copy, MessageSquareQuote } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

/**
 * Tap-to-copy identifier chip (IMA-10, ported from v1's copyable chips).
 * SKU / model / UPC are the currency of floor conversations — employees
 * paste them into the register, RSS, and vendor portals all day. The whole
 * chip is the target; feedback is inline (check + "Copied").
 */
export function CopyChip({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  const copy = () => {
    navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(true)
        if (timer.current !== null) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 1600)
      })
      .catch(() => {})
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${label} ${value}`}
      className="relative flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full bg-raised px-3 font-mono text-caption text-text-muted transition-transform duration-100 active:scale-[0.97]"
    >
      <span className="text-text-faint">{label}</span>
      <span className="font-semibold text-text">{value}</span>
      {copied ? (
        <Check
          size={12}
          strokeWidth={3}
          aria-hidden="true"
          className="text-ok"
        />
      ) : (
        <Copy size={12} aria-hidden="true" className="text-text-faint" />
      )}
      <span aria-live="polite" className="sr-only">
        {copied ? 'Copied' : ''}
      </span>
    </button>
  )
}

/**
 * "Copy summary" chip (IMA-29): copies a customer-ready quote block (name,
 * price, SKU/model, availability) built by customer-quote.ts — for the
 * "can you send me that?" moment. Same chip anatomy as CopyChip, but the
 * payload is multi-line so the chip shows a verb, not the value.
 */
export function CopyQuoteChip({ buildText }: { buildText: () => string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  const copy = () => {
    navigator.clipboard
      ?.writeText(buildText())
      .then(() => {
        setCopied(true)
        if (timer.current !== null) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 1600)
      })
      .catch(() => {})
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copy product summary for the customer"
      className="relative flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-raised px-3 text-caption font-semibold text-text-muted transition-transform duration-100 active:scale-[0.97]"
    >
      {copied ? (
        <Check
          size={12}
          strokeWidth={3}
          aria-hidden="true"
          className="text-ok"
        />
      ) : (
        <MessageSquareQuote
          size={12}
          aria-hidden="true"
          className="text-action"
        />
      )}
      {copied ? 'Copied for customer' : 'Copy summary'}
      <span aria-live="polite" className="sr-only">
        {copied ? 'Copied' : ''}
      </span>
    </button>
  )
}
