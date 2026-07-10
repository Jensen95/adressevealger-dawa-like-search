// Tests for the search client's caching, expansion, dedup and ranking
// orchestration against the adressevaelger.dk /adresser/soeg endpoint.
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AddressSearchResult,
  AdresseSearchResult,
  HusnummerSearchResult,
} from './addressApi'

import { createAddressSearch } from './addressApi'
import { hasUnmatchedQueryTokens, rankAddressResults } from './addressRanking'

vi.mock('./addressRanking', () => ({
  rankAddressResults: vi.fn(
    (_query: string, results: { titel: string }[]) => results,
  ),
  hasUnmatchedQueryTokens: vi.fn(() => false),
}))

const TOKEN = 'test-token-0000'

function jsonResponse(fund: AddressSearchResult[]): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ status: 'ok', beskrivelse: '', fund }),
  } as unknown as Response
}

function adresse(
  id: string,
  titel: string,
  husnummerId = 'hn-1',
): AdresseSearchResult {
  return { type: 'adresse', id, titel, husnummerId }
}

function husnummer(id: string, titel: string): HusnummerSearchResult {
  return {
    type: 'husnummer',
    id,
    titel,
    vejnavn: titel,
    husnummer: '9',
  }
}

describe('createAddressSearch', () => {
  it('throws without a token', () => {
    // @ts-expect-error deliberately omitting the required token
    expect(() => createAddressSearch({})).toThrow(/token/)
  })
})

