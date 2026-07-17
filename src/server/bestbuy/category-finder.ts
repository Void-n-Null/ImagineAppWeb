/**
 * Category name → Best Buy category ID resolution — TS port of v1's
 * CategoryFinder (lib/services/bestbuy/category_finder.dart).
 *
 * Best Buy categories are opaque magic IDs (`abcat0502000` = Laptops) with no
 * server-side fuzzy lookup, and some IDs are silently dead (abcat0515018 "USB
 * cables" is empty; abcat0515013 is the live one — a lesson v1 paid for).
 * This table is curated tribal knowledge: the categories a floor conversation
 * actually reaches, with keyword aliases for fuzzy matching.
 *
 * Pure module by design (v1's API-fallback path fetched only top-level
 * categories and substring-matched them — near-useless, dropped). Unresolved
 * names simply fall back to keyword-only search; the agent can browse the
 * real tree via BestBuyClient.categories() when it needs to.
 */

export interface CategoryEntry {
  id: string
  name: string
  parentName?: string
  keywords: readonly string[]
}

export interface CategoryMatch {
  entry: CategoryEntry
  /** 0–1; 1.0 is an exact name match. */
  score: number
  isExactMatch: boolean
}

/* biome-ignore format: data table reads better compact */
export const CATEGORY_TABLE: readonly CategoryEntry[] = [
  // ── Top level ──
  { id: 'abcat0100000', name: 'TV & Home Theater', keywords: ['tv', 'television', 'home theater', 'entertainment'] },
  { id: 'abcat0200000', name: 'Home Audio & Speakers', keywords: ['audio', 'speakers', 'stereo', 'sound system'] },
  { id: 'abcat0204000', name: 'Headphones', keywords: ['headphones', 'earbuds', 'earphones', 'audio'] },
  { id: 'abcat0207000', name: 'Musical Instruments', keywords: ['music', 'instruments', 'guitar', 'piano', 'drums'] },
  { id: 'abcat0300000', name: 'Car Electronics & GPS', keywords: ['car', 'auto', 'gps', 'navigation', 'dash cam'] },
  { id: 'abcat0400000', name: 'Cameras, Camcorders & Drones', keywords: ['camera', 'photo', 'video', 'drone', 'camcorder', 'photography'] },
  { id: 'abcat0500000', name: 'Computers & Tablets', keywords: ['computer', 'pc', 'laptop', 'tablet', 'ipad'] },
  { id: 'abcat0600000', name: 'Music, Movies & TV Shows', keywords: ['music', 'movies', 'dvd', 'blu-ray', 'vinyl', 'cd'] },
  { id: 'abcat0700000', name: 'Video Games', keywords: ['games', 'gaming', 'xbox', 'playstation', 'nintendo', 'switch', 'ps5'] },
  { id: 'abcat0800000', name: 'Cell Phones', keywords: ['phone', 'cell', 'mobile', 'iphone', 'android', 'smartphone'] },
  { id: 'abcat0900000', name: 'Appliances', keywords: ['appliance', 'refrigerator', 'washer', 'dryer', 'kitchen'] },
  { id: 'pcmcat1528819595254', name: 'Services', keywords: ['service', 'geek squad', 'installation', 'repair'] },

  // ── Computers ──
  { id: 'abcat0502000', name: 'Laptops', parentName: 'Computers & Tablets', keywords: ['laptop', 'notebook', 'macbook', 'chromebook', 'portable'] },
  { id: 'abcat0501000', name: 'Desktop & All-in-One Computers', parentName: 'Computers & Tablets', keywords: ['desktop', 'pc', 'imac', 'all-in-one', 'tower'] },
  { id: 'pcmcat209000050006', name: 'Tablets', parentName: 'Computers & Tablets', keywords: ['tablet', 'ipad', 'android tablet', 'surface'] },
  { id: 'abcat0507000', name: 'Computer Cards & Components', parentName: 'Computers & Tablets', keywords: ['components', 'gpu', 'cpu', 'motherboard', 'ram', 'pc parts'] },
  { id: 'abcat0504000', name: 'Hard Drives & Storage', parentName: 'Computers & Tablets', keywords: ['storage', 'hard drive', 'ssd', 'hdd', 'external drive'] },
  { id: 'abcat0509000', name: 'Monitors', parentName: 'Computers & Tablets', keywords: ['monitor', 'display', 'screen', 'computer monitor'] },
  { id: 'abcat0503000', name: 'Wi-Fi & Networking', parentName: 'Computers & Tablets', keywords: ['wifi', 'router', 'modem', 'networking', 'mesh', 'ethernet'] },
  { id: 'abcat0515000', name: 'Computer Accessories & Peripherals', parentName: 'Computers & Tablets', keywords: ['accessories', 'peripherals', 'computer accessories'] },
  { id: 'abcat0513000', name: 'Mice & Keyboards', parentName: 'Computer Accessories', keywords: ['mouse', 'keyboard', 'mice', 'mechanical keyboard'] },
  { id: 'abcat0515046', name: 'Webcams', parentName: 'Computer Accessories', keywords: ['webcam', 'web camera', 'streaming camera'] },
  { id: 'abcat0511001', name: 'Printers, Ink & Toner', parentName: 'Computer Accessories', keywords: ['printer', 'ink', 'toner', 'printing'] },

  // ── Cables & connectors ──
  { id: 'abcat0515012', name: 'Cables & Connectors', parentName: 'Computer Accessories', keywords: ['cable', 'connector', 'cord', 'wire', 'cables'] },
  // abcat0515013 is the LIVE USB-cables category (abcat0515018 is empty/dead).
  { id: 'abcat0515013', name: 'USB Cables & Adapters', parentName: 'Cables & Connectors', keywords: ['usb', 'usb cable', 'usb cables', 'usb adapter', 'usb-c', 'usb c', 'type-c', 'type c', 'micro usb', 'lightning', 'charging cable', 'data cable'] },
  { id: 'abcat0515016', name: 'Ethernet Cables', parentName: 'Cables & Connectors', keywords: ['ethernet', 'network cable', 'cat5', 'cat6', 'lan cable'] },
  { id: 'pcmcat138100050035', name: 'Monitor & Video Cables', parentName: 'Cables & Connectors', keywords: ['video cable', 'display cable', 'displayport', 'vga', 'dvi'] },
  { id: 'pcmcat138100050040', name: 'Power Cables', parentName: 'Cables & Connectors', keywords: ['power cable', 'power cord', 'ac adapter'] },
  { id: 'pcmcat1584032708792', name: 'USB Hubs', parentName: 'Cables & Connectors', keywords: ['usb hub', 'port hub', 'usb splitter'] },
  { id: 'abcat0107015', name: 'A/V Cables & Connectors', parentName: 'TV & Home Theater Accessories', keywords: ['av cable', 'audio video', 'rca', 'component'] },
  { id: 'abcat0107020', name: 'HDMI Cables', parentName: 'A/V Cables & Connectors', keywords: ['hdmi', 'hdmi cable', 'hdmi cord', 'high speed hdmi'] },

  // ── Cell phones ──
  { id: 'abcat0811002', name: 'Cell Phone Accessories', parentName: 'Cell Phones', keywords: ['phone accessories', 'mobile accessories', 'cell accessories'] },
  { id: 'abcat0811004', name: 'Cell Phone Chargers & Cables', parentName: 'Cell Phone Accessories', keywords: ['phone charger', 'charging cable', 'lightning cable', 'phone cable'] },
  { id: 'abcat0811006', name: 'Cell Phone Cases', parentName: 'Cell Phone Accessories', keywords: ['phone case', 'case', 'cover', 'protective case'] },
  { id: 'pcmcat171900050031', name: 'Cell Phone Screen Protectors', parentName: 'Cell Phone Accessories', keywords: ['screen protector', 'tempered glass', 'screen guard'] },
  { id: 'pcmcat191200050015', name: 'iPhone Accessories', parentName: 'Cell Phone Accessories', keywords: ['iphone', 'apple accessories', 'ios accessories'] },
  { id: 'pcmcat305200050007', name: 'Samsung Galaxy Accessories', parentName: 'Cell Phone Accessories', keywords: ['samsung', 'galaxy', 'android accessories'] },
  { id: 'pcmcat156400050037', name: 'Unlocked Cell Phones', parentName: 'Cell Phones', keywords: ['unlocked', 'unlocked phone', 'no contract'] },
  { id: 'pcmcat305200050000', name: 'iPhone', parentName: 'Cell Phones', keywords: ['iphone', 'apple phone', 'ios'] },
  { id: 'pcmcat305200050001', name: 'Samsung Galaxy', parentName: 'Cell Phones', keywords: ['samsung', 'galaxy', 'android phone'] },
  { id: 'pcmcat321000050003', name: 'Smartwatches & Accessories', parentName: 'Cell Phone Accessories', keywords: ['smartwatch', 'apple watch', 'fitness tracker', 'wearable'] },

  // ── TV & home theater ──
  { id: 'abcat0101000', name: 'TVs', parentName: 'TV & Home Theater', keywords: ['tv', 'television', 'smart tv', 'oled', 'qled', '4k tv'] },
  { id: 'abcat0205007', name: 'Sound Bars', parentName: 'TV & Home Theater', keywords: ['soundbar', 'sound bar', 'tv speaker', 'home audio'] },
  { id: 'abcat0203000', name: 'Home Theater & Stereo Systems', parentName: 'TV & Home Theater', keywords: ['home theater', 'stereo', 'surround sound', 'receiver'] },
  { id: 'pcmcat161100050040', name: 'Streaming Devices', parentName: 'TV & Home Theater', keywords: ['streaming', 'roku', 'fire tv', 'chromecast', 'apple tv'] },
  { id: 'abcat0107000', name: 'TV & Home Theater Accessories', parentName: 'TV & Home Theater', keywords: ['tv accessories', 'home theater accessories'] },
  { id: 'abcat0106000', name: 'TV Stands, Mounts & Furniture', parentName: 'TV & Home Theater', keywords: ['tv stand', 'tv mount', 'wall mount', 'entertainment center'] },
  { id: 'pcmcat158900050008', name: 'Projectors & Screens', parentName: 'TV & Home Theater', keywords: ['projector', 'projection', 'screen', 'home cinema'] },

  // ── Gaming ──
  { id: 'abcat0712000', name: 'PC Gaming', parentName: 'Video Games', keywords: ['pc gaming', 'gaming pc', 'computer games'] },
  { id: 'abcat0701000', name: 'PlayStation', parentName: 'Video Games', keywords: ['playstation', 'ps5', 'ps4', 'sony', 'psn'] },
  { id: 'abcat0707000', name: 'Xbox', parentName: 'Video Games', keywords: ['xbox', 'xbox series x', 'xbox one', 'microsoft'] },
  { id: 'abcat0703000', name: 'Nintendo', parentName: 'Video Games', keywords: ['nintendo', 'switch', 'mario', 'zelda'] },
  { id: 'abcat0715000', name: 'Video Game Accessories', parentName: 'Video Games', keywords: ['gaming accessories', 'controller', 'headset'] },

  // ── Cameras & drones ──
  { id: 'abcat0401000', name: 'Digital Cameras', parentName: 'Cameras, Camcorders & Drones', keywords: ['camera', 'digital camera', 'dslr', 'mirrorless'] },
  { id: 'pcmcat242800050021', name: 'Drones', parentName: 'Cameras, Camcorders & Drones', keywords: ['drone', 'quadcopter', 'dji', 'aerial'] },
  { id: 'abcat0410000', name: 'Digital Camera Accessories', parentName: 'Cameras, Camcorders & Drones', keywords: ['camera accessories', 'lens', 'tripod', 'camera bag'] },
  { id: 'abcat0402000', name: 'Camcorders', parentName: 'Cameras, Camcorders & Drones', keywords: ['camcorder', 'video camera', 'action camera', 'gopro'] },

  // ── Appliances ──
  { id: 'abcat0901000', name: 'Refrigerators', parentName: 'Appliances', keywords: ['refrigerator', 'fridge', 'freezer'] },
  { id: 'abcat0912000', name: 'Washers & Dryers', parentName: 'Appliances', keywords: ['washer', 'dryer', 'laundry', 'washing machine'] },
  { id: 'abcat0904000', name: 'Ranges, Cooktops & Ovens', parentName: 'Appliances', keywords: ['range', 'oven', 'stove', 'cooktop'] },
  { id: 'abcat0905000', name: 'Dishwashers', parentName: 'Appliances', keywords: ['dishwasher'] },
  { id: 'abcat0910000', name: 'Small Kitchen Appliances', parentName: 'Appliances', keywords: ['small appliance', 'blender', 'coffee maker', 'toaster', 'air fryer'] },
  { id: 'abcat0908000', name: 'Vacuums & Floor Care', parentName: 'Appliances', keywords: ['vacuum', 'floor care', 'roomba', 'robot vacuum'] },

  // ── Smart home ──
  { id: 'pcmcat254000050002', name: 'Smart Home', keywords: ['smart home', 'home automation', 'connected home'] },
  { id: 'pcmcat748302046861', name: 'Smart Speakers & Displays', parentName: 'Smart Home', keywords: ['smart speaker', 'alexa', 'echo', 'google home', 'homepod'] },
  { id: 'pcmcat254000050003', name: 'Smart Lighting', parentName: 'Smart Home', keywords: ['smart light', 'philips hue', 'smart bulb', 'led'] },
  { id: 'pcmcat254700050006', name: 'Smart Thermostats', parentName: 'Smart Home', keywords: ['thermostat', 'nest', 'ecobee', 'smart thermostat'] },
  { id: 'pcmcat254900050006', name: 'Smart Doorbells & Locks', parentName: 'Smart Home', keywords: ['doorbell', 'ring', 'smart lock', 'security'] },
]

