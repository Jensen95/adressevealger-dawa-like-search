# adressevaelger-enhanced

An enhanced Danish address picker for [adressevaelger.dk][av] (the official
address service and DAWA's successor) — a drop-in
`<adressevaelger-search>` web component **and** a framework-free headless
library, with the relevance ranking, unit expansion and typo tolerance the raw
API leaves out.

Think [Klimadatastyrelsen's official `adressevaelger`][official] component, but
with the search behaviour people actually expect: DAWA-style ranking,
floor/door expansion (`askevænget 9 2 tv` finds the unit), street + city
fallback (`askevænget vejle`), Danish-letter typo folding (`aa`↔`å`), request
caching, and one-request selection resolve.

- **Live demo & docs:** https://jensen95.github.io/adressevealger-dawa-like-search/
- **Benchmark dashboard:** https://jensen95.github.io/adressevealger-dawa-like-search/benchmark.html

> Not affiliated with Klimadatastyrelsen (KDS). This is an independent
> open-source client for the public service.

## Why

The `/adresser/soeg` endpoint only filters on street / house number / postal
code, orders results by **postal code** (not relevance), and ignores floor,
door and city in the query. This library re-ranks and expands the results
client-side.

| Feature                                       | Raw `/adresser/soeg` | Official picker   | **This library**   |
| --------------------------------------------- | -------------------- | ----------------- | ------------------ |
| DAWA-style relevance ranking                  | postal-code order    | postal-code order | ✅                 |
| Floor/door expansion (`9 2 tv`)               | —                    | —                 | ✅                 |
| Street + city fallback (`askevænget vejle`)   | no match             | no match          | ✅                 |
| Danish-letter typo folding (aa↔å, ae↔æ, oe↔ø) | server-side          | server-side       | ✅ client + server |
| Request caching (LRU, shared promises)        | —                    | —                 | ✅                 |
| One-request selection resolve (by-id, cached) | —                    | —                 | ✅                 |
| Framework-free headless API                   | —                    | —                 | ✅                 |
| WAI-ARIA 1.2 combobox component               | —                    | ✅                | ✅                 |

## Install

```sh
npm install adressevaelger-enhanced lit
```

ESM-only, Node ≥ 22. `lit` is a peer of the web component; the headless library
(`adressevaelger-enhanced/lib`) has no runtime dependencies.

## Token & terms

Every request needs a `token` query parameter. **A real token should be
requested from [support@kds.dk][mail]** and used in accordance with the
service's terms. As an implementation detail, the service currently accepts any
token of at least 10 characters — handy for local experiments — but do not rely
on that, and **no token ships with this library**.

DAWA (`api.dataforsyningen.dk`) is scheduled to shut down on **2026-08-17**;
adressevaelger.dk is its replacement.

## Quick start — web component

```html
<script type="module">
  import 'adressevaelger-enhanced'
</script>

<adressevaelger-search token="your-token"></adressevaelger-search>

<script type="module">
  document
    .querySelector('adressevaelger-search')
    .addEventListener('adresse-selected', (event) => {
      const { suggestion, address } = event.detail
      console.log(suggestion.titel, address) // address = resolved FullAddress
    })
</script>
```

Attributes: `token` (required), `base-url`, `include-preliminary`,
`placeholder`, `max-results`. Style it with CSS custom properties and
`::part(input | list | item)` — see the [component docs][docs].

## Quick start — headless library

Usable in any framework, or on the server, with no DOM:

```ts
import { createAddressSearch } from 'adressevaelger-enhanced/lib'

const search = createAddressSearch({ token: 'your-token' })

const controller = new AbortController()
const results = await search.search(controller.signal, 'askevænget 9 2 tv')
// -> ranked AutocompletedAddress[] (at most maxResults, default 10)

const full = await search.getAddressById(results[0].id) // FullAddress | null
search.clearCache()
```

`createAddressSearch({ token, baseUrl?, includePreliminary?, maxResults? })`
returns `{ search, getAddressById, getHouseNumberById, clearCache }`. The
ranking utilities (`rankAddressResults`, `scoreAddress`, `tokenize`,
`tokenMatchScore`, `hasUnmatchedQueryTokens`) are exported too.

See the [docs site][docs] for React and Vue snippets, the full component
reference, an explainer of how the ranking works, and the benchmark
methodology.

## How the search works (short version)

1. Search `/adresser/soeg`; if a street + city query matches nothing, retry
   every trailing-word truncation concurrently and keep the longest match.
2. Expand `husnummer` results that carry unmatched detail (floor/door) and
   street-only `navngivenvejpostnummer` results into concrete addresses —
   concurrently.
3. Dedupe by id, then re-rank against the raw query with token scoring +
   DAWA's same-street tie-break (house number → floor → door → postal code).

All lookups share an LRU promise cache, so duplicate and in-flight requests are
coalesced. Full details on the [docs page][docs].

## Benchmark

An hourly GitHub Action (`.github/workflows/benchmark.yml`) times DAWA vs
adressevaelger.dk (raw search and the full pipeline) over a fixed query set and
appends one JSON line to `history.jsonl` on the `benchmark-data` branch (the
"database" is a git branch). The [dashboard][bench] charts p50 latency and
request counts over time, and marks the 2026-08-17 DAWA shutdown. Run it
locally:

```sh
npm run build && npm run bench
```

## Development

```sh
npm install
npm test          # vitest, no network
npm run lint      # oxlint + prettier
npm run build     # library -> dist/ + custom-elements.json
npm run dev       # demo site dev server
npm run build:site
```

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) © 2026 Morten Jensen.

[av]: https://adressevaelger.dk
[official]: https://github.com/Klimadatastyrelsen/adressevaelger
[docs]: https://jensen95.github.io/adressevealger-dawa-like-search/docs.html
[bench]: https://jensen95.github.io/adressevealger-dawa-like-search/benchmark.html
[mail]: mailto:support@kds.dk
