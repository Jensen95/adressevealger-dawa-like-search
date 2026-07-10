// Headless, framework-free entry point. Import from `@jensen95/adressevaelger/lib`
// to use the search pipeline and ranking utilities without the web component.
export {
  createAddressSearch,
  DEFAULT_BASE_URL,
  DEFAULT_MAX_RESULTS,
} from './addressApi'
export type {
  AddressSearchClient,
  CreateAddressSearchOptions,
  AddressSearchResult,
  AdresseSearchResult,
  HusnummerSearchResult,
  VejnavnSearchResult,
  NavngivenVejPostnummerSearchResult,
  AutocompletedAddress,
  FullAddress,
  HouseNumber,
  Adgangspunkt,
  Postnummer,
  NavngivenVej,
  NavngivenVejKommunedel,
  SupplerendeBynavn,
} from './addressApi'
export {
  rankAddressResults,
  scoreAddress,
  tokenize,
  tokenMatchScore,
  hasUnmatchedQueryTokens,
} from './addressRanking'
