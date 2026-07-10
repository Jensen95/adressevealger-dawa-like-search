# Contributing

Thanks for your interest in improving `@jensen95/adressevaelger`.

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

## Commits & branches

This repo follows the [Conventional Commits](https://www.conventionalcommits.org)
and [Conventional Branches](https://conventional-branch.github.io) standards, and
CI enforces both on every pull request.

- **Commit messages**: `<type>[optional scope]: <description>` — e.g.
  `feat: add keyboard navigation`, `fix(ranking): break score ties by id`,
  `chore(deps): bump vite`. A local `commit-msg` hook (via Husky + commitlint)
  checks each message as you commit; run `npm install` once to activate it.
- **Branch names**: `<type>/<description>` using the same types — e.g.
  `feature/floor-expansion`, `fix/debounce-race`, `chore/upgrade-vite`.

## Live API & token

Manual testing against the live service needs a `token`. Request one from
support@kds.dk and honour the service's terms. Never commit a token.

## Releasing

CI (`.github/workflows/ci.yml`) runs lint, tests and the build on every push and
PR. Publishing is manual: bump the version, `npm run build`, `npm publish`.
