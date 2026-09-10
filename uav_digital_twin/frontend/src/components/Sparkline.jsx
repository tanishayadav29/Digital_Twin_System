import { useMemo, useState } from 'react'
import { SPARKLINE_POINTS } from '../config/app.js'
import { LIMIT_LINES } from '../config/sensors.js'
import { formatClock, formatValue } from '../lib/format.js'

// Strip chart of the most recent readings: newest at the right edge. The first
// MIN_POINTS readings are stretched across the full width, then the window
// keeps widening until it holds SPARKLINE_POINTS.
const W = 240
const H = 46
const PAD_Y = 5
const MIN_POINTS = 30
const WINDOW_LABEL = `Last ${Math.round(SPARKLINE_POINTS / 60)} min`

export function Sparkline({ sensor, history, status }) {
  const [hoverIndex, setHoverIndex] = useState(null)

  const chart = useMemo(() => {
    const points = history.slice(-SPARKLINE_POINTS).map((r) => ({ t: r.timestamp, v: r.values[sensor.key] }))
    const values = points.map((p) => p.v).filter((v) => v != null)
    if (values.length < 2) return null

    const windowMin = Math.min(...values)
    const windowMax = Math.max(...values)
    let lo = windowMin
    let hi = windowMax
    // Keep at least 12% of the gauge range in view so normal noise doesn't look like a swing
    const minSpan = (sensor.max - sensor.min) * 0.12
    if (hi - lo < minSpan) {
      const mid = (hi + lo) / 2
      lo = mid - minSpan / 2
      hi = mid + minSpan / 2
    }
    const pad = (hi - lo) * 0.08
    lo -= pad
    hi += pad

    const n = points.length
    const step = W / (Math.max(n, MIN_POINTS) - 1)
    const x = (i) => W - (n - 1 - i) * step
    const y = (v) => PAD_Y + (1 - (v - lo) / (hi - lo)) * (H - 2 * PAD_Y)

    let d = ''
    let penDown = false
    let lastIndex = -1
    points.forEach((p, i) => {
      if (p.v == null) {
        penDown = false
        return
      }
      d += `${penDown ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`
      penDown = true
      lastIndex = i
    })

    const limits = LIMIT_LINES.map(({ key, tone }) => ({ key, tone, value: sensor.limits[key] }))
      .filter((l) => l.value != null && l.value > lo && l.value < hi)
      .map((l) => ({ ...l, y: y(l.value) }))

    return { points, n, step, x, y, d, limits, lastIndex, windowMin, windowMax }
  }, [history, sensor])

  if (!chart) {
    return (
      <div className="spark">
        <div className="spark__plot spark__plot--empty">Waiting for data…</div>
        <div className="spark__caption">
          <span>{WINDOW_LABEL}</span>
        </div>
      </div>
    )
  }

  const hover = hoverIndex != null && hoverIndex < chart.n ? chart.points[hoverIndex] : null
  const last = chart.points[chart.lastIndex]

  function handlePointerMove(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    const px = ((event.clientX - rect.left) / rect.width) * W
    const i = chart.n - 1 - Math.round((W - px) / chart.step)
    setHoverIndex(i < 0 ? null : Math.min(chart.n - 1, i))
  }

  return (
    <div className="spark">
      <div className="spark__plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoverIndex(null)}
          aria-hidden="true"
        >
          {chart.limits.map((l) => (
            <line
              key={l.key}
              className={`spark__limit spark__limit--${l.tone}`}
              x1="0"
              x2={W}
              y1={l.y}
              y2={l.y}
            />
          ))}
          <path className="spark__line" d={chart.d} />
          {hover?.v != null && (
            <line className="spark__cursor" x1={chart.x(hoverIndex)} x2={chart.x(hoverIndex)} y1="0" y2={H} />
          )}
          <circle
            className={`spark__dot spark__dot--${status}`}
            cx={chart.x(chart.lastIndex)}
            cy={chart.y(last.v)}
            r="3.5"
          />
          {hover?.v != null && (
            <circle className="spark__hover-dot" cx={chart.x(hoverIndex)} cy={chart.y(hover.v)} r="3.5" />
          )}
        </svg>
      </div>
      <div className="spark__caption">
        {hover?.v != null ? (
          <>
            <span>{formatClock(hover.t)}</span>
            <span className="spark__caption-value">
              {formatValue(sensor, hover.v)} {sensor.unit}
            </span>
          </>
        ) : (
          <>
            <span>{chart.n >= SPARKLINE_POINTS ? WINDOW_LABEL : `Last ${chart.n} s`}</span>
            <span>
              {formatValue(sensor, chart.windowMin)}–{formatValue(sensor, chart.windowMax)}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
