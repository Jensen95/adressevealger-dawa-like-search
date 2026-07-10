// Benchmark dashboard: fetches ./data/history.jsonl (appended hourly on the
// benchmark-data branch), renders latency-over-time and request-count charts
// plus latest-run tables. Chart.js is bundled by Vite — no runtime CDN.
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  CategoryScale,
  Tooltip,
  Legend,
  type ChartDataset,
  type Plugin,
} from 'chart.js'
import 'chartjs-adapter-date-fns'

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  CategoryScale,
  Tooltip,
  Legend,
)

interface ScenarioStats {
  p50: number | null
  mean: number | null
  meanRequests: number | null
  failures: number
}

interface PerQuery {
  query: string
  dawaMs: number | null
  rawMs: number | null
  fullMs: number | null
  fullRequests: number | null
}

interface Run {
  timestamp: string
  results: Record<string, ScenarioStats>
  perQuery: PerQuery[]
}

const SCENARIOS = [
  { key: 'dawa', label: 'DAWA', color: '#d97706' },
  { key: 'adressevaelgerRaw', label: 'adressevaelger (raw)', color: '#2f6feb' },
  {
    key: 'adressevaelgerFull',
    label: 'adressevaelger (full)',
    color: '#16a34a',
  },
] as const

const DAWA_SHUTDOWN = new Date('2026-08-17T00:00:00Z')

const status = document.querySelector<HTMLElement>('#status')!
const dashboard = document.querySelector<HTMLElement>('#dashboard')!

function setStatus(message: string): void {
  status.textContent = message
  status.hidden = false
}

function textColor(): string {
  return getComputedStyle(document.body).getPropertyValue('color') || '#888'
}

async function loadHistory(): Promise<Run[]> {
  const url = new URL('data/history.jsonl', location.href)
  let text: string
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    text = await response.text()
  } catch {
    return []
  }
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Run]
      } catch {
        return []
      }
    })
}

// Draws a dashed vertical marker at the DAWA shutdown date when it falls within
// the plotted time range. Kept dependency-free (no annotation plugin).
const shutdownMarker: Plugin = {
  id: 'shutdownMarker',
  afterDraw(chart) {
    const scale = chart.scales.x
    if (!scale) return
    const x = scale.getPixelForValue(DAWA_SHUTDOWN.getTime())
    if (x < scale.left || x > scale.right) return
    const { ctx, chartArea } = chart
    ctx.save()
    ctx.strokeStyle = '#dc2626'
    ctx.setLineDash([5, 4])
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x, chartArea.top)
    ctx.lineTo(x, chartArea.bottom)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#dc2626'
    ctx.font = '11px system-ui, sans-serif'
    ctx.fillText('DAWA shutdown', x + 4, chartArea.top + 12)
    ctx.restore()
  },
}

function renderLatencyChart(runs: Run[]): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#latencyChart')!
  const labels = runs.map((run) => new Date(run.timestamp).getTime())
  const datasets: ChartDataset<'line'>[] = SCENARIOS.map((scenario) => ({
    label: `${scenario.label} p50`,
    data: runs.map((run) => run.results[scenario.key]?.p50 ?? null),
    borderColor: scenario.color,
    backgroundColor: scenario.color,
    spanGaps: false,
    tension: 0.25,
    pointRadius: runs.length > 60 ? 0 : 2,
  }))

  new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          type: 'time',
          time: { tooltipFormat: 'yyyy-MM-dd HH:mm' },
          ticks: { color: textColor() },
        },
        y: {
          title: { display: true, text: 'ms', color: textColor() },
          ticks: { color: textColor() },
          beginAtZero: true,
        },
      },
      plugins: { legend: { labels: { color: textColor() } } },
    },
    plugins: [shutdownMarker],
  })
}

function renderRequestsChart(runs: Run[]): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#requestsChart')!
  const labels = runs.map((run) => new Date(run.timestamp).getTime())
  new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'mean requests / query (full pipeline)',
          data: runs.map(
            (run) => run.results.adressevaelgerFull?.meanRequests ?? null,
          ),
          borderColor: '#16a34a',
          backgroundColor: '#16a34a',
          tension: 0.25,
          pointRadius: runs.length > 60 ? 0 : 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'time',
          time: { tooltipFormat: 'yyyy-MM-dd HH:mm' },
          ticks: { color: textColor() },
        },
        y: { beginAtZero: true, ticks: { color: textColor() } },
      },
      plugins: { legend: { labels: { color: textColor() } } },
    },
    plugins: [shutdownMarker],
  })
}

function fmt(value: number | null): string {
  return value === null ? '—' : String(value)
}

function renderLatest(run: Run): void {
  document.querySelector('#latestMeta')!.textContent =
    `Run at ${new Date(run.timestamp).toLocaleString()}`

  const body = document.querySelector('#latestBody')!
  body.replaceChildren()
  for (const scenario of SCENARIOS) {
    const stats = run.results[scenario.key]
    const row = document.createElement('tr')
    row.innerHTML =
      `<td>${scenario.label}</td>` +
      `<td>${fmt(stats?.p50 ?? null)}</td>` +
      `<td>${fmt(stats?.mean ?? null)}</td>` +
      `<td>${fmt(stats?.meanRequests ?? null)}</td>` +
      `<td>${stats?.failures ?? '—'}</td>`
    body.append(row)
  }

  const perQueryBody = document.querySelector('#perQueryBody')!
  perQueryBody.replaceChildren()
  for (const entry of run.perQuery) {
    const row = document.createElement('tr')
    row.innerHTML =
      `<td><code>${entry.query}</code></td>` +
      `<td>${fmt(entry.dawaMs)}</td>` +
      `<td>${fmt(entry.rawMs)}</td>` +
      `<td>${fmt(entry.fullMs)}</td>` +
      `<td>${fmt(entry.fullRequests)}</td>`
    perQueryBody.append(row)
  }
}

async function main(): Promise<void> {
  const runs = await loadHistory()
  if (runs.length === 0) {
    setStatus(
      'No benchmark runs yet. The hourly workflow will populate this once it has run at least once.',
    )
    return
  }
  status.hidden = true
  dashboard.hidden = false
  renderLatencyChart(runs)
  renderRequestsChart(runs)
  renderLatest(runs[runs.length - 1]!)
}

void main()
