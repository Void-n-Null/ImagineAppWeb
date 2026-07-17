import type { BenchQuestion } from '../checks'

/**
 * qa × hard — factual questions about ONE product where the hard part is
 * RESOLVING which product (indirect description or confusing variant family)
 * and/or extracting a deep spec that only surfaces in analyze_product detail.
 * Every answer is an objective spec value verified against live catalog tool
 * output on 2026-07-08. Prices/stock deliberately avoided (volatile).
 */
export const QA_HARD: BenchQuestion[] = [
  {
    id: 'qa-hard-1',
    concept: 'qa',
    difficulty: 'hard',
    prompt:
      "Customer wants the 77-inch version of Sony's BRAVIA 8 OLED (the 2024 one, not the newer II). What's its exact model number?",
    check: { kind: 'substring', values: ['K77XR80'] },
    notes:
      "Resolve: search_products {query:'bravia 8', category:'TVs'} returns three 2024 BRAVIA 8 OLED sizes — 55\" (K55XR80/6578569), 65\" (K65XR80/6578577), 77\" (K77XR80/6578574) — plus the 2025 'BRAVIA 8 II' line. " +
      "Disambiguation: BRAVIA 8 II only ships in 55\" (K55XR80M2) and 65\" (K65XR80M2) — verified via search_products {query:'bravia 8 ii', category:'TVs'} (no 77\" II exists, 2026-07-08). " +
      'So "77-inch BRAVIA 8 OLED" pins exactly ONE product: SKU 6578574. ' +
      'analyze_product {sku:6578574} → "- Model: K77XR80". Model token is distinctive; the "II" decoys (M2 suffix) cannot match. Verified 2026-07-08.',
  },
  {
    id: 'qa-hard-2',
    concept: 'qa',
    difficulty: 'hard',
    prompt:
      'A customer is choosing between the two PlayStation 5 Slim consoles that still have a disc drive. The one with the larger storage — how much SSD storage does it have, and does it include a disc drive?',
    check: {
      kind: 'allOf',
      checks: [
        { kind: 'substring', values: ['1TB', '1 TB'] },
        { kind: 'substring', values: ['disc drive', 'disc'] },
      ],
    },
    notes:
      "Resolve: search_products {query:'playstation 5 console', category:'Video Games'} returns PS5 Slim (6566039), PS5 Slim 1TB (6646419), PS5 Slim Digital 825GB (6646420, NO disc), PS5 Pro (6601524). " +
      'Among disc-drive Slim models the larger-storage one is the 1TB (6646419); the 825GB Digital Edition is disc-less (decoy) and the base Slim is smaller. ' +
      "analyze_product {sku:6646419} → \"## What's in the box … 1TB SSD, Disc Drive\" and feature \"1TB of Storage\". Two-fact answer: storage '1TB' AND presence of a 'disc drive'. Verified 2026-07-08.",
  },
  {
    id: 'qa-hard-3',
    concept: 'qa',
    difficulty: 'hard',
    prompt:
      'Someone wants the newest AirPods Pro — the pair that can track your heart rate during workouts. On a single charge with noise cancelling on, how many hours of listening time does Apple claim?',
    check: { kind: 'substring', values: ['8 hours', '8 hour', 'up to 8'] },
    notes:
      "Resolve: only ONE catalog product is an AirPods with heart-rate sensing — 'Apple - AirPods Pro 3 … with Heart Rate Sensing Feature' (SKU 6376563), surfaced in Headphones search and by name. No other AirPod has heart rate (decoys: AirPods 4, AirPods Pro 2 lineage — none list heart rate). " +
      'analyze_product {sku:6376563} → "EXTENDED BATTERY LIFE—Get up to 8 hours of listening time with Active Noise Cancellation on a single charge." ' +
      "Answer '8 hours' is a deep spec that only appears in analyze_product feature text, not in the name/row. The 10-hour Transparency figure is a different mode, so '8 hours' is the distinctive ANC value. Verified 2026-07-08.",
  },
  {
    id: 'qa-hard-4',
    concept: 'qa',
    difficulty: 'hard',
    prompt:
      'We have two 27-inch Samsung Odyssey OLED G6 gaming monitors on the shelf that look almost identical. On the faster one — the one Samsung markets as the first-ever 500Hz OLED — what is its rated peak brightness in nits?',
    check: { kind: 'substring', values: ['1000-nit', '1000 nit', '1000nit', '1,000 nit'] },
    notes:
      "Resolve: search_products {query:'odyssey oled'} returns two 27\" Odyssey OLED G6 units — 500Hz 'G60SF' (SKU 6635360, Model LS27FG602SNXZA) and 360Hz 'G60SD' (SKU 6573684, Model LS27DG602SNXZA). " +
      "'the first-ever 500Hz OLED' pins the 500Hz one (6635360); the 360Hz G6 is the decoy. " +
      'analyze_product {sku:6635360} → description "VESA DisplayHDR TrueBlack 500 delivers ultra-deep blacks and 1000nits peak brightness" and feature "1000-nit peak brightness". ' +
      "Peak-brightness '1000-nit' is a deep spec buried in analyze_product detail (not in the name); '500Hz' is only the resolver, not the asked answer, so peak-brightness variants are the check. Verified 2026-07-08.",
  },
  {
    id: 'qa-hard-5',
    concept: 'qa',
    difficulty: 'hard',
    prompt:
      "Customer asks about the 15-inch MacBook Air with Apple's M4 chip (not the M2 model). What model number is printed on its box, and how many Thunderbolt ports does it have?",
    check: {
      kind: 'allOf',
      checks: [
        { kind: 'substring', values: ['MW1G3LL/A', 'MW1G3'] },
        { kind: 'substring', values: ['two Thunderbolt', '2 Thunderbolt', 'Thunderbolt 4'] },
      ],
    },
    notes:
      "Resolve: search_products {query:'macbook air 15 m4', category:'Laptops'} returns exactly ONE product — 'MacBook Air 15-inch … Apple M4 chip … 16GB … Silver' (SKU 6565864, Model MW1G3LL/A). The M2 15\" (6534483, Model 3L621LL/A) is the explicit decoy the prompt excludes. " +
      'compare_products {skus:[6534483,6565864]} → for 6565864: "SKU 6565864 | Model MW1G3LL/A" and feature "CONNECT IT ALL—MacBook Air features two Thunderbolt 4 ports…". ' +
      "Two-fact answer: model token 'MW1G3LL/A' AND 'two Thunderbolt 4 ports'. Model number and 'Thunderbolt 4' are distinctive; a wrong M2-model answer (3L621LL/A) fails the model check. Verified 2026-07-08.",
  },
  {
    id: 'qa-hard-6',
    concept: 'qa',
    difficulty: 'hard',
    prompt:
      "For the 49-inch Samsung Odyssey OLED G9 that's specifically the G-Sync Compatible 'G93SD' variant, what refresh rate and response time does it run?",
    check: {
      kind: 'allOf',
      checks: [
        { kind: 'substring', values: ['240Hz', '240 Hz'] },
        { kind: 'substring', values: ['0.03ms', '0.03 ms'] },
      ],
    },
    notes:
      "Resolve: search_products {query:'odyssey oled'} returns multiple 49\" Odyssey OLED G9 units — the 'G93SD' G-Sync Compatible (SKU 6599654, Model LS49DG934SNXGO), a separate 49\" G9 (SKU 6599653, LS49DG956SNXGO), and a 49\" G950 (SKU 6644832). The 'G93SD' code + 'G-Sync Compatible' pins exactly SKU 6599654. " +
      'Row/name for 6599654: "49\" Odyssey OLED G9 (G93SD) Dual-QHD 240Hz 0.03ms G-Sync Compatible". Two-fact answer: refresh \'240Hz\' AND response \'0.03ms\'. ' +
      "Both are distinctive spec values (not bare digits); the other 49\" G9 decoys share 240Hz but the G93SD code disambiguates which single unit is meant. Verified 2026-07-08.",
  },
]
