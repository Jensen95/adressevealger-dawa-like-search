// Package entry: re-exports the headless library and registers the web
// component as a side effect (importing this module defines
// <adressevaelger-search>). Import from `@jensen95/adressevaelger/lib` alone if
// you only want the headless search.
export * from './lib/index'
export {
  AdressevaelgerSearch,
  type AdresseSelectedDetail,
} from './components/adressevaelger-search'
