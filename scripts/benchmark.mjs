// Benchmark: adressevaelger.dk (raw single search + the enhanced pipeline) vs
// DAWA autocomplete, over a fixed query set. Plain Node, no deps beyond stdlib
// and the BUILT library in dist/ (run `npm run build` first). Prints one compact
// JSON object to stdout; the hourly workflow appends it to history.jsonl.
//
// DAWA (api.dataforsyningen.dk) is scheduled to shut down 2026-08-17. Its
// failures are recorded (null timings + a failure count) rather than crashing
// the run, so the published history captures the shutdown instead of going dark.
import { createAddressSearch } from '../dist/lib/index.js'

// A demo token: the service accepts any token of >=10 characters today, but that
// is an implementation detail. Request a real token from support@kds.dk for
// anything beyond experimentation and honour the service's terms.
const DEMO_TOKEN = 'demo-token-0000'
const ADRESSEVAELGER_BASE = 'https://adressevaelger.dk'
const DAWA_BASE = 'https://api.dataforsyningen.dk'

const ITERATIONS = 3
const POLITE_GAP_MS = 100

// A representative mix: floor/door units, plain house numbers, a street+city
// query DAWA understood but the raw search does not, full canonical strings,
// and a street-only query.
const QUERIES = [
  'askevænget 9 2 tv',
  'brogårdsvej 102',
  'vestergade 41a 2 tv',
  'askevænget vejle',
  'strandlodsvej 25m københavn s',
  'Askevænget 9, 2. tv, 7100 Vejle',
  'Brogårdsvej 102, 2820 Gentofte',
  'Vestergade 41A, 1. th, 8000 Aarhus C',
  'rentemestervej 8 københavn nv',
  'nørregade',
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function percentile(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  )
  return Math.round(sorted[index] * 10) / 10
}

function mean(values) {
  if (values.length === 0) return null
  return (
    Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
  )
}

// --- scenario runners: each returns the number of HTTP requests it made ---

async function dawaSearch(query) {
  const url = `${DAWA_BASE}/adresser?autocomplete=true&per_side=8&q=${encodeURIComponent(query)}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`DAWA HTTP ${response.status}`)
  await response.json()
  return 1
}

async function adressevaelgerRaw(query) {
  const url = `${ADRESSEVAELGER_BASE}/adresser/soeg?tekst=${encodeURIComponent(query)}&token=${DEMO_TOKEN}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`adressevaelger HTTP ${response.status}`)
  const body = await response.json()
  if (!Array.isArray(body.fund)) throw new Error('malformed response')
  return 1
}

const fullClient = createAddressSearch({ token: DEMO_TOKEN })

async function adressevaelgerFull(query) {
  fullClient.clearCache()
  // Count the requests the pipeline issues by wrapping the global fetch.
  let requests = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = (...args) => {
    requests++
    return originalFetch(...args)
  }
  try {
    const results = await fullClient.search(new AbortController().signal, query)
    if (!Array.isArray(results)) throw new Error('pipeline returned non-array')
    return requests
  } finally {
    globalThis.fetch = originalFetch
  }
}

const SCENARIOS = {
  dawa: dawaSearch,
  adressevaelgerRaw,
  adressevaelgerFull,
}

async function run() {
  // samples[scenario][query] = [{ ms, ok, requests }, ...]
  const samples = {}
  for (const scenario of Object.keys(SCENARIOS)) {
    samples[scenario] = Object.fromEntries(QUERIES.map((q) => [q, []]))
  }

  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    for (const query of QUERIES) {
      for (const [scenario, runner] of Object.entries(SCENARIOS)) {
        const start = performance.now()
        try {
          const requests = await runner(query)
          samples[scenario][query].push({
            ms: performance.now() - start,
            ok: true,
            requests,
          })
        } catch {
          samples[scenario][query].push({ ms: null, ok: false, requests: 0 })
        }
        await sleep(POLITE_GAP_MS)
      }
    }
  }

  // Aggregate per scenario.
  const results = {}
  for (const scenario of Object.keys(SCENARIOS)) {
    const all = QUERIES.flatMap((q) => samples[scenario][q])
    const okTimes = all.filter((s) => s.ok).map((s) => s.ms)
    const okRequests = all.filter((s) => s.ok).map((s) => s.requests)
    results[scenario] = {
      p50: percentile(okTimes, 50),
      mean: mean(okTimes),
      meanRequests: mean(okRequests),
      failures: all.filter((s) => !s.ok).length,
    }
  }

  // Compact per-query view: median latency per scenario (null when all failed).
  const perQuery = QUERIES.map((query) => {
    const medianFor = (scenario) =>
      percentile(
        samples[scenario][query].filter((s) => s.ok).map((s) => s.ms),
        50,
      )
    return {
      query,
      dawaMs: medianFor('dawa'),
      rawMs: medianFor('adressevaelgerRaw'),
      fullMs: medianFor('adressevaelgerFull'),
      fullRequests: percentile(
        samples.adressevaelgerFull[query]
          .filter((s) => s.ok)
          .map((s) => s.requests),
        50,
      ),
    }
  })

  return { timestamp: new Date().toISOString(), results, perQuery }
}

run()
  .then((output) => {
    process.stdout.write(JSON.stringify(output) + '\n')
  })
  .catch((error) => {
    console.error('Benchmark failed:', error)
    process.exitCode = 1
  })
