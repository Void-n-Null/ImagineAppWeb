import type { BenchQuestion } from '../checks'

/**
 * compare / easy + medium — objective product-vs-product questions.
 *
 * Design contract (product owner, strict):
 *  - Prompts name products the way a floor employee reads them off a shelf tag
 *    (full marketing names, never SKUs). Both/all named products are verified
 *    findable via search_products.
 *  - EASY: the deciding spec is directly visible in ONE compare_products call
 *    (a labeled field like Rating, or plainly in the aligned name/feature text).
 *  - MEDIUM: needs a three-way compare + ranking, a fact only analyze_product
 *    surfaces (e.g. "What's in the box", which compare_products omits), or a
 *    two-spec combination.
 *  - False-positive discipline: in a compare answer BOTH products are almost
 *    always MENTIONED, so a shared name substring is never a valid check. Every
 *    check below keys on a token that belongs ONLY to the winner — a unique
 *    winning spec VALUE ("512GB", "10-qt", "5090", "240Hz", "4.8", "30 hour")
 *    that the loser's block does not contain, so a wrong pick cannot emit it.
 *
 * All evidence gathered 2026-07-08 via
 *   bun --preload ./scripts/bench/preload.ts scripts/bench/tool-cli.ts <tool> <json>
 * against the live Best Buy catalog (same tool impls the benched models see).
 */