/** Find the single best category for a query, or null below `threshold`. */
export function findCategory(
  query: string,
  threshold = 0.3,
): CategoryMatch | null {
  const matches = findCategories(query, { limit: 1, threshold })
  return matches[0] ?? null
}

/** All categories matching the query, best first. */
export function findCategories(
  query: string,
  options: { limit?: number; threshold?: number } = {},
): CategoryMatch[] {
  const { limit = 10, threshold = 0.2 } = options
  const normalizedQuery = normalize(query)
  if (normalizedQuery.length === 0) return []

  const matches: CategoryMatch[] = []
  for (const entry of CATEGORY_TABLE) {
    const score = matchScore(normalizedQuery, entry)
    if (score >= threshold) {
      matches.push({ entry, score, isExactMatch: score >= 1.0 })
    }
  }
  matches.sort((a, b) => b.score - a.score || specificity(b) - specificity(a))
  return matches.slice(0, limit)
}

export function categoryById(id: string): CategoryEntry | null {
  return CATEGORY_TABLE.find((entry) => entry.id === id) ?? null
}

/**
 * Suggest a category for a free-text product search: try the whole query at
 * a moderate threshold, then individual words at a strict one.
 */
export function suggestCategoryForSearch(
  searchQuery: string,
): CategoryMatch | null {
  const whole = findCategory(searchQuery, 0.4)
  if (whole !== null) return whole

  for (const word of searchQuery.toLowerCase().split(/\s+/)) {
    if (word.length < 3) continue
    const match = findCategory(word, 0.5)
    if (match !== null) return match
  }
  return null
}

