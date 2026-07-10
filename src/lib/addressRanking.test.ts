// Tests for the fuzzy address re-ranking used to reorder adressevaelger
// candidates (which the server orders by postal code, not relevance) against the
// user's raw query text — covering tokenization, scoring, ranking and detection
// of query detail the candidate titel doesn't account for.
import { describe, expect, it } from 'vitest'

import {
  hasUnmatchedQueryTokens,
  rankAddressResults,
  scoreAddress,
  tokenize,
  tokenMatchScore,
} from './addressRanking'

/** The 10 real "Askevænget 9" building results in server (postal-code) order. */
const askevaengetBuildings = [
  'Askevænget 9, 2830 Virum',
  'Askevænget 9, 4550 Asnæs',
  'Askevænget 9, Bøged Strand, 4720 Præstø',
  'Askevænget 9, Sdr Vedby, 4800 Nykøbing F',
  'Askevænget 9, Thurø, 5700 Svendborg',
  'Askevænget 9, Espe, 5750 Ringe',
  'Askevænget 9, 5800 Nyborg',
  'Askevænget 9, 5884 Gudme',
  'Askevænget 9, Taulov, 7000 Fredericia',
  'Askevænget 9, 7100 Vejle',
].map((titel) => ({ titel }))

/** The 9 Vejle unit (floor+door) results, in server order. */
const vejleUnits = [
  'Askevænget 9, st. tv, 7100 Vejle',
  'Askevænget 9, st. mf, 7100 Vejle',
  'Askevænget 9, st. th, 7100 Vejle',
  'Askevænget 9, 1. tv, 7100 Vejle',
  'Askevænget 9, 1. mf, 7100 Vejle',
  'Askevænget 9, 1. th, 7100 Vejle',
  'Askevænget 9, 2. tv, 7100 Vejle',
  'Askevænget 9, 2. mf, 7100 Vejle',
  'Askevænget 9, 2. th, 7100 Vejle',
].map((titel) => ({ titel }))

describe('tokenize', () => {
  it('lowercases and splits on whitespace, commas and periods', () => {
    expect(tokenize('Askevænget 9, 2. tv, 7100 Vejle')).toEqual([
      'askevænget',
      '9',
      '2',
      'tv',
      '7100',
      'vejle',
    ])
  })

  it('turns "st. tv" into two tokens and "2." into one', () => {
    expect(tokenize('st. tv')).toEqual(['st', 'tv'])
    expect(tokenize('2.')).toEqual(['2'])
  })

  it('preserves Danish letters and house-number suffixes like "9A"', () => {
    expect(tokenize('Bøgevej 9A, 6800 Varde')).toEqual([
      'bøgevej',
      '9a',
      '6800',
      'varde',
    ])
  })

  it('collapses repeated whitespace and drops empty tokens', () => {
    expect(tokenize('  Askevænget    9  ')).toEqual(['askevænget', '9'])
    expect(tokenize('')).toEqual([])
  })
})

describe('tokenMatchScore', () => {
  it('scores exact matches as 1.0', () => {
    expect(tokenMatchScore('vejle', 'vejle')).toBe(1)
  })

  it('gives partial, coverage-growing credit for prefix matches', () => {
    // titel token starts with query token
    expect(tokenMatchScore('askevæng', 'askevænget')).toBeGreaterThan(0.5)
    expect(tokenMatchScore('askevæng', 'askevænget')).toBeLessThan(1)
    // a longer shared prefix earns more credit
    expect(tokenMatchScore('askevænge', 'askevænget')).toBeGreaterThan(
      tokenMatchScore('aske', 'askevænget'),
    )
  })

  it('is directional: query "9" matches titel "90", but not vice versa', () => {
    expect(tokenMatchScore('9', '90')).toBeGreaterThan(0)
    expect(tokenMatchScore('90', '9')).toBe(0)
  })

  it('scores unrelated tokens as 0', () => {
    expect(tokenMatchScore('vejle', 'virum')).toBe(0)
  })

  it('folds Danish letters so aa/ae/oe typing matches å/æ/ø titles', () => {
    expect(tokenMatchScore('brogaardsvej', 'brogårdsvej')).toBe(1)
    expect(tokenMatchScore('brogå', 'brogaardsvej')).toBeGreaterThan(0)
    expect(tokenMatchScore('askevaenget', 'askevænget')).toBe(1)
    expect(tokenMatchScore('soender', 'sønder')).toBe(1)
  })

  it('never lets a single digit prefix-match a 4-digit postal code', () => {
    // "2" after an address is a floor, not the start of postal code 2830
    expect(tokenMatchScore('2', '2830')).toBe(0)
    // two or more digits still narrow postal codes progressively
    expect(tokenMatchScore('28', '2830')).toBeGreaterThan(0)
    expect(tokenMatchScore('283', '2830')).toBeGreaterThan(0)
    // exact floors and house numbers are unaffected
    expect(tokenMatchScore('2', '2')).toBe(1)
    expect(tokenMatchScore('9', '9A')).toBeGreaterThan(0)
  })
})

