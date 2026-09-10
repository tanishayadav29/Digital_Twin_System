import { memo, useId, useMemo } from 'react'
import { LIMIT_LINES, sensorStatus } from '../config/sensors.js'
import { useElementWidth } from '../hooks/useElementWidth.js'
import { formatClock, formatValue } from '../lib/format.js'
import {
  dotPath,
  formatTick,
  formatTimeTick,
  linear,
  nearestIndex,
  niceTicks,
  sensorDomain,
  timeTicks,
} from '../lib/scale.js'
import { StatusLight } from './StatusLight.jsx'

const HEIGHT = 168
const M = { top: 10, right: 14, bottom: 24, left: 48 }
const GAP_MS = 3500 // break the line when readings stop for longer than this

// One parameter over time. All trend charts share hoverTime, so hovering one
// shows every parameter's value at that same moment.
export const TrendChart = memo(function TrendChart({ sensor, readings, start, end, stale, hoverTime, onHover }) {
  const [plotRef, width] = useElementWidth()
  const clipId = `trend-clip-${useId().replace(/[^\w-]/g, '')}`

  const chart = useMemo(() => {
    if (!width) return null
    const plotW = Math.max(10, width - M.left - M.right)
    const plotH = HEIGHT - M.top - M.bottom
    const values = []
    for (const r of readings) if (r.values[sensor.key] != null) values.push(r.values[sensor.key])

    const [lo, hi] = sensorDomain(sensor, values)
    const x = linear([start, end], [M.left, M.left + plotW])
    const y = linear([lo, hi], [M.top + plotH, M.top])

    let line = ''
    let warning = ''
    let critical = ''
    let prevTime = null
    for (const r of readings) {
      const v = r.values[sensor.key]
      if (v == null) {
        prevTime = null
        continue
      }
      const px = x(r.time)
      const py = y(v)
      line += `${prevTime != null && r.time - prevTime <= GAP_MS ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`
      prevTime = r.time
      const status = sensorStatus(sensor, v)
      if (status === 'warning') warning += dotPath(px, py, 2.5)
      else if (status === 'critical') critical += dotPath(px, py, 3)
    }

    const limits = LIMIT_LINES.filter(({ key }) => sensor.limits[key] != null && sensor.limits[key] > lo && sensor.limits[key] < hi)
      .map((l) => ({ ...l, y: y(sensor.limits[l.key]) }))

    const stats = values.length
      ? {
          min: Math.min(...values),
          max: Math.max(...values),
          avg: values.reduce((sum, v) => sum + v, 0) / values.length,
        }
      : null

    return {
      plotW,
      plotH,
      x,
      y,
      line,
      warning,
      critical,
      limits,
      stats,
      yTicks: niceTicks(lo, hi, 4),
      xTicks: timeTicks(start, end, plotW),
    }
  }, [width, readings, start, end, sensor])

  const latest = readings.at(-1)
  const current = latest?.values[sensor.key] ?? null
  const status = stale ? 'nodata' : sensorStatus(sensor, current)

  const hoverIndex = hoverTime != null ? nearestIndex(readings, hoverTime) : -1
  const hovered =
    hoverIndex >= 0 && Math.abs(readings[hoverIndex].time - hoverTime) <= GAP_MS ? readings[hoverIndex] : null
  const hoveredValue = hovered?.values[sensor.key] ?? null

  function timeAt(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    const px = event.clientX - rect.left
    if (!chart || px < M.left || px > M.left + chart.plotW) return null
    return start + ((px - M.left) / chart.plotW) * (end - start)
  }

  function handleKeyDown(event) {
    if (!readings.length) return
    if (event.key === 'Escape') {
      onHover(null)
      return
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const from = hoverIndex >= 0 ? hoverIndex : readings.length
    const next = Math.min(readings.length - 1, Math.max(0, from + (event.key === 'ArrowLeft' ? -1 : 1)))
    onHover(readings[next].time)
  }

  const minutes = Math.round((end - start) / 60_000)
  const ariaLabel = chart?.stats
    ? `${sensor.label} over the last ${minutes} minutes: now ${formatValue(sensor, current)} ${sensor.unit}, ` +
      `min ${formatValue(sensor, chart.stats.min)}, max ${formatValue(sensor, chart.stats.max)}. ` +
      'Use left and right arrow keys to step through readings.'
    : `${sensor.label}: no readings yet`

  const plotBottom = M.top + (chart?.plotH ?? 0)

  return (
    <article className={`card trend trend--${status}`}>
      <header className="trend__head">
        <div className="trend__titles">
          <span className="sensor__code">{sensor.code}</span>
          <span className="trend__label">{sensor.label}</span>
        </div>
        <div className="trend__readout">
          {hovered && hoveredValue != null ? (
            <>
              <time className="trend__time" dateTime={hovered.timestamp}>
                {formatClock(hovered.timestamp)}
              </time>
              <span className="trend__value">{formatValue(sensor, hoveredValue)}</span>
              <span className="trend__unit">{sensor.unit}</span>
            </>
          ) : (
            <>
              <span className="trend__value">{formatValue(sensor, current)}</span>
              <span className="trend__unit">{sensor.unit}</span>
              <StatusLight status={status} />
            </>
          )}
        </div>
      </header>

      <div
        ref={plotRef}
        className="trend__plot"
        tabIndex={0}
        role="img"
        aria-label={ariaLabel}
        onPointerMove={(event) => onHover(timeAt(event))}
        onPointerLeave={() => onHover(null)}
        onKeyDown={handleKeyDown}
        onBlur={() => onHover(null)}
      >
        {chart && readings.length < 2 && <div className="chart-empty">Waiting for data…</div>}
        {chart && readings.length >= 2 && (
          <svg width={width} height={HEIGHT} aria-hidden="true">
            <defs>
              <clipPath id={clipId}>
                <rect x={M.left} y={0} width={chart.plotW + 6} height={plotBottom + 4} />
              </clipPath>
            </defs>

            {chart.yTicks.ticks.map((v) => (
              <g key={`y${v}`}>
                <line className="chart-grid" x1={M.left} x2={M.left + chart.plotW} y1={chart.y(v)} y2={chart.y(v)} />
                <text className="chart-tick" x={M.left - 8} y={chart.y(v)} dy="0.32em" textAnchor="end">
                  {formatTick(v, chart.yTicks.step)}
                </text>
              </g>
            ))}

            {chart.xTicks.ticks.map((t) => {
              const px = chart.x(t)
              const anchor = px < M.left + 28 ? 'start' : px > M.left + chart.plotW - 28 ? 'end' : 'middle'
              return (
                <g key={`x${t}`}>
                  <line className="chart-grid" x1={px} x2={px} y1={M.top} y2={plotBottom} />
                  <text className="chart-tick" x={px} y={HEIGHT - 6} textAnchor={anchor}>
                    {formatTimeTick(t, chart.xTicks.step)}
                  </text>
                </g>
              )
            })}

            <line className="chart-axis" x1={M.left} x2={M.left + chart.plotW} y1={plotBottom} y2={plotBottom} />

            {chart.limits.map((l) => (
              <line
                key={l.key}
                className={`chart-limit chart-limit--${l.tone}`}
                x1={M.left}
                x2={M.left + chart.plotW}
                y1={l.y}
                y2={l.y}
              />
            ))}

            <g clipPath={`url(#${clipId})`}>
              <path className="trend__line" d={chart.line} />
              {chart.warning && <path className="chart-dot chart-dot--warning" d={chart.warning} />}
              {chart.critical && <path className="chart-dot chart-dot--critical" d={chart.critical} />}
              {!hovered && current != null && (
                <circle
                  className={`chart-marker chart-marker--${status}`}
                  cx={chart.x(latest.time)}
                  cy={chart.y(current)}
                  r="4"
                />
              )}
            </g>

            {hovered && hoveredValue != null && (
              <g>
                <line
                  className="chart-cursor"
                  x1={chart.x(hovered.time)}
                  x2={chart.x(hovered.time)}
                  y1={M.top}
                  y2={plotBottom}
                />
                <circle
                  className="chart-marker chart-marker--hover"
                  cx={chart.x(hovered.time)}
                  cy={chart.y(hoveredValue)}
                  r="4.5"
                />
              </g>
            )}
          </svg>
        )}
      </div>

      <footer className="trend__stats">
        {chart?.stats ? (
          <>
            <span>
              Min <strong>{formatValue(sensor, chart.stats.min)}</strong>
            </span>
            <span>
              Avg <strong>{formatValue(sensor, chart.stats.avg)}</strong>
            </span>
            <span>
              Max <strong>{formatValue(sensor, chart.stats.max)}</strong>
            </span>
          </>
        ) : (
          <span>No readings in this time range</span>
        )}
      </footer>
    </article>
  )
})
