/**
 * Aggregate benchmark question set. Each file under questions/ is owned by
 * the cell(s) named in its filename; this module just concatenates them.
 */

import type { BenchQuestion } from './checks'
import { COMPARE_EASY_MEDIUM } from './questions/compare-easy-medium'
import { COMPARE_HARD } from './questions/compare-hard'
import { QA_EASY_MEDIUM } from './questions/qa-easy-medium'
import { QA_HARD } from './questions/qa-hard'
import { SEARCH_EASY_MEDIUM } from './questions/search-easy-medium'
import { SEARCH_HARD } from './questions/search-hard'

export const QUESTIONS: BenchQuestion[] = [
  ...SEARCH_EASY_MEDIUM,
  ...SEARCH_HARD,
  ...COMPARE_EASY_MEDIUM,
  ...COMPARE_HARD,
  ...QA_EASY_MEDIUM,
  ...QA_HARD,
]