describe('scoreAddress', () => {
  it('ranks a full-coverage titel above a partial one', () => {
    expect(
      scoreAddress('Askevænget 9 Vejle', 'Askevænget 9, 7100 Vejle'),
    ).toBeGreaterThan(
      scoreAddress('Askevænget 9 Vejle', 'Askevænget 9, 2830 Virum'),
    )
  })

  it('prefers the shorter/more-exact titel among equal query matches', () => {
    // same query coverage (both fully match "Askevænget 9"), so titel coverage decides
    expect(
      scoreAddress('Askevænget 9', 'Askevænget 9, 2830 Virum'),
    ).toBeGreaterThan(
      scoreAddress('Askevænget 9', 'Askevænget 9, st. tv, 2830 Virum'),
    )
  })
})

describe('rankAddressResults', () => {
  it('ranks the Vejle building first for "Askevænget 9 Vejle" (server had it last)', () => {
    const ranked = rankAddressResults(
      'Askevænget 9 Vejle',
      askevaengetBuildings,
    )
    expect(ranked[0]?.titel).toBe('Askevænget 9, 7100 Vejle')
  })

  it('ranks the exact floor+door unit first for "Askevænget 9, 2. tv Vejle"', () => {
    const mixed = [...askevaengetBuildings, ...vejleUnits]
    const ranked = rankAddressResults('Askevænget 9, 2. tv Vejle', mixed)
    expect(ranked[0]?.titel).toBe('Askevænget 9, 2. tv, 7100 Vejle')
  })

  it('ranks floor-2 units above the building for "Askevænget 9, 2."', () => {
    const ranked = rankAddressResults('Askevænget 9, 2.', [
      { titel: 'Askevænget 9, 2830 Virum' },
      { titel: 'Askevænget 9, st. tv, 2830 Virum' },
      { titel: 'Askevænget 9, 2. tv, 2830 Virum' },
      { titel: 'Askevænget 9, 2. th, 2830 Virum' },
    ])
    expect(ranked[0]?.titel).toBe('Askevænget 9, 2. tv, 2830 Virum')
    expect(ranked[1]?.titel).toBe('Askevænget 9, 2. th, 2830 Virum')
  })

  it('ranks the plain building above its own units for "Askevænget 9"', () => {
    const ranked = rankAddressResults('Askevænget 9', [
      { titel: 'Askevænget 9, st. tv, 2830 Virum' },
      { titel: 'Askevænget 9, 2830 Virum' },
    ])
    expect(ranked[0]?.titel).toBe('Askevænget 9, 2830 Virum')
  })

  it('ranks a plain postal-code titel above one with a supplementary city name', () => {
    const ranked = rankAddressResults('Askevænget 9', [
      { titel: 'Askevænget 9, Sdr Vedby, 4800 Nykøbing F' },
      { titel: 'Askevænget 9, 4550 Asnæs' },
    ])
    expect(ranked[0]?.titel).toBe('Askevænget 9, 4550 Asnæs')
  })

  it('does not let titel token "9" prefix-match query token "90"', () => {
    const ranked = rankAddressResults('Askevænget 90', [
      { titel: 'Askevænget 9, 2830 Virum' },
      { titel: 'Askevænget 90, 2830 Virum' },
    ])
    expect(ranked[0]?.titel).toBe('Askevænget 90, 2830 Virum')
    // the "9" building must not fully satisfy the "90" query
    expect(
      scoreAddress('Askevænget 90', 'Askevænget 90, 2830 Virum'),
    ).toBeGreaterThan(scoreAddress('Askevænget 90', 'Askevænget 9, 2830 Virum'))
  })

  it('is case-insensitive', () => {
    const ranked = rankAddressResults(
      'ASKEVÆNGET 9 vejle',
      askevaengetBuildings,
    )
    expect(ranked[0]?.titel).toBe('Askevænget 9, 7100 Vejle')
  })

  it('keeps server order for an empty query', () => {
    const ranked = rankAddressResults('', askevaengetBuildings)
    expect(ranked.map((r) => r.titel)).toEqual(
      askevaengetBuildings.map((r) => r.titel),
    )
  })

  it('tie-breaks equal scores on the same street by house number like DAWA', () => {
    // A street-only query scores every candidate equally; DAWA spreads the
    // low house numbers across postal areas instead of dumping one postal
    // code's whole street first.
    const ranked = rankAddressResults('Askevænget', [
      { titel: 'Askevænget 12, 2830 Virum' },
      { titel: 'Askevænget 1, 7100 Vejle' },
      { titel: 'Askevænget 3, 4550 Asnæs' },
      { titel: 'Askevænget 1, 2830 Virum' },
    ])
    expect(ranked.map((r) => r.titel)).toEqual([
      'Askevænget 1, 2830 Virum',
      'Askevænget 1, 7100 Vejle',
      'Askevænget 3, 4550 Asnæs',
      'Askevænget 12, 2830 Virum',
    ])
  })

  it('tie-breaks same-street units by floor then door in DAWA order', () => {
    const ranked = rankAddressResults('Askevænget 9', [
      { titel: 'Askevænget 9, 1. th, 2830 Virum' },
      { titel: 'Askevænget 9, st. th, 2830 Virum' },
      { titel: 'Askevænget 9, kl., 2830 Virum' },
      { titel: 'Askevænget 9, st. tv, 2830 Virum' },
      { titel: 'Askevænget 9, st. mf, 2830 Virum' },
    ])
    expect(ranked.map((r) => r.titel)).toEqual([
      'Askevænget 9, kl., 2830 Virum',
      'Askevænget 9, st. tv, 2830 Virum',
      'Askevænget 9, st. mf, 2830 Virum',
      'Askevænget 9, st. th, 2830 Virum',
      'Askevænget 9, 1. th, 2830 Virum',
    ])
  })

  it('does not parse a supplerende bynavn starting with "St" as a floor', () => {
    // "Store Fuglede" must not become etage 'st'; both parse fieldless and
    // keep server order.
    const ranked = rankAddressResults('Nonexistentgade', [
      { titel: 'Bakkevej 7, Store Fuglede, 4480 Store Fuglede' },
      { titel: 'Bakkevej 7, 6623 Vorbasse' },
    ])
    expect(ranked[0]?.titel).toBe(
      'Bakkevej 7, Store Fuglede, 4480 Store Fuglede',
    )
  })

  it('is stable: equal-scoring candidates keep their original order', () => {
    // none of these match the query at all → all score 0 → order preserved
    const input = [
      { titel: 'Bøgevej 20, Varde, 6800 Varde' },
      { titel: 'Egevej 3, 5000 Odense C' },
      { titel: 'Lærkevej 12, 8000 Aarhus C' },
    ]
    const ranked = rankAddressResults('Nonexistentgade 999', input)
    expect(ranked.map((r) => r.titel)).toEqual(input.map((r) => r.titel))
  })

  it('does not mutate the input array', () => {
    const input = [...askevaengetBuildings]
    const snapshot = input.map((r) => r.titel)
    rankAddressResults('Askevænget 9 Vejle', input)
    expect(input.map((r) => r.titel)).toEqual(snapshot)
  })
})