export const COMPARE_EASY_MEDIUM: BenchQuestion[] = [
  // ---------------------------------------------------------------- EASY ----
  {
    id: 'compare-easy-1',
    concept: 'compare',
    difficulty: 'easy',
    prompt:
      "A customer is torn between the MacBook Air 15\" with the M2 chip and the 13-inch MacBook Air with the M4 chip. Which one has more SSD storage?",
    // Winner: M4 13" = 512GB SSD (SKU 6571026). Loser: M2 15" = 256GB (6534483).
    // "512GB" appears ONLY in the winner's name; the M2 block never mentions it
    // (its feature text tops out at "up to 24GB of unified memory" — a RAM figure,
    // not storage — so no 512 leak). A wrong pick states "256GB".
    check: {
      kind: 'substring',
      values: ['512GB', '512 GB', '512gb'],
    },
    notes:
      'search_products {"query":"macbook air","category":"Laptops","limit":8} (2026-07-08) → M2 15" 256GB SSD = SKU 6534483 ($1069, online only); M4 13" 512GB SSD = SKU 6571026 ($1199, online only), both findable. compare_products {"skus":[6534483,6571026]} → §1 name "…8GB Memory - 256GB SSD…", §2 name "…16GB Memory - 512GB SSD…"; "512GB" present only in §2 (winner). Storage is a large, stable tier gap; deciding value is unique to the winner.',
  },
  {
    id: 'compare-easy-2',
    concept: 'compare',
    difficulty: 'easy',
    prompt:
      'Customer wants the 11-inch iPad Air (M3) and is deciding between the 128GB Wi-Fi model and the 256GB Wi-Fi model. Which gives them more storage?',
    // Winner: 256GB (SKU 6578286). Loser: 128GB (6578281). Names are identical
    // except the storage token; "256GB" appears only in the winner's name/block.
    check: {
      kind: 'substring',
      values: ['256GB', '256 GB', '256gb'],
    },
    notes:
      'search_products {"query":"ipad air","category":"Tablets"} (2026-07-08) → 11" M3 128GB = SKU 6578281 ($499, in stores+online); 256GB = SKU 6578286 ($599, in stores+online). compare_products {"skus":[6578281,6578286]} → §1 "…Wi-Fi 128GB", §2 "…Wi-Fi 256GB"; feature text is identical between them, "256GB" occurs only in §2. Loser block never emits 256.',
  },
  {
    id: 'compare-easy-3',
    concept: 'compare',
    difficulty: 'easy',
    prompt:
      'Between the Sony WH-1000XM5 and the Bose QuietComfort over-ear headphones, which pair has the longer rated battery life?',
    // Winner: Sony XM5 = "up to 30 hours" (SKU 6505727). Loser: Bose QC =
    // "up to 24 hours" (6554461). Both battery figures are in the compare
    // feature text (directly visible = easy). "30 hour(s)" appears only in the
    // Sony block; Bose says 24. A wrong pick emits "24 hours", not "30".
    check: {
      kind: 'substring',
      values: ['30 hour', '30-hour', '30 hrs', '30hr'],
    },
    notes:
      'search_products {"query":"sony wh-1000","category":"Headphones"} → XM5 Black = SKU 6505727; {"query":"bose quietcomfort","category":"Headphones"} → QC Black = SKU 6554461; both findable. compare_products {"skus":[6505727,6554461]} (2026-07-08) → Sony feature "…up to 30 hours of battery life…"; Bose feature "…up to 24 hours* on a single charge…". 30 vs 24 is a stable spec-sheet gap; "30 hour" is unique to the winner.',
  },
  {
    id: 'compare-easy-4',
    concept: 'compare',
    difficulty: 'easy',
    prompt:
      'For a big family, which holds more food: the Ninja Foodi 8-qt. 2-Basket DualZone air fryer or the Ninja Foodi 10-qt. XL 2-Basket DualZone air fryer?',
    // Winner: 10-qt XL (SKU 6512365). Loser: 8-qt (6421833). Capacity is in the
    // name and repeated in feature text. "10-qt"/"10 quart" belongs only to the
    // winner; loser block says 8-qt / 4-qt zones. A wrong pick emits "8-qt".
    check: {
      kind: 'substring',
      values: ['10-qt', '10 qt', '10-quart', '10 quart', '10qt'],
    },
    notes:
      'search_products {"query":"ninja air fryer"} (2026-07-08) → 8-qt DualZone = SKU 6421833 (Model DZ201); 10-qt XL DualZone = SKU 6512365 (Model DZ550); both in stores+online, findable. compare_products {"skus":[6421833,6512365]} → §1 name "…8-qt. 2-Basket…", §2 name "…10-qt. XL 2-Basket…". "10-qt" occurs only in the winner (§2); the 8-qt block only ever says 8-qt / 4-qt.',
  },
  {
    id: 'compare-easy-5',
    concept: 'compare',
    difficulty: 'easy',
    prompt:
      'A gamer is comparing the ASUS ROG Strix SCAR 16 (240Hz panel) with the ASUS ROG Strix G16 (165Hz panel). Which laptop has the higher display refresh rate?',
    // Winner: SCAR 16 = 240Hz (SKU 6632084). Loser: G16 = 165Hz (6635275).
    // Refresh rate is printed in each name; "240Hz" belongs only to the winner.
    check: {
      kind: 'substring',
      values: ['240Hz', '240 Hz', '240hz'],
    },
    notes:
      'search_products {"query":"asus rog strix","category":"Laptops"} (2026-07-08) → SCAR 16 "…2.5K 240Hz…RTX 5090…" = SKU 6632084 (in stores+online); G16 "…FHD+ 165Hz…RTX 5060…" = SKU 6635275 (in stores+online); both findable. compare_products {"skus":[6632084,6635275]} confirms §1 name carries 240Hz, §3/other carries 165Hz. "240Hz" is unique to the winner; a wrong pick states 165Hz.',
  },
  {
    id: 'compare-easy-6',
    concept: 'compare',
    difficulty: 'easy',
    prompt:
      'Which has the higher customer review rating on Best Buy: the Sony WH-1000XM5 or the Bose QuietComfort over-ear headphones?',
    // Winner: Bose QC = 4.8/5 (SKU 6554461). Loser: Sony XM5 = 4.6/5 (6505727).
    // Rating is a labeled field in compare_products. "4.8" belongs only to the
    // winner; the Sony block shows 4.6. A wrong pick emits "4.6".
    check: {
      kind: 'substring',
      values: ['4.8'],
    },
    notes:
      'compare_products {"skus":[6505727,6554461]} (2026-07-08) → Sony XM5 "Rating: 4.6/5 (6399 reviews)"; Bose QC "Rating: 4.8/5 (3666 reviews)". Both findable (see compare-easy-3). Rating is directly rendered by compare_products. "4.8" appears only in the Bose block; 4.6 vs 4.8 has held across repeated pulls. Winner value is unique.',
  },

  // -------------------------------------------------------------- MEDIUM ----
  {
    id: 'compare-medium-1',
    concept: 'compare',
    difficulty: 'medium',
    prompt:
      'A customer is choosing among three Ninja air fryers: the Foodi 8-qt. 2-Basket DualZone, the Foodi 10-qt. XL 2-Basket DualZone, and the Air Fryer Pro XL with 6.5 QT capacity. Which one has the largest total capacity?',
    // Three-way ranking: 10 > 8 > 6.5. Winner: 10-qt XL (6512365). The model must
    // read/compare three capacity values, not just pick between two. "10-qt" is
    // unique to the winner; the other two blocks say 8-qt and 6.5-QT.
    check: {
      kind: 'substring',
      values: ['10-qt', '10 qt', '10-quart', '10 quart', '10qt'],
    },
    notes:
      'compare_products {"skus":[6421833,6512365,6570528]} (2026-07-08) → §1 "…8-qt. 2-Basket…" (DZ201), §2 "…10-qt. XL…" (DZ550), §3 "Air Fryer Pro XL 6-in-1 with 6.5 QT Capacity" (AF181). All three findable via search_products {"query":"ninja air fryer"}; all in stores+online. Largest = 10-qt (unique token, appears only in §2). Requires ranking three numbers, so medium.',
  },
  {
    id: 'compare-medium-2',
    concept: 'compare',
    difficulty: 'medium',
    prompt:
      'Which of these three ASUS ROG gaming laptops has the most powerful NVIDIA GeForce GPU — the ROG Strix SCAR 16, the ROG Strix G16 (2025) Nebula model, or the ROG Strix G16 FHD+ model?',
    // Three-way GPU ranking: RTX 5090 > 5070 > 5060. Winner: SCAR 16 (6632084)
    // with the RTX 5090. "5090" appears only in the winner's block; the other two
    // carry 5070 and 5060. Requires knowing 5090 > 5070 > 5060 across three items.
    check: {
      kind: 'substring',
      values: ['5090'],
    },
    notes:
      'compare_products {"skus":[6632084,6635276,6635275]} (2026-07-08) → §1 SCAR 16 "…NVIDIA GeForce RTX 5090…" (SKU 6632084, in stores+online), §2 G16 2025 Nebula "…RTX 5070…" (6635276), §3 G16 FHD+ "…RTX 5060…" (6635275, in stores+online). All three surfaced by search_products {"query":"asus rog strix","category":"Laptops"}. Winner = RTX 5090; "5090" is unique to §1. Two of the three share 32GB RAM (a RAM question would tie), so the objective single winner is the GPU tier.',
  },
  {
    id: 'compare-medium-3',
    concept: 'compare',
    difficulty: 'medium',
    prompt:
      'A customer wants the most storage in an 11-inch iPad Air (M3, Wi-Fi). Between the 128GB, the 256GB, and the 512GB models, which should they get?',
    // Three-way storage ranking: 512 > 256 > 128. Winner: 512GB (6578289).
    // "512GB" appears only in the winner's name; the other two blocks say 128/256.
    check: {
      kind: 'substring',
      values: ['512GB', '512 GB', '512gb'],
    },
    notes:
      'search_products {"query":"ipad air","category":"Tablets"} + {"query":"ipad air 512gb","category":"Tablets"} (2026-07-08) → 11" M3 128GB = SKU 6578281 (in stores+online), 256GB = 6578286 (in stores+online), 512GB Space Gray = 6578289 ($849, in stores+online); all findable. compare_products {"skus":[6578281,6578286,6578289]} would align the three names; max = 512GB (unique token). Requires ranking three tiers, so medium.',
  },
  {
    id: 'compare-medium-4',
    concept: 'compare',
    difficulty: 'medium',
    prompt:
      "Between the Ninja Foodi 8-qt. 2-Basket DualZone air fryer and the Ninja Foodi 10-qt. XL 2-Basket DualZone air fryer, which one comes with a cooking thermometer in the box?",
    // Box contents are NOT in compare_products — the model must run analyze_product
    // on each. Winner: 10-qt XL (DZ550, 6512365) — box includes "Foodi Smart
    // Thermometer". Loser: 8-qt (DZ201, 6421833) — box has no thermometer, only
    // recipes. Robust check: require the word "thermometer" AND a winner-unique
    // capacity/model token, so an answer must attribute the thermometer to the
    // 10-qt to pass.
    check: {
      kind: 'allOf',
      checks: [
        { kind: 'substring', values: ['thermometer'] },
        {
          kind: 'substring',
          values: ['10-qt', '10 qt', '10-quart', '10 quart', 'dz550'],
        },
      ],
    },
    notes:
      'analyze_product {"sku":6512365} (2026-07-08) → "## What\'s in the box" lists "Foodi Smart Thermometer". analyze_product {"sku":6421833} → box lists only main unit, baskets, crisper plates, "15 chef-inspired recipes" — NO thermometer. compare_products omits box contents entirely, so the differentiator requires analyze_product on both = medium. Both findable via search_products {"query":"ninja air fryer"}; both in stores+online. Winner uniquely holds the "thermometer" fact; check pairs it with the winner\'s 10-qt/DZ550 token.',
  },
  {
    id: 'compare-medium-5',
    concept: 'compare',
    difficulty: 'medium',
    prompt:
      'A gamer wants the single most capable machine of these two ASUS ROG laptops overall — the ROG Strix SCAR 16 and the ROG Strix G16 FHD+ model. Which one has BOTH the faster display and the stronger GPU?',
    // Two-spec combination: the SCAR 16 (6632084) wins on refresh (240Hz > 165Hz)
    // AND GPU (RTX 5090 > 5060). A correct answer must cite the winner's two unique
    // tokens; the loser carries 165Hz + 5060. allOf(5090, 240Hz) can only be
    // satisfied by naming the winner — the loser's values never co-occur.
    check: {
      kind: 'allOf',
      checks: [
        { kind: 'substring', values: ['5090'] },
        { kind: 'substring', values: ['240Hz', '240 Hz', '240hz'] },
      ],
    },
    notes:
      'compare_products {"skus":[6632084,6635275]} (2026-07-08) → SCAR 16 name "…2.5K 240Hz…RTX 5090…" (SKU 6632084, in stores+online) vs G16 "…FHD+ 165Hz…RTX 5060…" (SKU 6635275, in stores+online). Both findable via search_products {"query":"asus rog strix","category":"Laptops"}. Winner = SCAR on both axes; "5090" and "240Hz" are each unique to the winner and only co-occur when the SCAR is named, defeating the both-mentioned trap. Requires combining two specs = medium.',
  },
]
