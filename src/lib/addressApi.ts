import { hasUnmatchedQueryTokens, rankAddressResults } from './addressRanking'

/** Default API base. adressevaelger.dk serves CORS wildcard-open. */
export const DEFAULT_BASE_URL = 'https://adressevaelger.dk'

/** Default number of ranked suggestions returned by {@link AddressSearchClient.search}. */
export const DEFAULT_MAX_RESULTS = 10

// Search results from /adresser/soeg — a union discriminated on `type`.
// See https://confluence.kds.dk/pages/viewpage.action?pageId=244318431

export interface AdresseSearchResult {
  type: 'adresse'
  id: string
  titel: string
  husnummerId: string
}

export interface HusnummerSearchResult {
  type: 'husnummer'
  id: string
  titel: string
  vejnavn: string
  husnummer: string
}

export interface VejnavnSearchResult {
  type: 'vejnavn'
  titel: string
  vejnavn: string
}

export interface NavngivenVejPostnummerSearchResult {
  type: 'navngivenvejpostnummer'
  id: string
  titel: string
  vejnavn: string
  postnr: string
  postdistrikt: string
  antal_husnumre: number
}

export type AddressSearchResult =
  | AdresseSearchResult
  | HusnummerSearchResult
  | VejnavnSearchResult
  | NavngivenVejPostnummerSearchResult

// Results that identify a single address or house number and can be resolved
// to full address data via the by-id endpoints. `vejnavn` and
// `navngivenvejpostnummer` results are street-level refinement suggestions
// and are filtered out.
export type AutocompletedAddress = AdresseSearchResult | HusnummerSearchResult

interface AddressSearchResponse {
  status: string
  beskrivelse: string
  fund: AddressSearchResult[]
}

/**
 * Options for {@link createAddressSearch}.
 */
export interface CreateAddressSearchOptions {
  /**
   * API access token, sent as the `token` query parameter (**required**).
   *
   * The service accepts any token of at least 10 characters today, but that is
   * an implementation detail that may change. Request a real token for
   * production use from support@kds.dk and honour the service's terms. No
   * default token is shipped.
   */
  token: string
  /** API base URL. Defaults to {@link DEFAULT_BASE_URL}. */
  baseUrl?: string
  /**
   * Include preliminary (not yet finalized) addresses — maps to the
   * `medtag-foreloebige` query param. Needed e.g. for building plots in new
   * developments. Defaults to `false`.
   */
  includePreliminary?: boolean
  /** Maximum ranked suggestions returned by `search`. Defaults to {@link DEFAULT_MAX_RESULTS}. */
  maxResults?: number
}

/**
 * A configured, cached address-search client. Returned by
 * {@link createAddressSearch}. Every instance owns its own request caches.
 */
export interface AddressSearchClient {
  /**
   * Search for addresses matching `term`, ranked by relevance to the raw query.
   * Returns at most `maxResults` results. Best-effort: resolves to `[]` on
   * error or when `signal` is aborted.
   */
  search(signal: AbortSignal, term?: string): Promise<AutocompletedAddress[]>
  /** Resolve a full address by its id (cached). Returns `null` on error. */
  getAddressById(id: string): Promise<FullAddress | null>
  /** Resolve a house number by its id (cached). Returns `null` on error. */
  getHouseNumberById(id: string): Promise<HouseNumber | null>
  /** Clear both the search and by-id caches. */
  clearCache(): void
}

const MAX_CACHE_ENTRIES = 100

// The /adresser/soeg endpoint caps its response at `maksimum` results (API
// default 100, hard max 200). We only ever display a handful, but ranking
// needs a full candidate pool, so the initial/fallback searches and
// husnummer→unit expansions keep the default-sized pool.
const SEARCH_RESULT_MAX = 100
// Street-level expansions only need each postal area's *lowest* house numbers
// (the same-street tie-break and DAWA both surface house number 1-6 first),
// so their many payloads are right-sized well below the default — we never
// look past the first handful of an expansion's ascending house-number list.
const STREET_EXPANSION_RESULT_MAX = 30
// A street-only query (e.g. "Askevænget") returns one navngivenvejpostnummer
// per postal area the street exists in — 100-175 entries for common names —
// and the pipeline fires one "<street> <postnr>" expansion per entry, which
// is what makes the first keystrokes of a typing session cost dozens of
// requests. Cap the fan-out to the first N entries (the API returns them in
// postal-code order). 20 is the smallest cap that still preserves DAWA parity
// for the worst-spread street in the recorded comparison data: Askevænget
// exists in 19 postal areas (2830→7100) and its DAWA-top house-number-1
// candidates include the very last one (7100), so any cap below 19 would
// drop them.
const MAX_STREET_EXPANSIONS = 20

