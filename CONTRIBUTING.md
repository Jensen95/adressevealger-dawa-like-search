# Contributing

Thanks for your interest in improving `adressevaelger-enhanced`.

## Getting started

```sh
npm install
npm test          # vitest, runs fully offline
npm run lint      # oxlint + prettier --check
npm run build     # builds dist/ and regenerates custom-elements.json
npm run dev       # demo site at http://localhost:5173
```

Requires Node ≥ 22 and npm.

## Guidelines

- **Tests must pass offline.** Unit tests mock `fetch`; do not add tests that
  hit the network, and avoid large JSON fixtures — keep the repo lean.
- **Keep it typed and formatted.** `npm run lint` must be clean; run
  `npm run format` to apply Prettier.
- **Two entry points.** The headless library (`src/lib`) must stay usable
  without the component (`src/components`). Don't import DOM/Lit into `src/lib`.
- **Match the API's Danish domain naming** (`vejnavn`, `husnr`, `etage`, `dør`)
  where it reflects the upstream data model.
- Small, focused PRs with a clear description are easiest to review. Please
  open an issue first for larger changes.

## Live API & token

Manual testing against the live service needs a `token`. Request one from
support@kds.dk and honour the service's terms. Never commit a token.

## Releasing

CI (`.github/workflows/ci.yml`) runs lint, tests and the build on every push and
PR. Publishing is manual: bump the version, `npm run build`, `npm publish`.
