import { memo, useMemo, useState } from 'react'
import { LIMIT_LINES, SENSOR_BY_KEY, sensorStatus, worstStatus } from '../config/sensors.js'
import { useElementWidth } from '../hooks/useElementWidth.js'
import { formatClock, formatValue } from '../lib/format.js'
import { dotPath, formatTick, linear, niceTicks, pearson, sensorDomain } from '../lib/scale.js'
import { StatusLight } from './StatusLight.jsx'

const HEIGHT = 290
const M = { top: 26, right: 16, bottom: 40, left: 54 }
const TRAIL_POINTS = 6
const RECENT_MS = 30_000
const MID_MS = 120_000
const HIT_RADIUS = 24
const LAYERS = ['old', 'mid', 'recent', 'warning', 'critical'] // draw order: out-of-limit points on top

function axisTitle(sensor) {
  return sensor.unit.toLowerCase() === sensor.code.toLowerCase() ? sensor.code : `${sensor.code} (${sensor.unit})`
}

function formatCorrelation(r) {
  const rounded = Math.abs(r).toFixed(2)
  if (rounded === '0.00') return '0.00'
  return `${r > 0 ? '+' : '−'}${rounded}`
}

function describeCorrelation(r) {
  const size = Math.abs(r)
  if (size < 0.3) return 'weak'
  return `${size < 0.7 ? 'moderate' : 'strong'} ${r > 0 ? 'positive' : 'negative'}`
}

function limitLines(sensor, scale, [lo, hi]) {
  return LIMIT_LINES.filter(({ key }) => sensor.limits[key] != null && sensor.limits[key] > lo && sensor.limits[key] < hi)
    .map((l) => ({ ...l, pos: scale(sensor.limits[l.key]) }))
}