function normalizeQuery(term: string): string {
  return term.trim().replaceAll(/\s+/g, ' ').toLowerCase()
}

function isAutocompletedAddress(
  found: AddressSearchResult,
): found is AutocompletedAddress {
  return found.type === 'adresse' || found.type === 'husnummer'
}

// Expansion lookups are best-effort: one failed request must not blank the
// whole suggestion list, so failures are dropped instead of propagated (the
// failed entry is also evicted from the cache, so it gets retried).
async function allFulfilled<T>(promises: Promise<T>[]): Promise<Awaited<T>[]> {
  const settled = await Promise.allSettled(promises)
  return settled
    .filter(
      (result): result is PromiseFulfilledResult<Awaited<T>> =>
        result.status === 'fulfilled',
    )
    .map((result) => result.value)
}

// One transient failure shouldn't drop a lookup — retry once before giving
// up. Aborted requests are not retried.
async function retryOnce<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }
    return run()
  }
}

/**
 * Create a configured, cached address-search client.
 *
 * The returned client is fully usable **without** the web component — it is the
 * headless core of the library.
 *
 * @example
 * ```ts
 * const search = createAddressSearch({ token: 'your-token' })
 * const controller = new AbortController()
 * const results = await search.search(controller.signal, 'askevænget 9 2 tv')
 * const full = await search.getAddressById(results[0].id)
 * ```
 */
