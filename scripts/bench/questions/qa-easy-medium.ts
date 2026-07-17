import type { BenchQuestion } from '../checks'

/**
 * QA (single-product factual lookup) benchmark questions — easy + medium.
 *
 * Every pass criterion below is a distinctive FACT VALUE that appears verbatim
 * in the analyze_product tool output (formatProductContext), verified live on
 * 2026-07-08 via scripts/bench/tool-cli.ts. Product names are phrased the way a
 * floor employee reading a shelf tag would type them — the model must search by
 * name, then analyze the SKU. Never a spec that only lives on the open web.
 *
 * Tool quirk worth knowing: the `category` arg is fuzzy-matched and sometimes
 * MIS-matches — e.g. category:"Video Game Consoles" resolved to "Cameras,
 * Camcorders & Drones" and returned zero results (2026-07-08). The grounding
 * searches below use category only where it matched cleanly; PS5 questions rely
 * on a bare query. The benched models are free to drop category and retry.
 */

export const QA_EASY_MEDIUM: BenchQuestion[] = [
  // ── EASY ──────────────────────────────────────────────────────────────
  {
    id: 'qa-easy-1',
    concept: 'qa',
    difficulty: 'easy',
    prompt:
      'How much memory does the Apple MacBook Air 15" with the M2 chip in Starlight come with?',
    check: { kind: 'substring', values: ['8GB', '8 GB'] },
    notes:
      "2026-07-08. search_products {query:'macbook air 15 m2 starlight'} → SKU 6534483. " +
      'analyze_product 6534483: name "…8GB Memory - 256GB SSD - Starlight". ' +
      'Adversarial note: the feature bullets say "Up to 24GB of unified memory" — that ' +
      "describes the M2 family, NOT this SKU. The correct configured answer is 8GB; check " +
      'deliberately does not accept "24GB".',
  },
  {
    id: 'qa-easy-2',
    concept: 'qa',
    difficulty: 'easy',
    prompt:
      'What is the rated battery life on the Sony WH-1000XM5 wireless noise cancelling headphones?',
    check: { kind: 'substring', values: ['30 hours', '30 hour', '30hr', '30-hour'] },
    notes:
      "2026-07-08. search_products {query:'sony wh-1000xm5', category:'Headphones'} → SKU 6505727 (Black). " +
      'analyze_product 6505727, Key features: "All day power… With up to 30 hours of battery life". ' +
      'Substring is the numeric value; "30 hours" is distinctive vs any wrong figure.',
  },
  {
    id: 'qa-easy-3',
    concept: 'qa',
    difficulty: 'easy',
    prompt:
      'What is the total cooking capacity of the Ninja Foodi 6-in-1 2-Basket Air Fryer with DualZone (the XL model)?',
    check: { kind: 'substring', values: ['10-qt', '10 qt', '10-quart', '10 quart'] },
    notes:
      "2026-07-08. search_products {query:'ninja foodi air fryer dualzone'} → SKU 6512365 (DZ550, XL 2-Basket). " +
      'analyze_product 6512365: name + feature "XL 10-qt. capacity"; two independent 5-qt. zones. ' +
      'Check requires the "10" value with a quart unit so the 5-qt zone figure alone will not pass.',
  },
  {
    id: 'qa-easy-4',
    concept: 'qa',
    difficulty: 'easy',
    prompt:
      'Which NVIDIA graphics card is in the ASUS ROG Strix G16 165Hz gaming laptop with the Intel Core i9 and 1TB SSD in Eclipse Gray?',
    check: { kind: 'substring', values: ['RTX 5060', 'RTX5060', 'GeForce RTX 5060'] },
    notes:
      "2026-07-08. search_products {query:'asus rog strix g16 gaming laptop', category:'Laptops'} → SKU 6635275 (Model G615JMR-DS94). " +
      'analyze_product 6635275: name "…NVIDIA GeForce RTX 5060- 1TB SSD"; feature "Cutting-edge NVIDIA GeForce RTX 5060 Laptop GPU". ' +
      'Prompt pins the 165Hz/i9/1TB/Eclipse Gray variant to avoid the RTX 5070/5080/5090 Strix siblings (SKUs 6635276/6632087/6632084).',
  },
  {
    id: 'qa-easy-5',
    concept: 'qa',
    difficulty: 'easy',
    prompt:
      'How many megapixels is the sensor on the Canon EOS Rebel T7 DSLR two-lens kit?',
    check: { kind: 'substring', values: ['24.1', '24.1-megapixel', '24.1 megapixel', '24.1MP'] },
    notes:
      "2026-07-08. search_products {query:'canon eos rebel t7'} → SKU 6323759 (two-lens kit, Model 2727C021). " +
      'analyze_product 6323759, feature: "24.1-megapixel CMOS (APS-C) sensor". ' +
      '"24.1" is a distinctive value; the vaguer "24" would risk matching unrelated numbers so the check pins the decimal.',
  },
  {
    id: 'qa-easy-6',
    concept: 'qa',
    difficulty: 'easy',
    prompt:
      'What display panel technology does the Samsung 77" S90D Series 4K smart TV use?',
    check: { kind: 'substring', values: ['OLED'] },
    notes:
      "2026-07-08. search_products {query:'s90d oled', category:'TVs'} → SKU 6578065 (Model QN77S90DAFXZA). " +
      'analyze_product 6578065: name "…S90D Series OLED 4K UHD Smart Tizen TV"; feature "OLED Technology". ' +
      '"OLED" is the defining, non-generic panel fact for this product line (distinct from QLED/LED).',
  },

  // ── MEDIUM ────────────────────────────────────────────────────────────
  {
    id: 'qa-medium-1',
    concept: 'qa',
    difficulty: 'medium',
    prompt:
      'The PlayStation 5 Slim Digital Edition (the one with no disc drive) — how much SSD storage does it have built in?',
    check: { kind: 'substring', values: ['825GB', '825 GB', '825'] },
    notes:
      "2026-07-08. search_products {query:'playstation 5 console'} returns three Slim variants: 1TB (SKU 6646419), " +
      'Digital 825GB (SKU 6646420), and the original 6566039. Disambiguation is the point: the DIGITAL EDITION is ' +
      'the 825GB SKU 6646420 (feature "825GB of Storage"), NOT the 1TB disc model. Wrong variant → "1TB", which fails. ' +
      '"825" is unique to this SKU across the PS5 lineup so it is safe as a lone token.',
  },
  {
    id: 'qa-medium-2',
    concept: 'qa',
    difficulty: 'medium',
    prompt:
      'How many microphones do the Sony WH-1000XM5 headphones use for noise cancelling?',
    check: { kind: 'substring', values: ['8 microphones', '8 mics', 'eight microphones', '8-microphone', '8 mic'] },
    notes:
      "2026-07-08. analyze_product 6505727 (Sony WH-1000XM5, from search {query:'sony wh-1000xm5', category:'Headphones'}). " +
      'Description: "Two processors control 8 microphones for unprecedented noise Cancelling". Buried in the description ' +
      'block, not the name — requires reading detail. Check pins the count WITH a mic noun so a stray "8" (e.g. "8 hours") ' +
      'cannot pass. Note the number-of-processors is a competing "2"; the asked fact is the microphone count.',
  },
  {
    id: 'qa-medium-3',
    concept: 'qa',
    difficulty: 'medium',
    prompt:
      'Besides the two cooking baskets, what accessory is included in the box with the Ninja Foodi XL 2-Basket DualZone air fryer?',
    check: { kind: 'substring', values: ['Smart Thermometer', 'Foodi Smart Thermometer', 'thermometer'] },
    notes:
      "2026-07-08. analyze_product 6512365 (Ninja Foodi DZ550). \"What's in the box\": Air Fryer, Dual 5-qt Cooking " +
      'Baskets, Nonstick Crisper Plates, Foodi Smart Thermometer. The distinctive included accessory is the ' +
      'Smart Thermometer (also cited in the Smart Cook System feature). Derived-from-box-contents fact.',
  },
  {
    id: 'qa-medium-4',
    concept: 'qa',
    difficulty: 'medium',
    prompt:
      'What speed is the DDR5 RAM in the ASUS ROG Strix G16 165Hz gaming laptop (Intel Core i9, RTX 5060, Eclipse Gray)?',
    check: { kind: 'substring', values: ['5600MHz', '5600 MHz', '5600'] },
    notes:
      "2026-07-08. analyze_product 6635275 (ASUS ROG Strix G16, Model G615JMR-DS94). Feature: \"16GB of blazing-fast " +
      'DDR5 5600MHz RAM"; description "16GB DDR5". The clock speed is buried in the RAM feature bullet (a deeper spec ' +
      'than the headline 16GB). "5600" is distinctive here (not the 240Hz/165Hz/GDDR7 numbers). Prompt pins the RTX 5060 ' +
      'variant so a sibling Strix (32GB DDR5, different SKU) is not answered instead.',
  },
  {
    id: 'qa-medium-5',
    concept: 'qa',
    difficulty: 'medium',
    prompt:
      'The Canon EOS Rebel T7 two-lens kit comes with two lenses. What is the telephoto (zoom) lens included?',
    check: { kind: 'substring', values: ['75-300mm', '75-300 mm', '75-300', 'EF 75-300'] },
    notes:
      "2026-07-08. analyze_product 6323759 (Canon EOS Rebel T7 Two Lens Kit, Model 2727C021). Feature/box: " +
      '"EF 75-300mm f/4-5.6 4x telephoto zoom lens"; box lists "EF-S18-55mm… , EF 75-300mm…". Two lenses in the kit; ' +
      'the asked telephoto is the 75-300mm (the 18-55mm is the standard/wide zoom). Check pins 75-300 so the 18-55mm ' +
      'does not satisfy it — tests that the model picks the correct one of the two.',
  },
  {
    id: 'qa-medium-6',
    concept: 'qa',
    difficulty: 'medium',
    prompt:
      'A customer wants a PlayStation 5 Slim that can play physical game discs. Which of the two 2025 Slim models fits — and what pre-installed game does it come with?',
    check: {
      kind: 'allOf',
      checks: [
        { kind: 'substring', values: ['disc drive', 'disc-drive', 'Disc Drive'] },
        { kind: 'substring', values: ["ASTRO's PLAYROOM", 'ASTRO', 'Astro', 'PLAYROOM', 'Playroom'] },
      ],
    },
    notes:
      "2026-07-08. search_products {query:'playstation 5 console'} → 1TB standard SKU 6646419 vs Digital 825GB SKU 6646420. " +
      'The disc-capable one is the 1TB standard (SKU 6646419). analyze_product 6646419 box: "…Disc Drive… ASTRO\u2019s ' +
      'PLAYROOM (Pre-installed game)". The Digital Edition (6646420) has NO disc drive and no pre-installed game, so an ' +
      'answer describing it fails the "disc drive" leg. allOf requires BOTH the disc-drive fact and the ASTRO\u2019s ' +
      'PLAYROOM fact so a half-right or wrong-variant answer cannot pass.',
  },
]