// Scatter of two parameters over the selected time range, with the normal
// operating envelope, limit lines and the latest reading's recent trail.
export const RelationshipChart = memo(function RelationshipChart({ relation, readings, stale }) {
  const [plotRef, width] = useElementWidth()
  const [hoverTime, setHoverTime] = useState(null)
  const xs = SENSOR_BY_KEY[relation.x]
  const ys = SENSOR_BY_KEY[relation.y]

  const chart = useMemo(() => {
    if (!width) return null
    const points = readings.filter((r) => r.values[xs.key] != null && r.values[ys.key] != null)
    const plotW = Math.max(10, width - M.left - M.right)
    const plotH = HEIGHT - M.top - M.bottom
    const xValues = points.map((p) => p.values[xs.key])
    const yValues = points.map((p) => p.values[ys.key])
    const xDomain = sensorDomain(xs, xValues)
    const yDomain = sensorDomain(ys, yValues)
    const x = linear(xDomain, [M.left, M.left + plotW])
    const y = linear(yDomain, [M.top + plotH, M.top])
    const newest = points.at(-1)?.time ?? 0

    const layers = Object.fromEntries(LAYERS.map((layer) => [layer, '']))
    const coords = points.map((p, i) => {
      const px = x(xValues[i])
      const py = y(yValues[i])
      const status = worstStatus([sensorStatus(xs, xValues[i]), sensorStatus(ys, yValues[i])])
      const outOfLimits = status === 'warning' || status === 'critical'
      const age = newest - p.time
      const layer = outOfLimits ? status : age <= RECENT_MS ? 'recent' : age <= MID_MS ? 'mid' : 'old'
      layers[layer] += dotPath(px, py, outOfLimits ? 3.5 : 3)
      return { px, py, status }
    })

    const trail = coords
      .slice(-TRAIL_POINTS)
      .map((c, i) => `${i ? 'L' : 'M'}${c.px.toFixed(1)} ${c.py.toFixed(1)}`)
      .join('')

    // Normal envelope: inside the caution limits of both parameters
    const ex0 = x(Math.max(xDomain[0], xs.limits.warnLow ?? -Infinity))
    const ex1 = x(Math.min(xDomain[1], xs.limits.warnHigh ?? Infinity))
    const ey0 = y(Math.min(yDomain[1], ys.limits.warnHigh ?? Infinity))
    const ey1 = y(Math.max(yDomain[0], ys.limits.warnLow ?? -Infinity))

    return {
      plotW,
      plotH,
      x,
      y,
      points,
      coords,
      layers,
      trail,
      envelope: { x: ex0, y: ey0, width: Math.max(0, ex1 - ex0), height: Math.max(0, ey1 - ey0) },
      xLimits: limitLines(xs, x, xDomain),
      yLimits: limitLines(ys, y, yDomain),
      r: pearson(xValues, yValues),
      xTicks: niceTicks(xDomain[0], xDomain[1], Math.max(2, Math.floor(plotW / 80))),
      yTicks: niceTicks(yDomain[0], yDomain[1], 5),
    }
  }, [width, readings, xs, ys])

  const count = chart?.points.length ?? 0
  const latest = count ? chart.points[count - 1] : null
  const latestCoords = count ? chart.coords[count - 1] : null
  const status = stale || !latestCoords ? 'nodata' : latestCoords.status

  const hoverIndex = count && hoverTime != null ? chart.points.findIndex((p) => p.time === hoverTime) : -1
  const hovered = hoverIndex >= 0 ? chart.points[hoverIndex] : null
  const hoveredCoords = hoverIndex >= 0 ? chart.coords[hoverIndex] : null

  function handlePointerMove(event) {
    if (!count) return
    const rect = event.currentTarget.getBoundingClientRect()
    const mx = event.clientX - rect.left
    const my = event.clientY - rect.top
    let best = -1
    let bestDistance = HIT_RADIUS * HIT_RADIUS
    chart.coords.forEach((c, i) => {
      const d = (c.px - mx) ** 2 + (c.py - my) ** 2
      if (d <= bestDistance) {
        best = i
        bestDistance = d
      }
    })
    setHoverTime(best >= 0 ? chart.points[best].time : null)
  }

  function handleKeyDown(event) {
    if (!count) return
    if (event.key === 'Escape') {
      setHoverTime(null)
      return
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const from = hoverIndex >= 0 ? hoverIndex : count
    const next = Math.min(count - 1, Math.max(0, from + (event.key === 'ArrowLeft' ? -1 : 1)))
    setHoverTime(chart.points[next].time)
  }

  const ariaLabel = latest
    ? `${relation.title}, ${count} readings. Latest ${formatValue(ys, latest.values[ys.key])} ${ys.unit} at ` +
      `${formatValue(xs, latest.values[xs.key])} ${xs.unit}. Use left and right arrow keys to step through readings.`
    : `${relation.title}: no readings yet`

  const tip = hovered && {
    left: Math.min(Math.max(hoveredCoords.px, 72), width - 72),
    top: hoveredCoords.py,
    below: hoveredCoords.py < M.top + 64,
  }

  return (
    <article className={`card relation relation--${status}`}>
      <header className="relation__head">
        <div>
          <h3 className="relation__title">{relation.title}</h3>
          <p className="relation__desc">{relation.description}</p>
        </div>
        <StatusLight status={status} />
      </header>

      <div
        ref={plotRef}
        className="relation__plot"
        tabIndex={0}
        role="img"
        aria-label={ariaLabel}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverTime(null)}
        onKeyDown={handleKeyDown}
        onBlur={() => setHoverTime(null)}
      >
        {chart && count < 2 && <div className="chart-empty">Waiting for data…</div>}
        {chart && count >= 2 && (
          <svg width={width} height={HEIGHT} aria-hidden="true">
            <rect className="relation__envelope" {...chart.envelope} />

            {chart.yTicks.ticks.map((v) => {
              const py = chart.y(v)
              return (
                <g key={`y${v}`}>
                  <line className="chart-grid" x1={M.left} x2={M.left + chart.plotW} y1={py} y2={py} />
                  <text className="chart-tick" x={M.left - 8} y={py} dy="0.32em" textAnchor="end">
                    {formatTick(v, chart.yTicks.step)}
                  </text>
                </g>
              )
            })}
            {chart.xTicks.ticks.map((v) => {
              const px = chart.x(v)
              return (
                <g key={`x${v}`}>
                  <line className="chart-grid" x1={px} x2={px} y1={M.top} y2={M.top + chart.plotH} />
                  <text className="chart-tick" x={px} y={M.top + chart.plotH + 16} textAnchor="middle">
                    {formatTick(v, chart.xTicks.step)}
                  </text>
                </g>
              )
            })}

            <line className="chart-axis" x1={M.left} x2={M.left + chart.plotW} y1={M.top + chart.plotH} y2={M.top + chart.plotH} />
            <line className="chart-axis" x1={M.left} x2={M.left} y1={M.top} y2={M.top + chart.plotH} />

            {chart.xLimits.map((l) => (
              <line
                key={`x-${l.key}`}
                className={`chart-limit chart-limit--${l.tone}`}
                x1={l.pos}
                x2={l.pos}
                y1={M.top}
                y2={M.top + chart.plotH}
              />
            ))}
            {chart.yLimits.map((l) => (
              <line
                key={`y-${l.key}`}
                className={`chart-limit chart-limit--${l.tone}`}
                x1={M.left}
                x2={M.left + chart.plotW}
                y1={l.pos}
                y2={l.pos}
              />
            ))}

            <text className="axis-title" x={M.left} y={M.top - 12}>
              {axisTitle(ys)}
            </text>
            <text className="axis-title" x={M.left + chart.plotW / 2} y={HEIGHT - 4} textAnchor="middle">
              {axisTitle(xs)}
            </text>

            {LAYERS.map(
              (layer) =>
                chart.layers[layer] && (
                  <path key={layer} className={`chart-dot chart-dot--${layer}`} d={chart.layers[layer]} />
                ),
            )}

            <path className="relation__trail" d={chart.trail} />
            {!stale && <circle className="relation__halo" cx={latestCoords.px} cy={latestCoords.py} r="10" />}
            <circle className="relation__latest" cx={latestCoords.px} cy={latestCoords.py} r="5" />

            {hovered && <circle className="relation__hover-ring" cx={hoveredCoords.px} cy={hoveredCoords.py} r="8" />}
          </svg>
        )}

        {tip && (
          <div className={`scatter-tip${tip.below ? ' scatter-tip--below' : ''}`} style={{ left: tip.left, top: tip.top }}>
            <time className="scatter-tip__time" dateTime={hovered.timestamp}>
              {formatClock(hovered.timestamp)}
            </time>
            <span className="scatter-tip__row">
              <strong>{formatValue(ys, hovered.values[ys.key])}</strong> {ys.unit}
              <span className="scatter-tip__code">{ys.code}</span>
            </span>
            <span className="scatter-tip__row">
              <strong>{formatValue(xs, hovered.values[xs.key])}</strong> {xs.unit}
              <span className="scatter-tip__code">{xs.code}</span>
            </span>
          </div>
        )}
      </div>

      <footer className="relation__foot">
        <span className="relation__corr">
          Correlation{' '}
          {chart?.r == null ? (
            <strong>—</strong>
          ) : (
            <>
              <strong>r = {formatCorrelation(chart.r)}</strong>{' '}
              · {describeCorrelation(chart.r)}
            </>
          )}
        </span>
        <p className="relation__hint">{relation.hint}</p>
      </footer>
    </article>
  )
})