export function createAddressSearch(
  options: CreateAddressSearchOptions,
): AddressSearchClient {
  const { token } = options
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error(
      'createAddressSearch requires a `token`. Request one from support@kds.dk.',
    )
  }
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const includePreliminary = options.includePreliminary ?? false
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS

  function buildUrl(path: string, params: Record<string, string> = {}): string {
    const url = new URL(`${baseUrl}${path}`)
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
    if (includePreliminary) url.searchParams.set('medtag-foreloebige', 'true')
    url.searchParams.set('token', token)
    return url.toString()
  }

  // Raw search against the API. Throws on network error, non-OK response, or a
  // malformed body — callers handle caching/errors. Takes no AbortSignal: the
  // promise is shared across callers via the cache below, so one caller
  // aborting must never affect another caller awaiting the same in-flight
  // request. `maksimum` right-sizes the response (see the constants above).
  async function fetchSearchResults(
    addressTerm: string,
    maksimum: number,
  ): Promise<AddressSearchResult[]> {
    const response = await fetch(
      buildUrl('/adresser/soeg', {
        tekst: addressTerm,
        maksimum: String(maksimum),
      }),
    )
    if (!response.ok) {
      throw new Error(`Address search failed with status ${response.status}`)
    }
    const body = (await response.json()) as AddressSearchResponse
    if (!Array.isArray(body.fund)) {
      throw new Error('Address search response was malformed')
    }
    return body.fund
  }

  // Cache of in-flight/completed searches, keyed by a normalized query so
  // concurrent/duplicate lookups for the same text share a single request.
  const searchCache = new Map<string, Promise<AddressSearchResult[]>>()

  function cachedSearch(
    addressTerm: string,
    maksimum: number,
  ): Promise<AddressSearchResult[]> {
    const trimmed = addressTerm.trim()
    // `maksimum` is part of the request, so it must key the cache too — the
    // same term fetched with a smaller cap returns a different response.
    const key = `max${maksimum}:${normalizeQuery(trimmed)}`
    const cached = searchCache.get(key)
    if (cached) {
      // Refresh recency for the simple LRU below.
      searchCache.delete(key)
      searchCache.set(key, cached)
      return cached
    }

    const promise = retryOnce(() => fetchSearchResults(trimmed, maksimum))
    promise.catch(() => {
      // Never cache a failed lookup.
      searchCache.delete(key)
    })

    searchCache.set(key, promise)
    if (searchCache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = searchCache.keys().next().value
      if (oldestKey !== undefined) searchCache.delete(oldestKey)
    }

    return promise
  }

  async function search(
    signal: AbortSignal,
    addressTerm?: string,
  ): Promise<AutocompletedAddress[]> {
    if (!addressTerm?.trim()) return []

    try {
      let initialResults = await cachedSearch(addressTerm, SEARCH_RESULT_MAX)

      // The API treats every word before a house number as part of the street
      // name, so a street + city query ("Askevænget Vejle") matches no street
      // and returns nothing — while DAWA understood city names. Best effort:
      // search every trailing-word truncation of the query concurrently (one
      // round trip instead of one per dropped word) and keep the longest one
      // that matches; ranking against the full original query below then
      // surfaces the intended city first.
      if (initialResults.length === 0 && !signal.aborted) {
        const truncations: string[] = []
        let fallbackTerm = addressTerm.trim()
        let lastSpace = fallbackTerm.lastIndexOf(' ')
        while (lastSpace !== -1) {
          fallbackTerm = fallbackTerm
            .slice(0, lastSpace)
            .replace(/[\s,.]+$/, '')
          if (!fallbackTerm) break
          truncations.push(fallbackTerm)
          lastSpace = fallbackTerm.lastIndexOf(' ')
        }
        if (truncations.length > 0) {
          const fallbackResults = await Promise.allSettled(
            truncations.map((term) => cachedSearch(term, SEARCH_RESULT_MAX)),
          )
          // truncations is ordered longest-first, so the first non-empty
          // result is the most specific match — same choice the old
          // one-word-at-a-time loop made, minus the serial round trips.
          for (const settled of fallbackResults) {
            if (settled.status === 'fulfilled' && settled.value.length > 0) {
              initialResults = settled.value
              break
            }
          }
        }
      }

      const candidates: AutocompletedAddress[] = initialResults.filter(
        isAutocompletedAddress,
      )

      const needsUnitExpansion = (
        candidate: AutocompletedAddress,
      ): candidate is HusnummerSearchResult =>
        candidate.type === 'husnummer' &&
        hasUnmatchedQueryTokens(addressTerm, candidate.titel)

      const expandToUnits = (
        expandable: HusnummerSearchResult[],
      ): Promise<AddressSearchResult[][]> =>
        expandable.length > 0
          ? allFulfilled(
              expandable.map((candidate) =>
                cachedSearch(candidate.titel, SEARCH_RESULT_MAX),
              ),
            )
          : Promise.resolve([])

      if (!signal.aborted) {
        // Two independent expansion waves run concurrently:
        //
        // Street-level expansion: a street-only query (e.g. "Askevænget")
        // returns only navngivenvejpostnummer suggestions, which are not
        // selectable addresses. Searching "<street> <postnr>" returns that
        // street's house numbers, so fetch those to show concrete addresses
        // the way the old DAWA autocomplete did.
        // The fan-out is capped: common street names exist in 100+ postal
        // areas and expanding every one of them is what made the first
        // keystrokes of a typing session cost dozens of requests.
        const streets = initialResults
          .filter(
            (found): found is NavngivenVejPostnummerSearchResult =>
              found.type === 'navngivenvejpostnummer',
          )
          .slice(0, MAX_STREET_EXPANSIONS)
        const streetExpansionsPromise =
          streets.length > 0
            ? allFulfilled(
                streets.map((street) =>
                  cachedSearch(
                    `${street.vejnavn} ${street.postnr}`,
                    STREET_EXPANSION_RESULT_MAX,
                  ),
                ),
              )
            : Promise.resolve([])

        // Husnummer expansion: when the query carries detail (floor, door,
        // city…) a husnummer titel doesn't account for, search the titel to
        // get the concrete adresse units under that building. The initial
        // candidates are known before street expansion resolves, so their
        // unit lookups don't wait for it.
        const initialUnitsPromise = expandToUnits(
          candidates.filter(needsUnitExpansion),
        )

        const streetCandidates: AutocompletedAddress[] = []
        for (const expansionResults of await streetExpansionsPromise) {
          for (const found of expansionResults) {
            if (isAutocompletedAddress(found)) streetCandidates.push(found)
          }
        }

        // Husnumre discovered via street expansion may need their own unit
        // lookups — necessarily a second wave, since they are only known now.
        // The enclosing guard's narrowing no longer holds: aborted can flip
        // to true while the street expansion above was awaited.
        const streetUnits = signal.aborted
          ? []
          : await expandToUnits(streetCandidates.filter(needsUnitExpansion))
        const initialUnits = await initialUnitsPromise

        candidates.push(...streetCandidates)
        for (const expansionResults of [...initialUnits, ...streetUnits]) {
          for (const found of expansionResults) {
            if (found.type === 'adresse') candidates.push(found)
          }
        }
      }

      const deduped: AutocompletedAddress[] = []
      const seenIds = new Set<string>()
      for (const candidate of candidates) {
        if (seenIds.has(candidate.id)) continue
        seenIds.add(candidate.id)
        deduped.push(candidate)
      }

      if (signal.aborted) return []

      return rankAddressResults(addressTerm, deduped).slice(0, maxResults)
    } catch {
      return []
    }
  }

  // Cache of in-flight/completed by-id lookups, so re-selecting a suggestion
  // (or resolving one that an expansion already fetched) costs no extra round
  // trip. Shares the search cache's rules: promises are shared across callers.
  const byIdCache = new Map<string, Promise<unknown>>()

  function cachedByIdLookup<T>(
    cacheKey: string,
    lookup: () => Promise<T>,
  ): Promise<T> {
    const cached = byIdCache.get(cacheKey) as Promise<T> | undefined
    if (cached) {
      // Refresh recency for the simple LRU below.
      byIdCache.delete(cacheKey)
      byIdCache.set(cacheKey, cached)
      return cached
    }

    const promise = retryOnce(lookup)
    promise.catch(() => {
      // Never cache a failed lookup.
      byIdCache.delete(cacheKey)
    })

    byIdCache.set(cacheKey, promise)
    if (byIdCache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = byIdCache.keys().next().value
      if (oldestKey !== undefined) byIdCache.delete(oldestKey)
    }

    return promise
  }

  async function getAddressById(id: string): Promise<FullAddress | null> {
    try {
      return await cachedByIdLookup(`adresse:${id}`, async () => {
        const response = await fetch(buildUrl(`/adresser/${id}`))
        const body = (await response.json()) as {
          status: string
          adresse?: FullAddress
        }
        return body.adresse ?? null
      })
    } catch {
      return null
    }
  }

  async function getHouseNumberById(id: string): Promise<HouseNumber | null> {
    try {
      return await cachedByIdLookup(`husnummer:${id}`, async () => {
        const response = await fetch(buildUrl(`/husnumre/${id}`))
        const body = (await response.json()) as {
          status: string
          husnummer?: HouseNumber
        }
        return body.husnummer ?? null
      })
    } catch {
      return null
    }
  }

  function clearCache(): void {
    searchCache.clear()
    byIdCache.clear()
  }

  return { search, getAddressById, getHouseNumberById, clearCache }
}

