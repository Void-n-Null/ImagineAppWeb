import type { BenchQuestion } from '../checks'

/**
 * compare × hard — the hardest cell to keep objective.
 *
 * Every question forces: find the products (from vague-but-unambiguous
 * descriptions), pull detailed specs (via analyze_product / compare_products
 * on EACH), and derive the SINGLE winner from a conjunction of measurable
 * facts. No taste, no "best" — the constraints leave exactly one candidate,
 * verified against the live catalog on 2026-07-08.
 *
 * CHECK DESIGN NOTE (false-positive trap): in a comparison, every product's
 * name/SKU gets mentioned, and compare_products renders a [Compare(a,b,c)]
 * card that literally contains every SKU as raw digits. A `sku` check would
 * therefore pass on ANY answer that shows the card, correct or not. So the
 * winner is keyed on a token UNIQUE TO THE WINNER — its model number and/or
 * the deciding spec value — never a bare SKU that also appears on a loser or
 * in the compare card.
 */
export const COMPARE_HARD: BenchQuestion[] = [
  {
    id: 'compare-hard-1',
    concept: 'compare',
    difficulty: 'hard',
    prompt:
      "A customer editing on the go wants a MacBook Pro with a Pro-tier chip, and they specifically need Thunderbolt 5 ports for a fast external SSD. They're weighing three: the 14-inch M4 Pro (24GB/512GB, Silver), the 16-inch M4 Pro (24GB/512GB, Silver), and the 13-inch MacBook Air M5 (16GB/512GB, Sky Blue). Which one actually has Thunderbolt 5?",
    check: {
      kind: 'anyOf',
      checks: [
        { kind: 'substring', values: ['MX2T3LL/A'] },
        { kind: 'substring', values: ['Thunderbolt 5'] },
      ],
    },
    notes:
      "Verified 2026-07-08. search_products {query:'macbook pro', category:'Laptops', limit:10} returns the trio: 14\" M4 Pro Silver (SKU 6602745, Model MX2E3LL/A), 16\" M4 Pro Silver (SKU 6602751, Model MX2T3LL/A), 13\" Air M5 Sky Blue (SKU 6455385, Model MDHH4LL/A) — all 'sold in stores + online'. compare_products {skus:[6602745,6602751,6455385]} feature text is decisive: the 16\" (6602751) lists 'three Thunderbolt 5 ports'; the 14\" (6602745) lists 'three Thunderbolt 4 ports'; the Air (6455385) lists 'two Thunderbolt 4 ports'. Exactly ONE has Thunderbolt 5 → the 16\" M4 Pro, Model MX2T3LL/A. Chip+size alone can't pick it (14\" and 16\" are both M4 Pro); the Thunderbolt-5 spec is the sole discriminator, forcing a detail read on each. Check keys on the winner's unique model number OR the deciding spec 'Thunderbolt 5' (which only the winner advertises). A bare SKU 6602751 is deliberately NOT used: the [Compare(6602745,6602751,6455385)] card contains that digit string regardless of the answer.",
  },
  {
    id: 'compare-hard-2',
    concept: 'compare',
    difficulty: 'hard',
    prompt:
      'A customer wants over-ear wireless headphones to pair with their phone over Bluetooth for active noise cancelling on the train. Between the Sony WH-1000XM5 and the Sony WHRF400, which one actually fits what they need?',
    check: {
      kind: 'substring',
      values: ['WH-1000XM5', 'WH1000XM5'],
    },
    notes:
      "Verified 2026-07-08. search_products {query:'sony wireless headphones', category:'Headphones'} returns both: WH-1000XM5 (SKU 6505727, Model WH1000XM5/B) and WHRF400 (SKU 6267219, Model WHRF400). analyze_product {sku:6267219} (WHRF400) explicitly states in Key features: 'Does not support Bluetooth' and '*Does not offer a digital audio connection to your TV (no HDMI, no optical)' — it is an RF home-theater headphone with a transmitter dock, no Bluetooth and no noise cancelling. The WH-1000XM5 name/product is 'Wireless Noise Cancelling Over-the-Ear' and is a Bluetooth headphone. Only the XM5 satisfies BOTH constraints (Bluetooth pairing to a phone AND noise cancelling). Objectively one answer: the WH-1000XM5. Winner token 'WH-1000XM5'/'WH1000XM5' is unique to the winner; the loser is 'WHRF400', which does not contain either substring. Adversarial: an answer recommending the WHRF400 names 'WHRF400', not the XM5 model.",
  },
  {
    id: 'compare-hard-3',
    concept: 'compare',
    difficulty: 'hard',
    prompt:
      "A customer wants a 65-inch Samsung TV mainly for gaming — they care about the highest refresh rate for VRR. They're looking at three 65\" Samsungs: the S90F OLED, the Q7F QLED, and the U8000F Crystal UHD. Which one's specs support 4K 144Hz gaming?",
    check: {
      kind: 'anyOf',
      checks: [
        { kind: 'substring', values: ['QN65S90FAFXZA'] },
        { kind: 'substring', values: ['S90F'] },
      ],
    },
    notes:
      "Verified 2026-07-08. search_products {category:'TVs', screen_size_min:63, screen_size_max:67, manufacturer:'Samsung'} returns all three 65\" sets: S90F OLED (SKU 6613491, Model QN65S90FAFXZA), Q7F QLED (SKU 6619254, Model QN65Q7FAAFXZA), U8000F Crystal UHD (SKU 6619249, Model UN65U8000FFXZA) — all 'sold in stores + online'. analyze_product decides it: S90F (6613491) 'Motion Xcelerator Turbo Ultra ... supports VRR games at up to 4K 144Hz'; Q7F (6619254) 'Motion Xcelerator ... supports up to 4K 60Hz'; U8000F (6619249) 'Motion Xcelerator ... supports up to 4K 60 frames per second'. Exactly ONE reaches 144Hz → the S90F OLED. Panel-type/name look-alikes (OLED vs QLED vs Crystal UHD) make it easy to conflate, so the model must read each spec. Winner keyed on 'S90F'/'QN65S90FAFXZA', unique to the winner (losers name Q7F / U8000F). '144Hz' alone was rejected as the sole key — a wrong answer could cite '60Hz vs 144Hz' while recommending the cheaper Q7F, which would false-positive on a raw '144Hz' substring.",
  },
  {
    id: 'compare-hard-4',
    concept: 'compare',
    difficulty: 'hard',
    prompt:
      'A customer wants an 11-inch iPad with the M-series chip (not the base A-series) AND at least 256GB of storage. Between the base iPad with the A16 chip (128GB), the iPad Air M3 (128GB), and the iPad Air M3 (256GB), which is the only one that meets both requirements? Tell me its exact manufacturer model number so I can pull it from the back.',
    check: {
      kind: 'substring',
      values: ['MCA34LL/A'],
    },
    notes:
      "Verified 2026-07-08. search_products {query:'ipad', category:'Tablets'} returns the trio: base iPad A16 128GB (SKU 6578266, Model MD3Y4LL/A), iPad Air M3 128GB (SKU 6578281, Model MC9X4LL/A), iPad Air M3 256GB (SKU 6578286, Model MCA34LL/A). analyze_product {sku:6578286} confirms 'iPad Air M3 chip ... 256GB', Model MCA34LL/A, 'sold in stores + online'. Requirement conjunction (M3 chip AND >=256GB): base iPad = A16 (fails chip); Air 128GB = M3 but 128GB (fails storage); Air 256GB = M3 AND 256GB → PASSES. Exactly one. The two Airs share the M3 chip and even the Blue color, so storage is the tie-break — reading each spec is required. Winner keyed on model MCA34LL/A (unique; loser Airs are MC9X4LL/A / MD3Y4LL/A). Bare SKU 6578286 avoided due to compare-card digit pollution.",
  },
  {
    id: 'compare-hard-5',
    concept: 'compare',
    difficulty: 'hard',
    prompt:
      "A customer wants a top-end ASUS ROG gaming laptop with the strongest GPU AND the most memory. They've narrowed it to three: the ROG Strix SCAR 16 (RTX 5090, 32GB RAM), the ROG Zephyrus G16 with the RTX 5090 (64GB RAM), and the ROG Zephyrus G16 with the RTX 5080 (64GB RAM). Which is the only one that has BOTH an RTX 5090 and 64GB of RAM? Give me its exact manufacturer model number so I can look it up in inventory.",
    check: {
      kind: 'substring',
      values: ['GU605CX-XS98'],
    },
    notes:
      "Verified 2026-07-08. search_products {query:'asus rog gaming laptop', category:'Laptops'} returns the trio: Strix SCAR 16 — RTX 5090 / 32GB (SKU 6632084, Model G635LX-XS97, 'sold in stores + online'); Zephyrus G16 — RTX 5090 / 64GB (SKU 6629711, Model GU605CX-XS98, 'sold in stores + online'); Zephyrus G16 — RTX 5070Ti/5080 line, this one RTX 5080 / 64GB (SKU 6629713, Model GU605CW-XS98, 'sold in stores + online'). Names carry the full spec. Conjunction (RTX 5090 AND 64GB): SCAR = 5090 but 32GB (fails RAM); G16 5080 = 64GB but 5080 (fails GPU); G16 5090 64GB → PASSES both. Exactly one. The two Zephyrus G16 'Platinum White' entries are near-identical strings differing only by GPU/RAM and by model suffix CX vs CW, so the model number is the safe unique key: winner GU605CX-XS98 does NOT substring-match loser GU605CW-XS98 (CX vs CW) nor G635LX-XS97. '5090' or '64GB' alone were rejected — each appears on a losing config too, so neither uniquely identifies the winner.",
  },
  {
    id: 'compare-hard-6',
    concept: 'compare',
    difficulty: 'hard',
    prompt:
      'A customer wants one wall charger that can charge four devices at once and still deliver at least 45 watts total. Between the Anker Zolo GaN charger, the Anker Nano II 45W, and the Anker 20W wall charger, which is the only one that satisfies both?',
    check: {
      kind: 'anyOf',
      checks: [
        { kind: 'substring', values: ['A121EJ21-1'] },
        { kind: 'substring', values: ['Zolo'] },
      ],
    },
    notes:
      "Verified 2026-07-08. search_products {query:'anker usb-c charger', category:'Chargers'} returns the trio: Anker Zolo GaN Wall Charger '50W, 4 Ports, 2 USB-C + 2 USB-A' (SKU 6668753, Model A121EJ21-1); Anker Nano II 45W single-port (SKU 6455885, Model A2664J11-1); Anker 20W Wall Charger single-port (SKU 6587878, Model A2654J21-1) — all 'sold in stores + online'. analyze_product {sku:6668753} confirms the Zolo has 4 ports (2 USB-C + 2 USB-A) with 50W max output. Conjunction (>=45W AND 4 ports): Nano II = 45W but single port (fails port count); 20W = single port and <45W (fails both); Zolo = 50W AND 4 ports → PASSES. Exactly one. Winner keyed on the unique 'Zolo' name and model A121EJ21-1 (the other two are plain 'Nano II' / '20W Wall Charger', not 'Zolo'). '50W' alone rejected: a wrong answer could mention the Zolo's 50W while steering the customer to a cheaper single-port unit.",
  },
]