/**
 * Tie-break: prefer the more specific category. v1 left equal-score ties to
 * unstable sort order, so "laptop" resolved to the Computers & Tablets
 * PARENT (both carry the keyword) depending on table order. Subcategories
 * constrain searches harder, which is the whole point of resolving one.
 */
function specificity(match: CategoryMatch): number {
  return match.entry.parentName === undefined ? 0 : 1
}

// ────────────────────────────── Scoring ──────────────────────────────

/**
 * Layered scoring (ported intact from v1 — proven on the floor):
 * exact name 1.0 > keyword exact 0.9 > name-contains 0.8 > query-contains
 * 0.7 > keyword partial 0.6 > word overlap ≤0.5 > Levenshtein ≤0.6.
 */
function matchScore(query: string, entry: CategoryEntry): number {
  let score = 0

  const name = normalize(entry.name)
  const keywords = entry.keywords.map(normalize)

  if (query === name) return 1.0
  if (name.includes(query)) score = Math.max(score, 0.8)
  if (query.includes(name)) score = Math.max(score, 0.7)
  if (keywords.includes(query)) score = Math.max(score, 0.9)
  for (const keyword of keywords) {
    if (keyword.includes(query) || query.includes(keyword)) {
      score = Math.max(score, 0.6)
    }
  }

  const queryWords = query.split(/\s+/)
  const targetWords = [...name.split(/\s+/), ...keywords]
  let matching = 0
  for (const qWord of queryWords) {
    if (qWord.length < 2) continue
    if (targetWords.some((t) => t.includes(qWord) || qWord.includes(t))) {
      matching++
    }
  }
  if (queryWords.length > 0) {
    score = Math.max(score, (matching / queryWords.length) * 0.5)
  }

  const similarity = stringSimilarity(query, name)
  if (similarity > 0.7) score = Math.max(score, similarity * 0.6)

  return score
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 0 (different) → 1 (identical), Levenshtein over the longer string. */
function stringSimilarity(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0
  if (a === b) return 1
  const longer = a.length > b.length ? a : b
  const shorter = a.length > b.length ? b : a
  return (longer.length - levenshtein(longer, shorter)) / longer.length
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  let current = new Array<number>(b.length + 1).fill(0)

  for (let i = 0; i < a.length; i++) {
    current[0] = i + 1
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1
      current[j + 1] = Math.min(
        current[j] + 1,
        previous[j + 1] + 1,
        previous[j] + cost,
      )
    }
    ;[previous, current] = [current, previous]
  }
  return previous[b.length]
}
