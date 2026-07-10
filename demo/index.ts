// Landing-page demo wiring: registers the component and shows the resolved
// selection. Uses the source component directly (Vite serves TS) and the demo
// token placeholder.
import { AdressevaelgerSearch } from '../src/index'
import type { AdresseSelectedDetail } from '../src/index'
import { DEMO_TOKEN } from './demo-token'

// Reference the class so the bundler retains its module — evaluating it runs the
// @customElement decorator that registers <adressevaelger-search>. (Consumers of
// the published package get this via the `sideEffects` whitelist in
// package.json; the src-based demo build needs the explicit reference.)
if (!customElements.get('adressevaelger-search')) {
  customElements.define('adressevaelger-search', AdressevaelgerSearch)
}

const picker = document.querySelector('adressevaelger-search')
const selected = document.querySelector<HTMLElement>('#selected')

if (picker) {
  picker.setAttribute('token', DEMO_TOKEN)
  picker.addEventListener('adresse-selected', (event) => {
    const detail = (event as CustomEvent<AdresseSelectedDetail>).detail
    const houseNumber = detail.houseNumber ?? detail.address?.husnummer ?? null
    if (selected) {
      selected.textContent = JSON.stringify(
        {
          titel: detail.suggestion.titel,
          id: detail.suggestion.id,
          betegnelse:
            detail.address?.adressebetegnelse ??
            houseNumber?.adgangsadressebetegnelse ??
            null,
          koordinater: houseNumber?.adgangspunkt?.koordinater ?? null,
        },
        null,
        2,
      )
    }
  })
}
