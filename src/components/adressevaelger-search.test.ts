// Smoke test for the <adressevaelger-search> Lit component: it upgrades, sets up
// combobox ARIA, renders suggestions from a (mocked) search and resolves the
// selection by id into an `adresse-selected` event. Runs with no real network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import './adressevaelger-search'
import type {
  AdressevaelgerSearch,
  AdresseSelectedDetail,
} from './adressevaelger-search'

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

const searchBody = {
  status: 'ok',
  beskrivelse: '',
  fund: [
    {
      type: 'adresse',
      id: 'a1',
      titel: 'Askevænget 9, 7100 Vejle',
      husnummerId: 'hn-1',
    },
  ],
}
const fullAddress = {
  id_lokalid: 'a1',
  adressebetegnelse: 'Askevænget 9, 7100 Vejle',
}

function mountedElement(): AdressevaelgerSearch {
  const el = document.createElement('adressevaelger-search')
  el.token = 'test-token-0000'
  document.body.append(el)
  return el
}

function input(el: AdressevaelgerSearch): HTMLInputElement {
  return el.shadowRoot!.querySelector('input')!
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('<adressevaelger-search>', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/adresser/soeg'))
        return Promise.resolve(jsonResponse(searchBody))
      return Promise.resolve(
        jsonResponse({ status: 'ok', adresse: fullAddress }),
      )
    })
  })

  afterEach(() => {
    document.body.replaceChildren()
    vi.unstubAllGlobals()
  })

  it('upgrades and exposes combobox ARIA on the input', async () => {
    const el = mountedElement()
    await el.updateComplete
    const field = input(el)
    expect(field.getAttribute('role')).toBe('combobox')
    expect(field.getAttribute('aria-autocomplete')).toBe('list')
    expect(field.getAttribute('aria-expanded')).toBe('false')
  })

  it('renders ranked suggestions after debounced input', async () => {
    const el = mountedElement()
    await el.updateComplete
    const field = input(el)

    field.value = 'Askevænget 9 Vejle'
    field.dispatchEvent(new Event('input'))

    await tick(300) // clear the 250ms debounce
    await el.updateComplete

    const options = el.shadowRoot!.querySelectorAll('[role="option"]')
    expect(options.length).toBe(1)
    expect(options[0]!.textContent).toContain('Askevænget 9, 7100 Vejle')
    expect(field.getAttribute('aria-expanded')).toBe('true')
  })

  it('resolves the selection by id and fires adresse-selected', async () => {
    const el = mountedElement()
    await el.updateComplete
    const field = input(el)

    const selected = new Promise<AdresseSelectedDetail>((resolve) => {
      el.addEventListener('adresse-selected', (event) => {
        resolve((event as CustomEvent<AdresseSelectedDetail>).detail)
      })
    })

    field.value = 'Askevænget 9 Vejle'
    field.dispatchEvent(new Event('input'))
    await tick(300)
    await el.updateComplete

    const option = el.shadowRoot!.querySelector<HTMLElement>('[role="option"]')!
    option.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    )

    const detail = await selected
    expect(detail.suggestion.id).toBe('a1')
    expect(detail.address).toEqual(fullAddress)
  })
})
