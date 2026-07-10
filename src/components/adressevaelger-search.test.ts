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
const twoResultsBody = {
  status: 'ok',
  beskrivelse: '',
  fund: [
    {
      type: 'adresse',
      id: 'a1',
      titel: 'Askevænget 9, 7100 Vejle',
      husnummerId: 'hn-1',
    },
    {
      type: 'adresse',
      id: 'a2',
      titel: 'Askevænget 11, 7100 Vejle',
      husnummerId: 'hn-2',
    },
  ],
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

function keydown(el: HTMLElement, key: string): void {
  el.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  )
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

  describe('keyboard navigation', () => {
    async function openWithTwoSuggestions(
      el: AdressevaelgerSearch,
    ): Promise<HTMLInputElement> {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes('/adresser/soeg'))
          return Promise.resolve(jsonResponse(twoResultsBody))
        return Promise.resolve(
          jsonResponse({ status: 'ok', adresse: fullAddress }),
        )
      })
      const field = input(el)
      field.value = 'Askevænget Vejle'
      field.dispatchEvent(new Event('input'))
      await tick(300)
      await el.updateComplete
      return field
    }

    it('moves the active option with ArrowDown/ArrowUp, wrapping at the ends', async () => {
      const el = mountedElement()
      await el.updateComplete
      const field = await openWithTwoSuggestions(el)

      expect(field.hasAttribute('aria-activedescendant')).toBe(false)

      keydown(field, 'ArrowDown')
      await el.updateComplete
      let options = el.shadowRoot!.querySelectorAll('[role="option"]')
      expect(field.getAttribute('aria-activedescendant')).toBe(options[0]!.id)
      expect(options[0]!.getAttribute('aria-selected')).toBe('true')
      expect(options[1]!.getAttribute('aria-selected')).toBe('false')

      keydown(field, 'ArrowDown')
      await el.updateComplete
      options = el.shadowRoot!.querySelectorAll('[role="option"]')
      expect(field.getAttribute('aria-activedescendant')).toBe(options[1]!.id)

      // Wraps back around to the first option.
      keydown(field, 'ArrowDown')
      await el.updateComplete
      options = el.shadowRoot!.querySelectorAll('[role="option"]')
      expect(field.getAttribute('aria-activedescendant')).toBe(options[0]!.id)

      // ArrowUp from the first option wraps to the last.
      keydown(field, 'ArrowUp')
      await el.updateComplete
      options = el.shadowRoot!.querySelectorAll('[role="option"]')
      expect(field.getAttribute('aria-activedescendant')).toBe(options[1]!.id)
    })

    it('selects the active option on Enter and fires adresse-selected', async () => {
      const el = mountedElement()
      await el.updateComplete
      const field = await openWithTwoSuggestions(el)

      const selected = new Promise<AdresseSelectedDetail>((resolve) => {
        el.addEventListener('adresse-selected', (event) => {
          resolve((event as CustomEvent<AdresseSelectedDetail>).detail)
        })
      })

      keydown(field, 'ArrowDown') // activeIndex -1 -> 0
      await el.updateComplete
      keydown(field, 'Enter')

      const detail = await selected
      expect(detail.suggestion.id).toBe('a1')

      await el.updateComplete
      expect(field.getAttribute('aria-expanded')).toBe('false')
      expect(field.hasAttribute('aria-activedescendant')).toBe(false)
    })

    it('closes the listbox on Escape without firing a selection', async () => {
      const el = mountedElement()
      await el.updateComplete
      const field = await openWithTwoSuggestions(el)

      keydown(field, 'ArrowDown')
      await el.updateComplete
      expect(field.getAttribute('aria-expanded')).toBe('true')

      keydown(field, 'Escape')
      await el.updateComplete

      expect(field.getAttribute('aria-expanded')).toBe('false')
      expect(field.hasAttribute('aria-activedescendant')).toBe(false)
      expect(el.shadowRoot!.querySelectorAll('[role="option"]').length).toBe(0)
    })

    it('reopens a closed listbox on ArrowDown without moving the active option', async () => {
      const el = mountedElement()
      await el.updateComplete
      const field = await openWithTwoSuggestions(el)

      keydown(field, 'Escape')
      await el.updateComplete
      expect(field.getAttribute('aria-expanded')).toBe('false')

      keydown(field, 'ArrowDown')
      await el.updateComplete

      expect(field.getAttribute('aria-expanded')).toBe('true')
      expect(field.hasAttribute('aria-activedescendant')).toBe(false)
      expect(el.shadowRoot!.querySelectorAll('[role="option"]').length).toBe(2)
    })

    it('reopens a closed listbox on ArrowUp without jumping to a suggestion', async () => {
      const el = mountedElement()
      await el.updateComplete
      const field = await openWithTwoSuggestions(el)

      keydown(field, 'Escape')
      await el.updateComplete
      expect(field.getAttribute('aria-expanded')).toBe('false')

      keydown(field, 'ArrowUp')
      await el.updateComplete

      // Symmetric with ArrowDown: reopens without activating an option, rather
      // than landing on the second-to-last one (the old -1 + -1 off-by-one).
      expect(field.getAttribute('aria-expanded')).toBe('true')
      expect(field.hasAttribute('aria-activedescendant')).toBe(false)
      expect(el.shadowRoot!.querySelectorAll('[role="option"]').length).toBe(2)
    })
  })

  describe('error handling', () => {
    it('degrades gracefully (empty, closed listbox) when the search request fails', async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes('/adresser/soeg'))
          return Promise.reject(new Error('network down'))
        return Promise.resolve(
          jsonResponse({ status: 'ok', adresse: fullAddress }),
        )
      })

      const el = mountedElement()
      await el.updateComplete
      const field = input(el)

      field.value = 'Askevænget 9 Vejle'
      field.dispatchEvent(new Event('input'))
      await tick(300)
      await el.updateComplete

      expect(el.shadowRoot!.querySelectorAll('[role="option"]').length).toBe(0)
      expect(field.getAttribute('aria-expanded')).toBe('false')
      const status = el.shadowRoot!.querySelector('[role="status"]')!
      expect(status.textContent!.trim()).toBe('Ingen adresser fundet')
    })

    it('still fires adresse-selected with a null address when the by-id lookup fails', async () => {
      const el = mountedElement()
      await el.updateComplete
      const field = input(el)

      field.value = 'Askevænget 9 Vejle'
      field.dispatchEvent(new Event('input'))
      await tick(300)
      await el.updateComplete

      // Suggestions are showing; now make the by-id resolve fail.
      fetchMock.mockImplementation((url: string) => {
        if (url.includes('/adresser/soeg'))
          return Promise.resolve(jsonResponse(searchBody))
        return Promise.reject(new Error('lookup failed'))
      })

      const selected = new Promise<AdresseSelectedDetail>((resolve) => {
        el.addEventListener('adresse-selected', (event) => {
          resolve((event as CustomEvent<AdresseSelectedDetail>).detail)
        })
      })

      const option =
        el.shadowRoot!.querySelector<HTMLElement>('[role="option"]')!
      option.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
      )

      const detail = await selected
      expect(detail.suggestion.id).toBe('a1')
      expect(detail.address).toBeNull()
    })
  })

  describe('empty results', () => {
    it('renders no options and reports zero results when the search finds nothing', async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes('/adresser/soeg'))
          return Promise.resolve(
            jsonResponse({ status: 'ok', beskrivelse: '', fund: [] }),
          )
        return Promise.resolve(
          jsonResponse({ status: 'ok', adresse: fullAddress }),
        )
      })

      const el = mountedElement()
      await el.updateComplete
      const field = input(el)

      field.value = 'Ingenstedgade 1'
      field.dispatchEvent(new Event('input'))
      await tick(300)
      await el.updateComplete

      expect(el.shadowRoot!.querySelectorAll('[role="option"]').length).toBe(0)
      expect(field.getAttribute('aria-expanded')).toBe('false')
      const status = el.shadowRoot!.querySelector('[role="status"]')!
      expect(status.textContent!.trim()).toBe('Ingen adresser fundet')
    })
  })
})
