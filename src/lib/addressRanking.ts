// Client-side fuzzy re-ranking of adressevaelger.dk address candidates against
// the user's raw query. The /adresser/soeg search API only filters on
// street/house-number/postal-code and orders by postal code (not relevance),
// and ignores floor/door/city in the query — so we score each candidate's
// `titel` display string against the full query text and sort by descending
// relevance.

/**
 * Weight of the secondary "titel coverage" term. Kept small so it only breaks
 * ties between candidates that match the query equally well — favouring the
 * shorter / more-exact titel (e.g. the plain building over one of its units).
 */
const TITEL_COVERAGE_WEIGHT = 0.2

/**
 * Split an address string into comparable tokens.
 *
 * - lowercased
 * - commas and periods act as separators (`"st. tv"` → `["st", "tv"]`,
 *   `"2."` → `["2"]`)
 * - whitespace is collapsed
 * - Danish letters æøå are preserved
 * - meaningful characters inside house numbers (e.g. `"9A"`) are preserved
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replaceAll(/[,.]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0)
}

/**
 * Fold Danish letters to their keyboard transliterations (å→aa, æ→ae, ø→oe)
 * so `"brogaardsvej"` typed on a keyboard without Danish letters matches
 * `"Brogårdsvej"`. The adressevaelger API already folds these server-side, so
 * matching it here keeps ranking (and expansion detection) consistent with
 * the candidates the API returns. Expects lowercased input.
 */
function foldDanishLetters(token: string): string {
  return token.replaceAll('å', 'aa').replaceAll('æ', 'ae').replaceAll('ø', 'oe')
}

/**
 * Score a single query token against a single titel token.
 *
 * - exact match → 1.0
 * - prefix match (titel token starts with the query token) → partial credit
 *   that grows with how much of the titel token is covered, so an exact match
 *   always beats a prefix match
 * - otherwise → 0
 *
 * Tokens are compared with Danish letters folded (aa↔å, ae↔æ, oe↔ø), so
 * `"brogaardsvej"` scores like `"brogårdsvej"`.
 *
 * Direction matters: the titel token must start with the query token, so query
 * `"9"` matches titel `"90"`, but query `"90"` does not match titel `"9"`.
 *
 * Exception: a single-digit query token never prefix-matches a 4-digit postal
 * code. A lone digit is a floor ("Askevænget 9, 2." = 2nd floor), and letting
 * it match "2830" would both hide the floor intent from the ranking and stop
 * the building from being expanded into its units. Two or more digits still
 * prefix-match postal codes so progressively typing "28…" narrows as expected.
 */
export function tokenMatchScore(
  queryToken: string,
  titelToken: string,
): number {
  const query = foldDanishLetters(queryToken)
  const titel = foldDanishLetters(titelToken)
  if (query === titel) return 1
  if (/^\d$/.test(query) && /^\d{4}$/.test(titel)) return 0
  if (titel.startsWith(query)) {
    return 0.5 + 0.5 * (query.length / titel.length)
  }
  return 0
}

interface MatchResult {
  /** Average match score across query tokens (query coverage), 0–1. */
  queryScore: number
  /** Fraction of titel tokens consumed by a query token, 0–1. */
  titelCoverage: number
  /** Number of query tokens that found no exact-or-prefix match at all. */
  unmatchedQueryTokens: number
}

/**
 * Greedily match every query token to its best-scoring, still-unused titel
 * token (each titel token may be consumed by at most one query token).
 */
function matchTokens(
  queryTokens: string[],
  titelTokens: string[],
): MatchResult {
  if (queryTokens.length === 0) {
    return { queryScore: 0, titelCoverage: 0, unmatchedQueryTokens: 0 }
  }

  const consumed = Array.from<boolean>({ length: titelTokens.length }).fill(
    false,
  )
  let totalScore = 0
  let consumedCount = 0
  let unmatchedQueryTokens = 0

  for (const queryToken of queryTokens) {
    let bestScore = 0
    let bestIndex = -1
    for (let i = 0; i < titelTokens.length; i++) {
      const titelToken = titelTokens[i]
      if (consumed[i] || titelToken === undefined) continue
      const score = tokenMatchScore(queryToken, titelToken)
      if (score > bestScore) {
        bestScore = score
        bestIndex = i
      }
    }
    if (bestIndex >= 0) {
      consumed[bestIndex] = true
      consumedCount++
      totalScore += bestScore
    } else {
      unmatchedQueryTokens++
    }
  }

  return {
    queryScore: totalScore / queryTokens.length,
    titelCoverage:
      titelTokens.length === 0 ? 0 : consumedCount / titelTokens.length,
    unmatchedQueryTokens,
  }
}

/**
 * Relevance score of a candidate `titel` against the `query`.
 *
 * Primary term is query coverage (how well the titel accounts for what the user
 * typed); a smaller secondary term rewards titel coverage so that, among equally
 * matching candidates, shorter / more-exact titles rank higher.
 */
