import { useQuery } from '@tanstack/react-query'
import { logoUrl, vendorColor, vendorName } from '../vendor'

/**
 * models.dev logos are monochrome `currentColor` SVGs, so an <img> would
 * render them black. Instead we fetch the SVG text once per vendor (~56
 * distinct vendors, cached forever) and inline it so it inherits the brand
 * color. Anything that isn't a plain <svg> (the CDN 200s unknown slugs with
 * an HTML shell) falls back to a letter tile.
 */
async function fetchLogoSvg(vendor: string): Promise<string | null> {
  const response = await fetch(logoUrl(vendor))
  if (!response.ok) return null
  const text = (await response.text()).trim()
  if (!text.startsWith('<svg') || text.includes('<script')) return null
  return text
}

export function VendorLogo({
  vendor,
  size = 36,
}: {
  vendor: string
  size?: number
}) {
  const { data: svg } = useQuery({
    queryKey: ['vendor-logo', vendor],
    queryFn: () => fetchLogoSvg(vendor),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  })

  const color = vendorColor(vendor)

  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-md"
      style={{
        width: size,
        height: size,
        color,
        backgroundColor: `color-mix(in oklab, ${color} 13%, transparent)`,
      }}
    >
      {svg ? (
        <span
          className="block h-[58%] w-[58%] [&_svg]:h-full [&_svg]:w-full"
          // Trusted-ish first-party asset host; content validated to be a
          // script-free <svg> above.
          // biome-ignore lint/security/noDangerouslySetInnerHtml: inlining is required for currentColor tinting
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <span className="text-body font-bold">
          {vendorName(vendor).charAt(0)}
        </span>
      )}
    </span>
  )
}
