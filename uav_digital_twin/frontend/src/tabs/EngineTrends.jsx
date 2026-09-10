import { useMemo, useState } from 'react'
import { ChartLegend } from '../components/ChartLegend.jsx'
import { ReadingsTable } from '../components/ReadingsTable.jsx'
import { RelationshipChart } from '../components/RelationshipChart.jsx'
import { TrendChart } from '../components/TrendChart.jsx'
import { TREND_RANGES } from '../config/app.js'
import { RELATIONSHIPS } from '../config/relationships.js'
import { SENSORS } from '../config/sensors.js'
import { formatClock } from '../lib/format.js'
import './EngineTrends.css'

const RANGE_KEY = 'uav-dt:trend-range'

const TREND_LEGEND = [
  { key: 'line', label: 'Reading' },
  { key: 'dot-warning', label: 'Caution reading' },
  { key: 'dot-critical', label: 'Alert reading' },
  { key: 'limit-warning', label: 'Caution limit' },
  { key: 'limit-critical', label: 'Alert limit' },
]

const RELATION_LEGEND = [
  { key: 'fade', label: 'Reading (older = fainter)' },
  { key: 'dot-warning', label: 'Caution reading' },
  { key: 'dot-critical', label: 'Alert reading' },
  { key: 'latest', label: 'Latest reading + recent trail' },
  { key: 'envelope', label: 'Normal operating envelope' },
  { key: 'limit-warning', label: 'Caution limit' },
  { key: 'limit-critical', label: 'Alert limit' },
]

function initialRange() {
  try {
    const saved = localStorage.getItem(RANGE_KEY)
    return TREND_RANGES.find((r) => r.id === saved) ?? TREND_RANGES[0]
  } catch {
    return TREND_RANGES[0]
  }
}

// Readings with start <= time <= end (history is sorted by time)
function windowOf(history, start, end) {
  let lo = 0
  let hi = history.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (history[mid].time < start) lo = mid + 1
    else hi = mid
  }
  let stop = history.length
  while (stop > lo && history[stop - 1].time > end) stop--
  return history.slice(lo, stop)
}

export function EngineTrends({ telemetry, stale, now }) {
  const [range, setRange] = useState(initialRange)
  const [paused, setPaused] = useState(null) // { history, end } frozen when paused
  const [hoverTime, setHoverTime] = useState(null)
  const [tableOpen, setTableOpen] = useState(false)

  const live = telemetry.history
  const latest = live.at(-1)
  // The window ends "now" on the data's own clock, so a stopped stream visibly slides away
  const liveEnd = latest ? latest.time + (latest.receivedAt ? Math.max(0, now - latest.receivedAt) : 0) : now

  const history = paused ? paused.history : live
  const end = paused ? paused.end : liveEnd
  const start = end - range.ms
  const readings = useMemo(() => windowOf(history, start, end), [history, start, end])
  const chartsStale = paused ? false : stale

  const changeRange = (next) => {
    setRange(next)
    try {
      localStorage.setItem(RANGE_KEY, next.id)
    } catch {
      // storage blocked - the choice just won't persist
    }
  }

  const togglePause = () => setPaused((current) => (current ? null : { history: live, end: liveEnd }))

  return (
    <div className="trends">
      <div className="trends__toolbar">
        <div className="segmented" role="group" aria-label="Time range">
          {TREND_RANGES.map((r) => (
            <button key={r.id} type="button" aria-pressed={r.id === range.id} onClick={() => changeRange(r)}>
              {r.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`btn btn--icon${paused ? ' btn--accent' : ''}`}
          aria-pressed={Boolean(paused)}
          onClick={togglePause}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            {paused ? (
              <path d="M3 1.6v8.8L10.4 6z" />
            ) : (
              <>
                <rect x="2" y="1.5" width="2.8" height="9" rx="1" />
                <rect x="7.2" y="1.5" width="2.8" height="9" rx="1" />
              </>
            )}
          </svg>
          {paused ? 'Resume live' : 'Pause'}
        </button>
        <span className="trends__meta">
          {paused
            ? `Paused at ${formatClock(paused.end)} · new readings are still being recorded`
            : `${readings.length} readings in view`}
        </span>
      </div>

      <section aria-labelledby="trends-title">
        <div className="section-head">
          <div>
            <h2 id="trends-title" className="section-title">
              Parameter trends
            </h2>
            <p className="section-sub">Hover any chart to read every parameter at that moment.</p>
          </div>
          <ChartLegend items={TREND_LEGEND} />
        </div>
        <div className="trend-grid">
          {SENSORS.map((sensor) => (
            <TrendChart
              key={sensor.key}
              sensor={sensor}
              readings={readings}
              start={start}
              end={end}
              stale={chartsStale}
              hoverTime={hoverTime}
              onHover={setHoverTime}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="relations-title">
        <div className="section-head">
          <div>
            <h2 id="relations-title" className="section-title">
              Parameter relationships
            </h2>
            <p className="section-sub">Each dot is one reading from the selected time range.</p>
          </div>
        </div>
        <div className="relation-grid">
          <aside className="card relation-guide" aria-label="How to read the relationship charts">
            <h3>Reading these charts</h3>
            <p>
              A healthy engine sits as a tight cluster inside the green envelope. A fault pulls points out of it,
              and the direction hints at the cause. Each chart's note says what to look for.
            </p>
            <ChartLegend items={RELATION_LEGEND} vertical />
            <p className="relation-guide__note">
              <strong>r</strong> is the correlation from −1 to +1: how strongly the two parameters move together.
            </p>
          </aside>
          {RELATIONSHIPS.map((relation) => (
            <RelationshipChart key={relation.id} relation={relation} readings={readings} stale={chartsStale} />
          ))}
        </div>
      </section>

      <details className="card readings-panel" onToggle={(event) => setTableOpen(event.currentTarget.open)}>
        <summary>
          Readings table <span>latest {Math.min(60, readings.length)} readings in view, newest first</span>
        </summary>
        {tableOpen && <ReadingsTable readings={readings} />}
      </details>
    </div>
  )
}
