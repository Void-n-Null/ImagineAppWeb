import { memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '#/lib/utils'
import {
  collectCardSkus,
  parseRichSegments,
  type RichSegment,
  trimPartialRichToken,
} from '../rich-cards'
import { useCardProducts } from '../use-card-products'
import {
  CompareRichCard,
  FitVerdictCard,
  MissingProductNote,
  ProductCardSkeleton,
  ProductRichCard,
  SearchRichCard,
} from './rich-cards'

/**
 * Assistant markdown (IMA-6) + rich card syntax (IMA-7).
 *
 * The model's text is split into segments around [Product(SKU)] /
 * [Compare(...)] / [ShowSearch(...)] tokens; text segments render through
 * react-markdown (`.chat-prose`, the app's own type scale), card segments
 * as Price Tag cards. One batched product fetch covers every card in the
 * message. `streaming` holds back a trailing partial token so raw syntax
 * never flashes mid-stream.
 *
 * Links open in new tabs — leaving mid-conversation on a phone loses the
 * thread.
 */
export const Markdown = memo(function Markdown({
  text,
  className,
  streaming = false,
}: {
  text: string
  className?: string
  streaming?: boolean
}) {
  const display = streaming ? trimPartialRichToken(text) : text
  const segments = useMemo(() => parseRichSegments(display), [display])
  const { products, isLoading } = useCardProducts(collectCardSkus(segments))

  // One structure whether or not cards are present: if this branched, the
  // first card completing mid-stream would swap the tree shape and remount
  // the whole message (visible repaint of everything already on screen).
  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      {segments.map((segment, index) => (
        <Segment
          // Segments are positional within one immutable-ish text.
          // biome-ignore lint/suspicious/noArrayIndexKey: no stable identity exists
          key={index}
          segment={segment}
          products={products}
          isLoading={isLoading}
        />
      ))}
    </div>
  )
})

function Segment({
  segment,
  products,
  isLoading,
}: {
  segment: RichSegment
  products: ReturnType<typeof useCardProducts>['products']
  isLoading: boolean
}) {
  switch (segment.kind) {
    case 'text':
      return (
        <div className="chat-prose">
          <Prose text={segment.text} />
        </div>
      )
    case 'product': {
      const product = products.get(segment.sku)
      if (product) return <ProductRichCard product={product} />
      if (isLoading) return <ProductCardSkeleton />
      return <MissingProductNote skus={[segment.sku]} />
    }
    case 'compare': {
      // Skeleton only while THIS strip's SKUs are unresolved — a fetch for
      // some later card must not knock a settled strip back to a pulse.
      const unresolved = segment.skus.some((sku) => !products.has(sku))
      if (unresolved && isLoading) return <ProductCardSkeleton />
      return <CompareRichCard skus={segment.skus} products={products} />
    }
    case 'search':
      return <SearchRichCard query={segment.query} />
    case 'fit-verdict':
      return <FitVerdictCard verdict={segment} />
  }
}

function Prose({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ node: _node, children, ...props }) => (
          <a {...props} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  )
}