describe('search', () => {
  const fetchMock = vi.fn()
  let client: ReturnType<typeof createAddressSearch>

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(rankAddressResults).mockImplementation(
      (_query, results) => results,
    )
    vi.mocked(hasUnmatchedQueryTokens).mockReturnValue(false)
    client = createAddressSearch({ token: TOKEN })
  })

  it('caches identical queries so only one fetch is issued', async () => {
    fetchMock.mockResolvedValue(jsonResponse([adresse('a1', 'Askevænget 9')]))
    const controller = new AbortController()

    await client.search(controller.signal, 'Askevænget 9')
    await client.search(controller.signal, 'Askevænget 9')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shares the cache entry across normalized variants of the same query', async () => {
    fetchMock.mockResolvedValue(jsonResponse([adresse('a1', 'Askevænget 9')]))
    const controller = new AbortController()

    await client.search(controller.signal, 'Askevænget  9 ')
    await client.search(controller.signal, 'askevænget 9')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a failed lookup once before giving up', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network blip'))
    fetchMock.mockResolvedValueOnce(
      jsonResponse([adresse('a1', 'Askevænget 9')]),
    )
    const controller = new AbortController()

    const result = await client.search(controller.signal, 'Askevænget 9')

    expect(result).toEqual([adresse('a1', 'Askevænget 9')])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('resolves to [] when both attempts fail and evicts the cache entry so the next call re-fetches', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    fetchMock.mockResolvedValueOnce(
      jsonResponse([adresse('a1', 'Askevænget 9')]),
    )
    const controller = new AbortController()

    const first = await client.search(controller.signal, 'Askevænget 9')
    expect(first).toEqual([])

    const second = await client.search(controller.signal, 'Askevænget 9')
    expect(second).toEqual([adresse('a1', 'Askevænget 9')])

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('expands husnummer results with unmatched query tokens and merges the adresse units, deduped by id', async () => {
    const building = husnummer('hn-1', 'Askevænget 9, 2830 Virum')
    fetchMock.mockImplementation((url: string) => {
      const tekst = new URL(url).searchParams.get('tekst')
      if (tekst === 'Askevænget 9, 2830 Virum') {
        return Promise.resolve(
          jsonResponse([
            adresse('a1', 'Askevænget 9, st. tv, 2830 Virum'),
            adresse('a1', 'Askevænget 9, st. tv, 2830 Virum'),
            adresse('a2', 'Askevænget 9, st. th, 2830 Virum'),
          ]),
        )
      }
      return Promise.resolve(jsonResponse([building]))
    })
    vi.mocked(hasUnmatchedQueryTokens).mockReturnValue(true)
    const controller = new AbortController()

    const result = await client.search(controller.signal, 'Askevænget 9 st tv')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const expansionCall = fetchMock.mock.calls.find(
      (call) =>
        new URL(call[0] as string).searchParams.get('tekst') ===
        'Askevænget 9, 2830 Virum',
    )
    expect(expansionCall).toBeDefined()

    const ids = result.map((r) => r.id)
    expect(ids).toContain('hn-1')
    expect(ids).toContain('a1')
    expect(ids).toContain('a2')
    expect(ids.filter((id) => id === 'a1')).toHaveLength(1)
  })

  it('does not expand when hasUnmatchedQueryTokens is false', async () => {
    const building = husnummer('hn-1', 'Askevænget 9, 2830 Virum')
    fetchMock.mockResolvedValue(jsonResponse([building]))
    vi.mocked(hasUnmatchedQueryTokens).mockReturnValue(false)
    const controller = new AbortController()

    const result = await client.search(controller.signal, 'Askevænget 9')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual([building])
  })

  it('expands navngivenvejpostnummer streets into their addresses and drops vejnavn results', async () => {
    fetchMock.mockImplementation((url: string) => {
      const tekst = new URL(url).searchParams.get('tekst')
      if (tekst === 'Askevænget 2830') {
        return Promise.resolve(
          jsonResponse([
            adresse('a2', 'Askevænget 2, 2830 Virum'),
            husnummer('hn-2', 'Askevænget 5, 2830 Virum'),
            { type: 'vejnavn', titel: 'Askevænget', vejnavn: 'Askevænget' },
          ]),
        )
      }
      return Promise.resolve(
        jsonResponse([
          adresse('a1', 'Askevænget 9'),
          { type: 'vejnavn', titel: 'Askevænget', vejnavn: 'Askevænget' },
          {
            type: 'navngivenvejpostnummer',
            id: 'nv-1',
            titel: 'Askevænget 2830 Virum',
            vejnavn: 'Askevænget',
            postnr: '2830',
            postdistrikt: 'Virum',
            antal_husnumre: 5,
          },
        ]),
      )
    })
    const controller = new AbortController()

    const result = await client.search(controller.signal, 'Askevænget')

    const streetExpansionCall = fetchMock.mock.calls.find(
      (call) =>
        new URL(call[0] as string).searchParams.get('tekst') ===
        'Askevænget 2830',
    )
    expect(streetExpansionCall).toBeDefined()
    expect(result).toEqual([
      adresse('a1', 'Askevænget 9'),
      adresse('a2', 'Askevænget 2, 2830 Virum'),
      husnummer('hn-2', 'Askevænget 5, 2830 Virum'),
    ])
  })

  it('drops trailing words when a query matches nothing (street + city)', async () => {
    fetchMock.mockImplementation((url: string) => {
      const tekst = new URL(url).searchParams.get('tekst')
      if (tekst === 'Askevænget') {
        return Promise.resolve(
          jsonResponse([adresse('a1', 'Askevænget 9, 7100 Vejle')]),
        )
      }
      return Promise.resolve(jsonResponse([]))
    })
    const controller = new AbortController()

    const result = await client.search(controller.signal, 'Askevænget Vejle')

    const queries = fetchMock.mock.calls.map((call) =>
      new URL(call[0] as string).searchParams.get('tekst'),
    )
    expect(queries).toEqual(['Askevænget Vejle', 'Askevænget'])
    expect(result).toEqual([adresse('a1', 'Askevænget 9, 7100 Vejle')])
    // Ranking still runs against the original query, not the fallback.
    expect(rankAddressResults).toHaveBeenCalledWith(
      'Askevænget Vejle',
      expect.anything(),
    )
  })

  it('searches all trailing-word truncations concurrently and keeps the longest match', async () => {
    fetchMock.mockImplementation((url: string) => {
      const tekst = new URL(url).searchParams.get('tekst')
      if (tekst === 'Strandlodsvej 25M') {
        return Promise.resolve(
          jsonResponse([adresse('a1', 'Strandlodsvej 25M, 2300 København S')]),
        )
      }
      if (tekst === 'Strandlodsvej') {
        return Promise.resolve(
          jsonResponse([adresse('a2', 'Strandlodsvej 1, 2300 København S')]),
        )
      }
      return Promise.resolve(jsonResponse([]))
    })
    const controller = new AbortController()

    const result = await client.search(
      controller.signal,
      'Strandlodsvej 25M København S',
    )

    const queries = fetchMock.mock.calls.map((call) =>
      new URL(call[0] as string).searchParams.get('tekst'),
    )
    // The initial query misses; every truncation is then searched in one
    // concurrent wave instead of one round trip per dropped word.
    expect(queries).toEqual([
      'Strandlodsvej 25M København S',
      'Strandlodsvej 25M København',
      'Strandlodsvej 25M',
      'Strandlodsvej',
    ])
    // The longest matching truncation wins even when a shorter one matches.
    expect(result).toEqual([
      adresse('a1', 'Strandlodsvej 25M, 2300 København S'),
    ])
  })

  it('keeps partial results when one expansion request fails', async () => {
    const street = (postnr: string, postdistrikt: string) => ({
      type: 'navngivenvejpostnummer' as const,
      id: `nv-${postnr}`,
      titel: `Askevænget ${postnr} ${postdistrikt}`,
      vejnavn: 'Askevænget',
      postnr,
      postdistrikt,
      antal_husnumre: 5,
    })
    fetchMock.mockImplementation((url: string) => {
      const tekst = new URL(url).searchParams.get('tekst')
      if (tekst === 'Askevænget 2830') {
        return Promise.reject(new Error('network down'))
      }
      if (tekst === 'Askevænget 7100') {
        return Promise.resolve(
          jsonResponse([adresse('a9', 'Askevænget 9, 7100 Vejle')]),
        )
      }
      return Promise.resolve(
        jsonResponse([street('2830', 'Virum'), street('7100', 'Vejle')]),
      )
    })
    const controller = new AbortController()

    const result = await client.search(controller.signal, 'Askevænget')

    expect(result).toEqual([adresse('a9', 'Askevænget 9, 7100 Vejle')])
  })

  it('does not issue street expansions when the signal is already aborted', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        {
          type: 'navngivenvejpostnummer',
          id: 'nv-1',
          titel: 'Askevænget 2830 Virum',
          vejnavn: 'Askevænget',
          postnr: '2830',
          postdistrikt: 'Virum',
          antal_husnumre: 5,
        },
      ]),
    )
    const controller = new AbortController()
    controller.abort()

    const result = await client.search(controller.signal, 'Askevænget')

    expect(result).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('caps results at maxResults after ranking', async () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      adresse(`a${i}`, `Address ${i}`),
    )
    fetchMock.mockResolvedValue(jsonResponse(many))
    const controller = new AbortController()

    const result = await client.search(controller.signal, 'Address')

    expect(result).toHaveLength(10)
  })

  it('honours a custom maxResults', async () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      adresse(`a${i}`, `Address ${i}`),
    )
    fetchMock.mockResolvedValue(jsonResponse(many))
    const smallClient = createAddressSearch({ token: TOKEN, maxResults: 3 })
    const controller = new AbortController()

    const result = await smallClient.search(controller.signal, 'Address')

    expect(result).toHaveLength(3)
  })

  it('returns [] without issuing an expansion request when the signal is already aborted', async () => {
    const building = husnummer('hn-1', 'Askevænget 9, 2830 Virum')
    fetchMock.mockResolvedValue(jsonResponse([building]))
    vi.mocked(hasUnmatchedQueryTokens).mockReturnValue(true)
    const controller = new AbortController()
    controller.abort()

    const result = await client.search(controller.signal, 'Askevænget 9 st tv')

    expect(result).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('adds medtag-foreloebige to search and expansion requests when includePreliminary is set', async () => {
    const building = husnummer('hn-1', 'Askevænget 9, 2830 Virum')
    fetchMock.mockResolvedValue(jsonResponse([building]))
    vi.mocked(hasUnmatchedQueryTokens).mockReturnValue(true)
    const prelimClient = createAddressSearch({
      token: TOKEN,
      includePreliminary: true,
    })
    const controller = new AbortController()

    await prelimClient.search(controller.signal, 'Askevænget 9 st tv')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const call of fetchMock.mock.calls) {
      expect(
        new URL(call[0] as string).searchParams.get('medtag-foreloebige'),
      ).toBe('true')
    }
  })

  it('omits medtag-foreloebige by default, and separate clients keep independent caches', async () => {
    fetchMock.mockResolvedValue(jsonResponse([adresse('a1', 'Askevænget 9')]))
    const controller = new AbortController()

    await client.search(controller.signal, 'Askevænget 9')
    expect(
      new URL(fetchMock.mock.calls[0]![0] as string).searchParams.get(
        'medtag-foreloebige',
      ),
    ).toBeNull()

    const prelimClient = createAddressSearch({
      token: TOKEN,
      includePreliminary: true,
    })
    await prelimClient.search(controller.signal, 'Askevænget 9')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // The preliminary client caches its own variant.
    await prelimClient.search(controller.signal, 'Askevænget 9')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('clearCache resets caching between calls', async () => {
    fetchMock.mockResolvedValue(jsonResponse([adresse('a1', 'Askevænget 9')]))
    const controller = new AbortController()

    await client.search(controller.signal, 'Askevænget 9')
    client.clearCache()
    await client.search(controller.signal, 'Askevænget 9')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('getAddressById', () => {
  const fetchMock = vi.fn()
  const fullAddress = { id_lokalid: 'a1', adressebetegnelse: 'Askevænget 9' }
  let client: ReturnType<typeof createAddressSearch>

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    client = createAddressSearch({ token: TOKEN })
  })

  it('caches lookups by id so re-selecting a suggestion issues no new fetch', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok', adresse: fullAddress }),
    })

    const first = await client.getAddressById('a1')
    const second = await client.getAddressById('a1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first).toEqual(fullAddress)
    expect(second).toEqual(fullAddress)
  })

  it('caches the two preliminary variants separately across clients', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok', adresse: fullAddress }),
    })
    const prelimClient = createAddressSearch({
      token: TOKEN,
      includePreliminary: true,
    })

    await client.getAddressById('a1')
    await prelimClient.getAddressById('a1')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failed lookup, so the next call re-fetches', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: 'ok', adresse: fullAddress }),
    })

    const first = await client.getAddressById('a1')
    expect(first).toBeNull()

    const second = await client.getAddressById('a1')
    expect(second).toEqual(fullAddress)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
