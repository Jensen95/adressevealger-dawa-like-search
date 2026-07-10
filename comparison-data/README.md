# Recorded DAWA ↔ adressevælger comparison data

Frozen recordings of the legacy **DAWA** autocomplete
(`api.dataforsyningen.dk`, shut down **2026-08-17**) side by side with
**adressevaelger.dk** responses, captured in July 2026 while both services
were live. After the DAWA shutdown these recordings are the permanent record
of its behavior — they cannot be re-created.

## `quality-fixtures/` — 21 hand-picked query cases

One JSON per query case. Shape:

```jsonc
{
  "query": "askevænget 9 2 tv", // what the user typed
  "recordedAt": "…",
  "dawa": {
    "texts": ["Askevænget 9, 2. tv, 2830 Virum", "…"], // DAWA's ordered answer
    "ids": ["…"],
    "count": 2
  },
  "adressevaelger": {
    // every request the enhanced-search pipeline made for this query,
    // keyed by decoded path?params (token stripped, params sorted)
    "/adresser/soeg?tekst=askevænget 9 2 tv": {
      /* raw response body */
    }
  }
}
```

The cases cover the motivating scenarios: unpunctuated floor/door queries
("askevænget 9 2 tv"), street + city with no postal code, progressive typing
of Brogårdsvej 102 in Gentofte, full canonical texts, numeric doors,
abbreviated adresseringsvejnavne, and supplerende bynavne.

## `progressive-fixtures/` — 52 per-keystroke typing sessions

One JSON per address. For each address, the realistic typing progression
(street prefix → full street → house number digit by digit → floor/door →
full canonical text) with **DAWA's ordered answer at every keystroke stage**
plus the union of every adressevaelger response the pipeline made across the
session (recorded warm-cache, i.e. cache cleared once per address):

```jsonc
{
  "tekst": "Brogårdsvej 102, 2820 Gentofte",
  "dawaId": "…",
  "recordedAt": "…",
  "stages": [{ "stage": "brog", "dawa": ["…ordered DAWA texts…"] }],
  "adressevaelger": { "…key…": { /* raw response body */ } }
}
```

## Provenance

Recorded by the comparison suites in
`monthio/smartcheck-flow-orchestrator-client-app` (see that repo's
`src/app/api/addressComparison/` — the recorders are
`recordAddressFixtures.test.ts` and `recordProgressiveFixtures.test.ts`; the
fixtures were moved here rather than committed there). Measured against these
recordings, the enhanced pipeline in this repository ranks the intended
address #1 at the full-text stage for **52/52** addresses (MRR 1.000) and
reaches the top-5 on average only **+0.33 keystrokes** later than DAWA, with
an average DAWA-parity of **0.833** over the 21 quality cases.