export function scoreAddress(query: string, titel: string): number {
  const { queryScore, titelCoverage } = matchTokens(
    tokenize(query),
    tokenize(titel),
  )
  return queryScore + TITEL_COVERAGE_WEIGHT * titelCoverage
}

// Fields parsed out of a titel like "Askevænget 9, 2. tv, 2830 Virum" for the
// DAWA-style tie-break below.
interface TitelFields {
  vejnavn: string
  husnrTal: number | null
  husnrBogstav: string
  etage: string | null
  dør: string | null
  postnr: number | null
}

function parseTitelFields(titel: string): TitelFields {
  const segments = titel.split(',').map((segment) => segment.trim())
  const first = segments[0] ?? ''
  const streetMatch = /^(.*?)\s+(\d+)([a-zæøå]?)$/i.exec(first)

  const last = segments.at(-1) ?? ''
  const postnrMatch = /^(\d{4})\s/.exec(last)

  // Middle segments hold floor/door ("2. tv", "st. 6", "kl.") or a
  // supplerende bynavn; only the floor/door shape is field-parsed. The word
  // boundary keeps bynavne like "Store Fuglede" from parsing as floor "st".
  let etage: string | null = null
  let dør: string | null = null
  for (const segment of segments.slice(1, -1)) {
    const unitMatch = /^(st|kl|\d{1,2})\b\.?\s*(.*)$/i.exec(segment)
    if (unitMatch?.[1] !== undefined) {
      etage = unitMatch[1].toLowerCase()
      dør = unitMatch[2] ? unitMatch[2].toLowerCase() : null
    }
  }

  return {
    vejnavn: foldDanishLetters((streetMatch?.[1] ?? first).toLowerCase()),
    husnrTal: streetMatch?.[2] !== undefined ? Number(streetMatch[2]) : null,
    husnrBogstav: streetMatch?.[3]?.toLowerCase() ?? '',
    etage,
    dør,
    postnr: postnrMatch?.[1] !== undefined ? Number(postnrMatch[1]) : null,
  }
}

// DAWA's etage order: kl (basement) < st (ground) < 1 < 2 < …
function etageRank(etage: string | null): number {
  if (etage === null) return -1
  if (etage === 'kl') return -100
  if (etage === 'st') return 0
  const floor = Number(etage)
  return Number.isNaN(floor) ? 999 : floor
}

// DAWA's dør order: tv < mf < th < numeric doors ascending.
function dørRank(dør: string | null): number {
  if (dør === null) return -1
  if (dør === 'tv') return 0
  if (dør === 'mf') return 1
  if (dør === 'th') return 2
  const numeric = Number(dør)
  return Number.isNaN(numeric) ? 1000 : 100 + numeric
}

/**
 * DAWA's tie-break between equally relevant candidates on the SAME street:
 * house number ascending (number, then letter), then floor (kl < st < 1 < …),
 * then door (tv < mf < th < numeric), then postal code. This is what spreads a
 * street-only query across postal areas the way DAWA did (Askevænget 1, 2830 /
 * Askevænget 1, 4550 / …) instead of dumping the lowest postal code's entire
 * street first. Candidates on different streets are left in server order —
 * comparing house numbers across streets is meaningless.
 */
function compareSameStreetFields(a: TitelFields, b: TitelFields): number {
  if (a.vejnavn !== b.vejnavn) return 0
  if (a.husnrTal !== null && b.husnrTal !== null && a.husnrTal !== b.husnrTal) {
    return a.husnrTal - b.husnrTal
  }
  if (a.husnrBogstav !== b.husnrBogstav) {
    return a.husnrBogstav < b.husnrBogstav ? -1 : 1
  }
  const etageDelta = etageRank(a.etage) - etageRank(b.etage)
  if (etageDelta !== 0) return etageDelta
  const dørDelta = dørRank(a.dør) - dørRank(b.dør)
  if (dørDelta !== 0) return dørDelta
  return (a.postnr ?? 99999) - (b.postnr ?? 99999)
}

/**
 * Sort results by descending relevance to the query. Equal scores on the same
 * street tie-break in DAWA's field order (see compareSameStreetFields); all
 * other ties keep server order. Does not mutate the input array.
 */
export function rankAddressResults<T extends { titel: string }>(
  query: string,
  results: T[],
): T[] {
  return results
    .map((result, index) => ({
      result,
      index,
      score: scoreAddress(query, result.titel),
      fields: parseTitelFields(result.titel),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        compareSameStreetFields(a.fields, b.fields) ||
        a.index - b.index,
    )
    .map((entry) => entry.result)
}

/**
 * True when the query contains at least one token that has no exact or prefix
 * match in the titel — i.e. the user typed detail (floor, door, city…) that this
 * candidate's titel does not account for. A partial prefix match counts as
 * matched.
 */
export function hasUnmatchedQueryTokens(query: string, titel: string): boolean {
  const { unmatchedQueryTokens } = matchTokens(tokenize(query), tokenize(titel))
  return unmatchedQueryTokens > 0
}
