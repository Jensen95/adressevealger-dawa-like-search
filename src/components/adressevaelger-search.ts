import { LitElement, html, css, nothing, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'

import {
  createAddressSearch,
  tokenize,
  type AddressSearchClient,
  type AutocompletedAddress,
  type FullAddress,
  type HouseNumber,
} from '../lib/index'

/**
 * Detail payload of the `adresse-selected` event.
 *
 * `suggestion` is always the picked list item. For an `adresse` suggestion,
 * `address` holds the resolved {@link FullAddress}; for a `husnummer`
 * suggestion, `houseNumber` holds the resolved {@link HouseNumber}. The
 * resolution is a cached by-id lookup performed on selection.
 */
export interface AdresseSelectedDetail {
  suggestion: AutocompletedAddress
  address: FullAddress | null
  houseNumber: HouseNumber | null
}

function fold(token: string): string {
  return token
    .toLowerCase()
    .replaceAll('å', 'aa')
    .replaceAll('æ', 'ae')
    .replaceAll('ø', 'oe')
}

/**
 * `<adressevaelger-search>` — an accessible Danish address autocomplete.
 *
 * A thin Lit wrapper around the headless {@link createAddressSearch} client:
 * debounced input, superseded-search abort, and a WAI-ARIA 1.2 combobox
 * (`role=combobox` + popup `listbox`) with full keyboard support. Selecting a
 * suggestion resolves it by id and fires an `adresse-selected` event.
 *
 * @fires adresse-selected - {@link AdresseSelectedDetail} when a suggestion is chosen.
 * @fires adresse-input - `{ value: string }` on every debounced query change.
 *
 * @cssprop [--adressevaelger-font] - Font family. Defaults to the system UI stack.
 * @cssprop [--adressevaelger-radius=8px] - Corner radius of the input and list.
 * @cssprop [--adressevaelger-border=#c4c9d4] - Border colour.
 * @cssprop [--adressevaelger-accent=#2f6feb] - Accent / active-option colour.
 * @cssprop [--adressevaelger-bg=Canvas] - Background colour.
 * @cssprop [--adressevaelger-fg=CanvasText] - Text colour.
 *
 * @csspart input - The text input.
 * @csspart list - The suggestion listbox.
 * @csspart item - A single suggestion option.
 */
@customElement('adressevaelger-search')
export class AdressevaelgerSearch extends LitElement {
  static override styles = css`
    :host {
      display: block;
      position: relative;
      font-family: var(
        --adressevaelger-font,
        system-ui,
        -apple-system,
        'Segoe UI',
        Roboto,
        sans-serif
      );
      color: var(--adressevaelger-fg, CanvasText);
    }
    .input {
      box-sizing: border-box;
      width: 100%;
      padding: 0.6rem 0.75rem;
      font: inherit;
      color: inherit;
      background: var(--adressevaelger-bg, Canvas);
      border: 1px solid var(--adressevaelger-border, #c4c9d4);
      border-radius: var(--adressevaelger-radius, 8px);
    }
    .input:focus-visible {
      outline: 2px solid var(--adressevaelger-accent, #2f6feb);
      outline-offset: 1px;
    }
    .list {
      list-style: none;
      margin: 0.25rem 0 0;
      padding: 0.25rem;
      position: absolute;
      z-index: 20;
      inset-inline: 0;
      max-height: 20rem;
      overflow-y: auto;
      background: var(--adressevaelger-bg, Canvas);
      border: 1px solid var(--adressevaelger-border, #c4c9d4);
      border-radius: var(--adressevaelger-radius, 8px);
      box-shadow: 0 8px 24px rgb(0 0 0 / 0.12);
    }
    .item {
      padding: 0.5rem 0.6rem;
      border-radius: calc(var(--adressevaelger-radius, 8px) - 3px);
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .item[aria-selected='true'],
    .item:hover {
      background: color-mix(
        in srgb,
        var(--adressevaelger-accent, #2f6feb) 14%,
        transparent
      );
    }
    .item mark {
      background: none;
      color: var(--adressevaelger-accent, #2f6feb);
      font-weight: 600;
    }
    .status {
      padding: 0.5rem 0.6rem;
      opacity: 0.7;
      font-size: 0.9em;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
  `

  /** API access token (required for the component to search). */
  @property({ type: String }) token = ''

  /** Override the API base URL. */
  @property({ type: String, attribute: 'base-url' }) baseUrl?: string

  /** Include preliminary (not-yet-finalized) addresses. */
  @property({ type: Boolean, attribute: 'include-preliminary' })
  includePreliminary = false

  /** Placeholder text for the input. */
  @property({ type: String }) placeholder = 'Søg efter adresse…'

  /** Maximum number of suggestions to show. */
  @property({ type: Number, attribute: 'max-results' }) maxResults = 10

  /** Current input value. */
  @property({ type: String }) value = ''

  @state() private suggestions: AutocompletedAddress[] = []
  @state() private open = false
  @state() private loading = false
  @state() private activeIndex = -1

  #client: AddressSearchClient | null = null
  #clientKey = ''
  #debounceTimer: ReturnType<typeof setTimeout> | null = null
  #controller: AbortController | null = null
  #listboxId = `adressevaelger-listbox-${Math.random().toString(36).slice(2)}`

  override disconnectedCallback(): void {
    super.disconnectedCallback()
    if (this.#debounceTimer !== null) clearTimeout(this.#debounceTimer)
    this.#controller?.abort()
  }

  // Recreate the underlying client (with a fresh cache) whenever a config
  // property changes.
  private client(): AddressSearchClient | null {
    if (!this.token) return null
    const key = `${this.token}|${this.baseUrl ?? ''}|${this.includePreliminary}|${this.maxResults}`
    if (!this.#client || key !== this.#clientKey) {
      this.#client = createAddressSearch({
        token: this.token,
        baseUrl: this.baseUrl,
        includePreliminary: this.includePreliminary,
        maxResults: this.maxResults,
      })
      this.#clientKey = key
    }
    return this.#client
  }

  private onInput(event: Event): void {
    this.value = (event.target as HTMLInputElement).value
    if (this.#debounceTimer !== null) clearTimeout(this.#debounceTimer)
    this.#debounceTimer = setTimeout(() => {
      void this.runSearch(this.value)
    }, 250)
  }

  private async runSearch(term: string): Promise<void> {
    this.dispatchEvent(
      new CustomEvent('adresse-input', { detail: { value: term } }),
    )
    const client = this.client()
    const trimmed = term.trim()
    if (!client || trimmed.length === 0) {
      this.suggestions = []
      this.open = false
      this.loading = false
      this.activeIndex = -1
      return
    }

    // Abort any search still in flight — its results are stale.
    this.#controller?.abort()
    const controller = new AbortController()
    this.#controller = controller

    this.loading = true
    this.open = true
    const results = await client.search(controller.signal, trimmed)
    if (controller.signal.aborted) return

    this.suggestions = results
    this.activeIndex = -1
    this.loading = false
    this.open = true
  }

  private onKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        if (!this.open && this.suggestions.length > 0) {
          this.open = true
          return
        }
        this.move(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        this.move(-1)
        break
      case 'Enter':
        if (this.open && this.activeIndex >= 0) {
          event.preventDefault()
          const picked = this.suggestions[this.activeIndex]
          if (picked) void this.select(picked)
        }
        break
      case 'Escape':
        if (this.open) {
          event.preventDefault()
          this.open = false
          this.activeIndex = -1
        }
        break
      default:
        break
    }
  }

  private move(delta: number): void {
    const count = this.suggestions.length
    if (count === 0) return
    const next = this.activeIndex + delta
    this.activeIndex = ((next % count) + count) % count
    this.open = true
  }

  private async select(suggestion: AutocompletedAddress): Promise<void> {
    this.value = suggestion.titel
    this.open = false
    this.activeIndex = -1
    this.suggestions = []

    const client = this.client()
    let address: FullAddress | null = null
    let houseNumber: HouseNumber | null = null
    if (client) {
      if (suggestion.type === 'adresse') {
        address = await client.getAddressById(suggestion.id)
      } else {
        houseNumber = await client.getHouseNumberById(suggestion.id)
      }
    }

    this.dispatchEvent(
      new CustomEvent<AdresseSelectedDetail>('adresse-selected', {
        detail: { suggestion, address, houseNumber },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private optionId(index: number): string {
    return `${this.#listboxId}-opt-${index}`
  }

  private renderHighlight(titel: string): TemplateResult[] {
    const queryTokens = tokenize(this.value)
      .map(fold)
      .filter((t) => t.length > 0)
    // Split on whitespace and commas, keeping the separators so the rendered
    // string is identical to the original titel.
    const parts = titel.split(/(\s+|,)/)
    return parts.map((part) => {
      const folded = fold(part)
      const matched =
        folded.length > 0 && queryTokens.some((qt) => folded.startsWith(qt))
      return matched ? html`<mark>${part}</mark>` : html`${part}`
    })
  }

  override render(): TemplateResult {
    const showList = this.open && (this.loading || this.suggestions.length > 0)
    const activeId =
      this.activeIndex >= 0 ? this.optionId(this.activeIndex) : undefined

    return html`
      <div
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded=${showList ? 'true' : 'false'}
        aria-owns=${this.#listboxId}
      >
        <input
          class="input"
          part="input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          role="combobox"
          aria-autocomplete="list"
          aria-controls=${this.#listboxId}
          aria-expanded=${showList ? 'true' : 'false'}
          aria-activedescendant=${activeId ?? nothing}
          .value=${this.value}
          placeholder=${this.placeholder}
          @input=${this.onInput}
          @keydown=${this.onKeydown}
        />
      </div>
      ${
        showList
          ? html`
              <ul
                id=${this.#listboxId}
                class="list"
                part="list"
                role="listbox"
                aria-label="Adresseforslag"
              >
                ${
                  this.loading && this.suggestions.length === 0
                    ? html`<li class="status" role="presentation">Søger…</li>`
                    : nothing
                }
                ${this.suggestions.map(
                  (suggestion, index) => html`
                    <li
                      id=${this.optionId(index)}
                      class="item"
                      part="item"
                      role="option"
                      aria-selected=${
                        index === this.activeIndex ? 'true' : 'false'
                      }
                      @mousedown=${(event: Event) => {
                        // Prevent the input losing focus before selection.
                        event.preventDefault()
                        void this.select(suggestion)
                      }}
                      @mouseenter=${() => {
                        this.activeIndex = index
                      }}
                    >
                      ${this.renderHighlight(suggestion.titel)}
                    </li>
                  `,
                )}
              </ul>
            `
          : nothing
      }
      <span class="sr-only" role="status" aria-live="polite">
        ${
          this.open && !this.loading
            ? this.suggestions.length === 0
              ? 'Ingen adresser fundet'
              : `${this.suggestions.length} adresser fundet`
            : ''
        }
      </span>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'adressevaelger-search': AdressevaelgerSearch
  }
}