// Full data model returned by the by-id endpoints.
// See https://confluence.kds.dk/pages/viewpage.action?pageId=246743156

interface DarEntity {
  id_lokalid: string
  virkningfra: string
  virkningtil: string | null
  registreringfra: string
  registreringtil: string | null
}

export interface Adgangspunkt extends DarEntity {
  status: string
  geometri: {
    type: string
    crs: { type: string; properties: { name: string } }
    coordinates: [number, number]
  }
  // Coordinates are EPSG:25832, not WGS84
  koordinater: { x: number; y: number }
}

export interface Postnummer extends DarEntity {
  navn: string
  postnr: string
  status: string
}

export interface NavngivenVej extends DarEntity {
  vejnavn: string
}

export interface NavngivenVejKommunedel extends DarEntity {
  kommune: string
  vejkode: string
  navngivenvej: string
}

export interface SupplerendeBynavn {
  id_lokalid: string | null
  status: string | null
  supplerendebynavn: string | null
  navn: string | null
  virkningfra: string | null
  virkningtil: string | null
  registreringfra: string | null
  registreringtil: string | null
}

export interface HouseNumber extends DarEntity {
  husnummertekst: string
  adgangsadressebetegnelse: string
  vejnavn: string
  status: string
  adgangspunkt: Adgangspunkt
  postnummer: Postnummer
  navngivenvej: NavngivenVej
  navngivenvejkommunedel: NavngivenVejKommunedel
  navngivenvejpostnummer: DarEntity
  supplerendebynavn: SupplerendeBynavn | null
}

export interface FullAddress extends DarEntity {
  adressebetegnelse: string
  etagebetegnelse: string | null
  doerbetegnelse: string | null
  status: string
  husnummer: HouseNumber
}