describe('hasUnmatchedQueryTokens', () => {
  it('treats a bare floor digit as unmatched detail so buildings expand', () => {
    // "2" must not be swallowed by the postal code 2830 — the user is
    // narrowing to the 2nd floor and expects the building's units.
    expect(
      hasUnmatchedQueryTokens('Askevænget 9, 2.', 'Askevænget 9, 2830 Virum'),
    ).toBe(true)
  })

  it('is false when every query token has an exact match', () => {
    expect(
      hasUnmatchedQueryTokens('Askevænget 9', 'Askevænget 9, 2830 Virum'),
    ).toBe(false)
  })

  it('is true when the query carries detail the titel lacks', () => {
    expect(
      hasUnmatchedQueryTokens(
        'Askevænget 9 2 tv Vejle',
        'Askevænget 9, 7100 Vejle',
      ),
    ).toBe(true)
  })

  it('is false when the titel fully accounts for floor and door', () => {
    expect(
      hasUnmatchedQueryTokens(
        'Askevænget 9, 2. tv',
        'Askevænget 9, 2. tv, 7100 Vejle',
      ),
    ).toBe(false)
  })

  it('treats a prefix match as matched', () => {
    expect(
      hasUnmatchedQueryTokens('askevæng', 'Askevænget 9, 2830 Virum'),
    ).toBe(false)
  })

  it('handles period and comma normalization consistently', () => {
    expect(
      hasUnmatchedQueryTokens(
        'ASKEVÆNGET 9, ST. TV',
        'Askevænget 9, st. tv, 7100 Vejle',
      ),
    ).toBe(false)
  })
})
