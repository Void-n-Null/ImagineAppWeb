import { describe, expect, it } from 'vitest'
import type { SpecRow } from './spec-model'
import { editDistance, mergeRanges, searchSpecs } from './spec-search'

function row(label: string, value: string, curated = false): SpecRow {
  return { label, value, curated }
}

const ROWS: SpecRow[] = [
  row('Brand', 'Sony', true),
  row('Model', 'KD55X77L', true),
  row('Width', '48.63 inches', true),
  row('Height', '28.03 inches', true),
  row('Depth', '2.91 inches', true),
  row('Weight', '32.4 pounds', true),
  row('Screen Size', '55 inches'),
  row('Number of HDMI Inputs', '3'),
  row('HDMI Version', '2.1'),
  row('Refresh Rate', '60Hz'),
  row('Voice Assistant Built-in', 'Amazon Alexa, Google Assistant'),
  row('Wireless Connectivity', 'Wi-Fi 5, Bluetooth 4.2'),
  row('Backlight Type', 'Direct LED'),
  row('Warranty (parts)', '1 year', true),
]

function labels(matches: ReturnType<typeof searchSpecs>): string[] {
  return matches.map((m) => m.row.label)
}

describe('searchSpecs', () => {
  it('empty query returns every row in sheet order, unranked', () => {
    const all = searchSpecs(ROWS, '   ')
    expect(labels(all)).toEqual(ROWS.map((r) => r.label))
    expect(all.every((m) => m.score === 0)).toBe(true)
  })

  it('matches keys by substring, word-start first', () => {
    const matches = searchSpecs(ROWS, 'hdmi')
    expect(labels(matches)[0]).toBe('Number of HDMI Inputs')
    expect(labels(matches)).toContain('HDMI Version')
  })

  it('searches values too (the alexa case)', () => {
    const matches = searchSpecs(ROWS, 'alexa')
    expect(labels(matches)).toEqual(['Voice Assistant Built-in'])
    // Highlight lands in the value, not the label.
    expect(matches[0].valueRanges.length).toBeGreaterThan(0)
    expect(matches[0].labelRanges).toEqual([])
  })

  it('"size" aliases to the whole dimension family', () => {
    const matched = labels(searchSpecs(ROWS, 'size'))
    // Direct hit ranks first…
    expect(matched[0]).toBe('Screen Size')
    // …and the alias family rides along.
    for (const dim of ['Width', 'Height', 'Depth']) {
      expect(matched).toContain(dim)
    }
  })

  it('"wifi" finds Wireless Connectivity via alias + value', () => {
    expect(labels(searchSpecs(ROWS, 'wifi'))).toContain('Wireless Connectivity')
  })

  it('"hz" finds Refresh Rate through both alias and value', () => {
    expect(labels(searchSpecs(ROWS, 'hz'))[0]).toBe('Refresh Rate')
  })

  it('tolerates the classic transposition typo ("hieght")', () => {
    expect(labels(searchSpecs(ROWS, 'hieght'))).toContain('Height')
  })

  it('tolerates a dropped letter ("warrenty")', () => {
    expect(labels(searchSpecs(ROWS, 'warrenty'))).toContain('Warranty (parts)')
  })

  it('ANDs multiple tokens, exact compound first', () => {
    const matched = labels(searchSpecs(ROWS, 'hdmi inputs'))
    expect(matched[0]).toBe('Number of HDMI Inputs')
    // "inputs" alias-expands to the port family, so HDMI Version legitimately
    // rides along — but never anything port-less.
    expect(matched).not.toContain('Warranty (parts)')
    expect(matched).not.toContain('Backlight Type')
  })

  it('returns nothing when a token matches nothing', () => {
    expect(searchSpecs(ROWS, 'quantum flux')).toEqual([])
  })

  it('direct label hits outrank alias-only hits', () => {
    const matches = searchSpecs(ROWS, 'width')
    expect(labels(matches)[0]).toBe('Width')
  })
})

describe('editDistance', () => {
  it('counts transpositions as one edit (Damerau)', () => {
    expect(editDistance('hieght', 'height')).toBe(1)
  })
  it('exact match is zero', () => {
    expect(editDistance('hdmi', 'hdmi')).toBe(0)
  })
  it('caps far-apart lengths early', () => {
    expect(editDistance('a', 'abcdef')).toBeGreaterThan(2)
  })
})

describe('mergeRanges', () => {
  it('merges overlaps and keeps disjoint ranges', () => {
    expect(
      mergeRanges([
        [5, 9],
        [0, 3],
        [2, 4],
      ]),
    ).toEqual([
      [0, 4],
      [5, 9],
    ])
  })
})
