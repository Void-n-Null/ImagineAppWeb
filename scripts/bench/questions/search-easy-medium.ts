import type { BenchQuestion } from '../checks'

/**
 * Objective benchmark questions for the `search` concept, difficulties easy
 * and medium. Every pass criterion was verified on 2026-07-08 against the live
 * Best Buy catalog via:
 *   bun --preload ./scripts/bench/preload.ts scripts/bench/tool-cli.ts \
 *     search_products '<json>'
 *
 * easy   = one obvious search call resolves it (popularity sort = review
 *          volume). Where #1/#2 are near-ties or share a review count across
 *          color/size variants, the sku check lists every tied top SKU.
 * medium = a filtered / multi-constraint search (brand + price band + rating
 *          floor, category + size range + sort) leaving a small candidate set.
 *
 * Checks are binary: sku matches the digit string of a [Product(SKU)] card;
 * substring is case-insensitive and passes if ANY value appears.
 */
export const SEARCH_EASY_MEDIUM: BenchQuestion[] = [
  // ── EASY ──────────────────────────────────────────────────────────────
  {
    id: 'search-easy-1',
    concept: 'search',
    difficulty: 'easy',
    prompt: "What's the most popular 65 inch TV we carry?",
    check: { kind: 'sku', skus: [6544733, 6639210, 6605982] },
    notes:
      "2026-07-08 search_products {category:'TVs',screen_size_min:63,screen_size_max:67,sort_by:'popularity'}. " +
      'Top by review volume: Sony BRAVIA XR X90L 6544733 (4.8/5, 1893 reviews) — clear leader; ' +
      'then Samsung U7900 6639210 (1524), Insignia F50 6605982 (1435). #1 gap is wide so 6544733 is ' +
      'the true answer; top-3 SKUs included for tolerance (model may surface a couple).',
  },
  {
    id: 'search-easy-2',
    concept: 'search',
    difficulty: 'easy',
    prompt: 'Which MacBook Air is the most popular one?',
    check: { kind: 'sku', skus: [6534483, 6565864] },
    notes:
      "2026-07-08 search_products {query:'macbook air',category:'Laptops',manufacturer:'Apple',sort_by:'popularity'}. " +
      'Top: MacBook Air 15" M2 Starlight 6534483 (4.9/5, 4749 reviews); then Air 15" M4 6565864 (3327). ' +
      'Clear #1 gap; both top SKUs included for tolerance.',
  },
  {
    id: 'search-easy-3',
    concept: 'search',
    difficulty: 'easy',
    prompt: 'A customer is asking about AirPods Pro — can you pull those up?',
    check: { kind: 'sku', skus: [6376563] },
    notes:
      "2026-07-08 search_products {query:'airpods pro',category:'Headphones',manufacturer:'Apple'}. " +
      'Exactly 1 result: Apple AirPods Pro 3 6376563 (4.8/5, 9506 reviews). Unambiguous single answer.',
  },
  {
    id: 'search-easy-4',
    concept: 'search',
    difficulty: 'easy',
    prompt: "What's our best-selling Nintendo Switch console?",
    check: { kind: 'sku', skus: [6522225] },
    notes:
      "2026-07-08 search_products {query:'nintendo switch',category:'Video Games',manufacturer:'Nintendo',sort_by:'popularity'}. " +
      'Top result is the Switch console w/ Neon Joy-Con 6522225 (4.9/5, 56261 reviews) — massive gap over #2 ' +
      '(Mario Kart 8, 33635 reviews, a game). "console" in prompt disambiguates from games.',
  },
  {
    id: 'search-easy-5',
    concept: 'search',
    difficulty: 'easy',
    prompt: 'Which Samsung refrigerator do people buy the most?',
    check: { kind: 'sku', skus: [6397574, 6397576, 4980442] },
    notes:
      "2026-07-08 search_products {category:'Refrigerators',manufacturer:'Samsung',sort_by:'popularity'}. " +
      'Top two are the same 27.4 cu ft side-by-side in two finishes, tied at 4688 reviews (4.5/5): ' +
      '6397574 (Black Stainless) & 6397576 (Stainless); then French Door 4980442 (4527). ' +
      'All three top SKUs included since #1/#2 are a color-variant tie.',
  },
  {
    id: 'search-easy-6',
    concept: 'search',
    difficulty: 'easy',
    prompt: 'What HDMI cable do you recommend — the most popular one?',
    check: { kind: 'sku', skus: [3720002, 3720011, 3721001] },
    notes:
      "2026-07-08 search_products {query:'hdmi cable',category:'HDMI Cables',sort_by:'popularity'}. " +
      'Top three are Rocketfish 4K In-Wall HDMI in 4ft/8ft/12ft lengths, all sharing 43868 reviews (4.7/5): ' +
      '3720002, 3720011, 3721001. Length-variant tie, so all three top SKUs are accepted.',
  },

  // ── MEDIUM ────────────────────────────────────────────────────────────
  {
    id: 'search-medium-1',
    concept: 'search',
    difficulty: 'medium',
    prompt: "What's the highest-rated Sony soundbar under $300?",
    check: { kind: 'sku', skus: [6498905] },
    notes:
      "2026-07-08 search_products {category:'Soundbars',manufacturer:'Sony',max_price:300,sort_by:'rating'}. " +
      'Only 2 Sony soundbars ≤ $300: HT-S400 6498905 (4.5/5, 1615 reviews, $299.99) beats HTS100F 6380856 ' +
      '(4.4/5, $99.99). Winner 6498905.',
  },
  {
    id: 'search-medium-2',
    concept: 'search',
    difficulty: 'medium',
    prompt: 'A customer wants a 65 inch LG OLED but under $1500 — what should I show them?',
    check: { kind: 'sku', skus: [6621824] },
    notes:
      "2026-07-08 search_products {category:'TVs',manufacturer:'LG',screen_size_min:63,screen_size_max:67,max_price:1500,min_rating:4.5,sort_by:'popularity'}. " +
      'The only high-volume OLED in-band is the LG C5 OLED evo 6621824 ($1399.99, 4.8/5, 1429 reviews); ' +
      'next OLED (B5 6633087) has 374 reviews. Non-OLED results are irrelevant to the prompt. Answer 6621824.',
  },
  {
    id: 'search-medium-3',
    concept: 'search',
    difficulty: 'medium',
    prompt: 'Whats the most popular 27 inch LG monitor we stock?',
    check: { kind: 'sku', skus: [6638894] },
    notes:
      "2026-07-08 search_products {category:'Monitors',manufacturer:'LG',screen_size_min:26,screen_size_max:28,sort_by:'popularity'}. " +
      '3 results; leader by review volume is the LG 27" IPS FHD 120Hz 6638894 (4.6/5, 382 reviews) vs ' +
      '86 & 75 for the others. Clear winner 6638894.',
  },
  {
    id: 'search-medium-4',
    concept: 'search',
    difficulty: 'medium',
    prompt: 'Which unlocked Samsung Galaxy S25 phone is the most popular?',
    check: {
      kind: 'anyOf',
      checks: [
        { kind: 'sku', skus: [6612723, 6612724, 6612725, 6612727] },
        { kind: 'substring', values: ['Galaxy S25 Ultra'] },
      ],
    },
    notes:
      "2026-07-08 search_products {query:'galaxy s25',category:'Cell Phones',manufacturer:'Samsung',sort_by:'popularity'}. " +
      'Top four results are all Galaxy S25 Ultra 256GB (Unlocked) color variants tied at 1714 reviews (4.8/5): ' +
      '6612723/6612724/6612725/6612727; next is S25 FE at 576 reviews. Accept any Ultra SKU or the ' +
      '"Galaxy S25 Ultra" name.',
  },
  {
    id: 'search-medium-5',
    concept: 'search',
    difficulty: 'medium',
    prompt: "What's a good Bose noise cancelling headphone under $400 that people love?",
    check: {
      kind: 'anyOf',
      checks: [
        {
          kind: 'sku',
          skus: [6554461, 6589634, 6554460, 6554463, 6620216, 6623857],
        },
        { kind: 'substring', values: ['QuietComfort'] },
      ],
    },
    notes:
      "2026-07-08 search_products {query:'headphones',category:'Headphones',manufacturer:'Bose',max_price:400,sort_by:'popularity'}. " +
      'Every top result is a Bose QuietComfort Wireless NC Over-the-Ear color variant, all $359, all tied at ' +
      '3666 reviews (4.8/5). Robust answer is the "QuietComfort" model; representative SKUs listed ' +
      '(6554461 Black, 6589634, 6554460, 6554463, 6620216, 6623857).',
  },
  {
    id: 'search-medium-6',
    concept: 'search',
    difficulty: 'medium',
    prompt: "I need a cheap HP laptop under $600 — which one's the most popular?",
    check: { kind: 'sku', skus: [6499751, 6499942, 6579293, 6612977] },
    notes:
      "2026-07-08 search_products {category:'Laptops',manufacturer:'HP',max_price:600,sort_by:'popularity'}. " +
      'By review volume the leaders are the HP 14" Celeron 4GB/64GB in Indigo Blue 6499751 & Rose Gold 6499942, ' +
      'tied at 5929 reviews (4.1/5); next are HP Chromebooks 6579293 & 6612977 (1635 each). Top-4 SKUs accepted ' +
      '(availability varies but is not part of the criterion).',
  },
]
